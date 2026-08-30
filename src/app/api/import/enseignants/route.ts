import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import prismaBase from "@/lib/prisma-base";
import { revalidatePath, revalidateTag } from "next/cache";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { checkPermission } from "@/lib/rbac";
import { generateSecurePassword } from "@/lib/security/password";
import { sendVerificationEmail } from "@/lib/security/email-verification";
import { preparerPlan } from "@/lib/import-enseignants-server";
import type { Action, LignePlan } from "@/lib/import-enseignants";

/**
 * Infère le niveau scolaire à partir du nom de la classe.
 * Système djiboutien : 1ère-5ème (Primaire), 6ème-9ème (Collège),
 * Seconde/Première/Terminale (Lycée).
 * Ex: "1ère A" → "1ère", "PS/MS" → "Maternelle", "5ème C" → "5ème"
 */
function inferNiveauFromClasseName(nom: string): string {
  const lower = nom.toLowerCase().trim();
  // Maternelle / Garderie
  if (/^(ps|petite section)/.test(lower) || /^(ms|moyenne section)/.test(lower) ||
      /^(gs|grande section)/.test(lower) || /crèche|creche|garderie/.test(lower)) {
    return "Maternelle";
  }
  // Lycée : Seconde, Première, Terminale (noms complets uniquement,
  // PAS "1ère" qui en Djibouti = 1ère année = Primaire)
  if (/seconde|2nde|2nd\b/.test(lower)) return "Seconde";
  if (/première|premiere/.test(lower)) return "Première";
  if (/terminale|term\b|tle\b/.test(lower)) return "Terminale";
  // Primaire + Collège : 1ère à 9ème (système djiboutien)
  const niveauMatch = lower.match(/(\d+)\s*(?:ère|ere|e|ème|eme)?/);
  if (niveauMatch) {
    const num = parseInt(niveauMatch[1]);
    if (num === 1) return "1ère";                  // 1ère année (Primaire)
    if (num >= 2 && num <= 9) return `${num}ème`;  // 2ème-9ème année
  }
  // Compatibilité anciens formats français (CP, CE1, CE2, CM1, CM2)
  if (/^cp\b/.test(lower)) return "1ère";
  if (/^ce1\b/.test(lower)) return "2ème";
  if (/^ce2\b/.test(lower)) return "3ème";
  if (/^cm1\b/.test(lower)) return "4ème";
  if (/^cm2\b/.test(lower)) return "5ème";
  // Fallback
  return nom;
}

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
        // Générer un mot de passe aléatoire fort
        const password = generateSecurePassword();
        const hashed = await bcrypt.hash(password, 12);

        // Séparer prénom / nom
        const [firstName, ...restName] = l.nom.split(" ");
        const lastName = restName.join(" ") || firstName;

        // 1. Créer le User
        const newUser = await prisma.user.create({
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
        const enseignant = await prisma.enseignant.create({
          data: {
            tenantId,
            userId: newUser.id,
            typeContrat: l.tempsPlein ? "CDI" : "CDD",
            dateEntree: new Date(),
          },
        });

        // 3. Lier l'enseignant au site (EnseignantSite)
        await prisma.enseignantSite.create({
          data: {
            enseignantId: enseignant.id,
            siteId: l.siteId!,
          },
        }).catch(() => {
          // Si le lien existe déjà (unique constraint), on ignore
        });

        // 4. Affecter la matière si elle a été résolue
        if (l.matiereId) {
          await prisma.enseignantMatiere.create({
            data: {
              tenantId,
              enseignantId: enseignant.id,
              matiereId: l.matiereId,
            },
          }).catch(() => {
            // Si l'affectation existe déjà, on ignore
          });
        }

        // 4b. Résoudre ou créer la classe, puis affecter l'enseignant
        let classeId = l.classeId;
        if (l.classe && l.siteId) {
          if (!classeId) {
            // La classe n'existe pas — la créer
            try {
              const niveau = inferNiveauFromClasseName(l.classe);
              const currentYear = "2026-2027";
              const newClasse = await prisma.classe.create({
                data: {
                  tenantId,
                  siteId: l.siteId,
                  nom: l.classe,
                  niveau,
                  annee: currentYear,
                  effectifMax: 40,
                },
              });
              classeId = newClasse.id;
            } catch (err) {
              const msg = err instanceof Error ? err.message : "Erreur création classe";
              erreursCreation.push(`Ligne ${l.ligne} (${l.nom}) — création classe « ${l.classe} » : ${msg}`);
            }
          }

          // Créer l'affectation enseignant ↔ classe
          if (classeId) {
            try {
              // Au primaire : pas de matière (matiereId null)
              // Au collège/lycée : matière obligatoire — on prend la 1ère si disponible
              const matiereForAffectation = l.matiereId || null;
              await prisma.enseignantAffectation.create({
                data: {
                  tenantId,
                  enseignantId: enseignant.id,
                  classeId,
                  matiereId: matiereForAffectation,
                },
              });
            } catch (err) {
              // Si l'affectation existe déjà (unique constraint), on ignore
              const msg = err instanceof Error ? err.message : "";
              if (!msg.includes("Already exists") && !msg.includes("unique")) {
                console.warn(`[import/enseignants] Affectation classe échouée pour ${l.nom}:`, msg);
              }
            }
          }
        }

        // 5. Envoyer l'email de vérification (non bloquant)
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
    revalidateTag("users-list");

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
