import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma, { runWithRlsBatch } from "@/lib/prisma";
import prismaBase from "@/lib/prisma-base";
import { revalidatePath, revalidateTag } from "next/cache";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { checkPermission } from "@/lib/rbac";
import { canAccessSite } from "@/lib/site-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { NIVEAUX_CANONIQUES, normaliserNiveau } from "@/lib/niveau";
import { generateSecurePassword } from "@/lib/security/password";
import { sendVerificationEmail } from "@/lib/security/email-verification";
import { preparerPlan } from "@/lib/import-enseignants-server";
import type { Action, LignePlan } from "@/lib/import-enseignants";

/**
 * POST /api/import/enseignants — seconde étape : appliquer le plan.
 *
 * Le client renvoie le fichier prévisualisé, son empreinte, et les décisions
 * qu'il a éventuellement modifiées. Le serveur **rejoue l'analyse** au lieu
 * de faire confiance au plan reçu : seule l'action par ligne est reprise du
 * client, jamais le verdict ni les IDs résolus.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "parametres:write");
    if (denied) return denied;

    const tenantId = session.user.tenantId;

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Aucun fichier fourni" }, { status: 400 });

    // L'import doit avoir été prévisualisé : on refuse une écriture directe.
    const hashAttendu = formData.get("hash") as string | null;
    if (!hashAttendu) {
      return NextResponse.json(
        { error: "Import non prévisualisé. Analysez le fichier avant de confirmer." },
        { status: 400 },
      );
    }

    const buffer = await file.arrayBuffer();
    const { plan } = await preparerPlan(
      {
        id: session.user.id,
        tenantId,
        role: session.user.role,
        siteId: session.user.siteId ?? null,
        siteIds: session.user.siteIds ?? [],
        tenantHasSites: session.user.tenantHasSites,
      },
      buffer,
    );

    // Le fichier confirmé doit être celui qui a été analysé.
    if (plan.hash !== hashAttendu) {
      return NextResponse.json(
        { error: "Le fichier a changé depuis l'analyse. Relancez la prévisualisation." },
        { status: 409 },
      );
    }

    // Décisions de l'utilisateur : { "12": "CREER", "13": "IGNORER" }
    let decisions: Record<string, Action> = {};
    const decisionsRaw = formData.get("decisions") as string | null;
    if (decisionsRaw) {
      try {
        decisions = JSON.parse(decisionsRaw);
      } catch {
        return NextResponse.json({ error: "Décisions illisibles" }, { status: 400 });
      }
    }

    const actionDe = (l: LignePlan): Action => {
      if (l.verdict === "ERREUR") return "IGNORER";
      const choisie = decisions[String(l.ligne)];
      if (choisie === "CREER" || choisie === "IGNORER") return choisie;
      return l.action;
    };

    const aCreer = plan.lignes.filter((l) => actionDe(l) === "CREER" && l.siteId);
    const ignorees = plan.lignes.filter((l) => actionDe(l) === "IGNORER");

    if (aCreer.length === 0) {
      return NextResponse.json({
        success: true,
        summary: {
          totalRows: plan.lignes.length,
          created: 0,
          skipped: ignorees.length,
          warnings: ["Aucune ligne à importer : tout était déjà présent ou ignoré."],
        },
      });
    }

    // Vérifier à nouveau l'unicité des emails au moment de l'écriture
    // (race condition : un utilisateur a pu être créé entre l'analyse et maintenant)
    const emailsACreer = aCreer.map((l) => l.email);
    const existants = await prismaBase.user.findMany({
      where: { email: { in: emailsACreer, mode: "insensitive" } },
      select: { email: true },
    });
    const emailsDejaPris = new Set(existants.map((u) => u.email.toLowerCase()));
    const lignesFinales = aCreer.filter((l) => !emailsDejaPris.has(l.email));
    const lignesSkippedRace = aCreer.length - lignesFinales.length;

    const warnings: string[] = [];
    if (lignesSkippedRace > 0) {
      warnings.push(`${lignesSkippedRace} enseignant(s) ignoré(s) : email créé entre l'analyse et la confirmation`);
    }

    // Identifiant du lot : permet d'identifier tous les enseignants d'un même import
    const importBatchId = randomUUID();

    let created = 0;
    const erreursCreation: string[] = [];

    // Création un par un (nécessaire pour : hash password, email vérification, Enseignant lié)
    for (const l of lignesFinales) {
      try {
        // Défense en profondeur : le plan est déjà borné au périmètre du
        // demandeur (`preparerPlan`), mais on revérifie le site cible avant
        // d'écrire. Un comptable rattaché à un seul site ne doit pas
        // provisionner un enseignant sur un autre site.
        if (!canAccessSite(session.user, l.siteId)) {
          erreursCreation.push(
            `Ligne ${l.ligne} (${l.nom}) : site hors de votre périmètre — ignorée`,
          );
          continue;
        }

        // Année scolaire RÉELLE : elle était figée à « 2026-2027 », ce qui
        // rattachait toute classe créée par l'import à une année révolue dès
        // la bascule suivante (classes invisibles dans l'année en cours).
        const anneeCourante = await getAnneeCouranteLibelle(tenantId);
        if (!anneeCourante) {
          erreursCreation.push(
            `Ligne ${l.ligne} (${l.nom}) : aucune année scolaire active — import impossible`,
          );
          continue;
        }

        // Générer un mot de passe aléatoire fort
        const password = generateSecurePassword();
        const hashed = await bcrypt.hash(password, 12);

        // Tout est écrit dans UNE transaction RLS : un échec en cours de route
        // ne laisse plus un compte TEACHER sans fiche Enseignant — état qui
        // bloquait toute réimportation, l'email étant désormais pris.
        await runWithRlsBatch(tenantId, l.siteId!, async (tx) => {
          // 1. Créer le User
          const newUser = await tx.user.create({
            data: {
              tenantId,
              siteId: l.siteId!,
              name: l.nom,
              email: l.email,
              role: "TEACHER",
              phone: l.telephone || null,
              password: hashed,
              isActive: true,
              userTenants: {
                create: {
                  tenantId,
                  role: "TEACHER",
                  isActive: true,
                  isDefault: true,
                },
              },
            },
          });

          // 2. Créer l'Enseignant
          const enseignant = await tx.enseignant.create({
            data: {
              tenantId,
              userId: newUser.id,
              typeContrat: l.tempsPlein ? "CDI" : "CDD",
              dateEntree: new Date(),
            },
          });

          // 3. Lier l'enseignant au site (EnseignantSite). Obligatoire : sans
          // ce rattachement, le périmètre de l'enseignant est vide et
          // l'isolation « fail-closed » le rend aveugle.
          await tx.enseignantSite.create({
            data: {
              enseignantId: enseignant.id,
              siteId: l.siteId!,
            },
          });

          // 4. Affecter la matière si elle a été résolue
          if (l.matiereId) {
            await tx.enseignantMatiere.create({
              data: {
                tenantId,
                enseignantId: enseignant.id,
                matiereId: l.matiereId,
              },
            });
          }

          // 5. Résoudre ou créer la classe. Le niveau vient du RÉFÉRENTIEL
          // OFFICIEL : une classe créée avec un niveau hors référentiel serait
          // infacturable (la grille tarifaire est indexée dessus).
          let classeId = l.classeId;
          if (l.classe && !classeId) {
            const niveau = normaliserNiveau(l.classe);
            if (!niveau) {
              throw new Error(
                `niveau de classe « ${l.classe} » non reconnu ` +
                  `(valeurs autorisées : ${NIVEAUX_CANONIQUES.join(", ")})`,
              );
            }
            // Une autre ligne du même fichier peut avoir créé la classe juste
            // avant : on la relit avant de créer, sinon la seconde échouerait
            // sur l'unicité (tenant, site, année, nom) et l'enseignant
            // resterait sans affectation, avec un simple avertissement.
            const existante = await tx.classe.findFirst({
              where: { tenantId, siteId: l.siteId!, nom: l.classe, annee: anneeCourante },
              select: { id: true },
            });
            classeId =
              existante?.id ??
              (
                await tx.classe.create({
                  data: {
                    tenantId,
                    siteId: l.siteId!,
                    nom: l.classe,
                    niveau,
                    annee: anneeCourante,
                    effectifMax: 40,
                  },
                })
              ).id;
          }

          // 6. Affectation enseignant ↔ classe (primaire : sans matière).
          if (classeId) {
            await tx.enseignantAffectation.create({
              data: {
                tenantId,
                enseignantId: enseignant.id,
                classeId,
                matiereId: l.matiereId || null,
              },
            });
          }
        });

        // 7. Envoyer l'email de vérification (non bloquant, hors transaction)
        try {
          const verifyResult = await sendVerificationEmail(
            l.email,
            l.nom,
            undefined,
            true,
            password,
          );
          if (!verifyResult.success) {
            console.warn(`[import/enseignants] Échec envoi email à ${l.email}:`, verifyResult.error);
          }
        } catch (err) {
          console.warn(`[import/enseignants] Erreur envoi email à ${l.email}:`, err);
        }

        created++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erreur inconnue";
        erreursCreation.push(`Ligne ${l.ligne} (${l.nom}) : ${msg}`);
      }
    }

    if (erreursCreation.length > 0) {
      warnings.push(...erreursCreation.slice(0, 20));
    }

    // Audit log
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId: session.user.id,
        action: "enseignants.import",
        verdict: "ALLOWED",
        resource: "enseignant",
        reason: `Import de ${file.name}`,
        metadata: {
          hash: plan.hash,
          fichier: file.name,
          importBatchId,
          created,
          ignorees: ignorees.length,
        },
      },
    });

    revalidatePath("/parametres");
    revalidateTag("users-list", "max");

    return NextResponse.json({
      success: true,
      summary: {
        totalRows: plan.lignes.length,
        created,
        skipped: ignorees.length + lignesSkippedRace,
        warnings: warnings.length > 0 ? warnings : undefined,
        importBatchId: created > 0 ? importBatchId : undefined,
      },
    });
  } catch (error) {
    console.error("[API/import/enseignants] POST", error);
    return NextResponse.json({ error: "Erreur lors de l'import" }, { status: 500 });
  }
}
