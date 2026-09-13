import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForModel } from "@/lib/site-scope";
import { auditFire } from "@/lib/audit";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { notifyDirection } from "@/lib/notifications/notify-direction";
import { piecesRequisesPresentes } from "@/lib/admissions/pieces-justificatives";
import { niveauToLabel } from "@/lib/niveau";
import { formatMoisScolarite, moisScolariteDefaut, isMoisScolariteValide } from "@/lib/admissions/mois-scolarite";

const UpdateSchema = z.object({
  statut: z.enum(["SOUMISE", "DOSSIER_COMPLET", "EN_EXAMEN", "ADMIS", "REFUSE", "INSCRIT", "ANNULE"]).optional(),
  dateExamen: z.string().optional().nullable(),
  noteExamen: z.number().min(0).max(20).optional().nullable(),
  commentaire: z.string().optional(),
  motifRefus: z.string().optional(),
  documents: z.array(z.object({ nom: z.string(), url: z.string(), type: z.string().optional() })).optional(),
  // Mois de scolarité à facturer avec les frais d'inscription (format "YYYY-MM").
  // Utilisé uniquement au passage à ADMIS. Défaut calculé selon la date si absent.
  moisScolarite: z.string().refine(isMoisScolariteValide, "Mois invalide (format attendu YYYY-MM)").optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const denied = checkPermission(session.user.role, "admissions:write");
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json();
  const data = UpdateSchema.parse(body);

  // ── Le statut INSCRIT est désormais accessible au comptable (bout-en-bout).
  //    La direction (TENANT_ADMIN + PRINCIPAL) est notifiée automatiquement
  //    quand un comptable finalise une inscription (voir plus bas, après la
  //    création de l'élève).

  const siteFilter = siteFilterForModel("candidature", session.user);
  // eslint-disable-next-line ecolemiriam/require-annee-filter -- lookup par id : la candidature porte sa propre année
  const candidature = await prisma.candidature.findFirst({
    where: { id, tenantId: session.user.tenantId, ...siteFilter },
  });

  if (!candidature) {
    return NextResponse.json({ error: "Candidature introuvable" }, { status: 404 });
  }

  // ── Vérification des pièces justificatives pour passer à EN_EXAMEN ──
  //    Le passage à EN_EXAMEN nécessite que toutes les pièces obligatoires
  //    aient été téléversées. On combine les documents existants avec ceux
  //    envoyés dans le PATCH courant.
  if (data.statut === "EN_EXAMEN") {
    const docsCourants = (candidature.documents as { nom: string; url: string }[] | null) ?? [];
    const docsFusionnes = data.documents
      ? [...docsCourants.filter((d) => !data.documents!.some((nd) => nd.nom === d.nom)), ...data.documents]
      : docsCourants;
    const { complet, manquantes } = piecesRequisesPresentes(docsFusionnes);
    if (!complet) {
      return NextResponse.json(
        { error: `Pièces justificatives manquantes : ${manquantes.join(", ")}` },
        { status: 400 }
      );
    }
  }

  // ── Génération automatique de la facture d'inscription au passage à ADMIS ──
  //    Quand le candidat est admis, on crée une facture qui inclut :
  //      1. Les frais d'inscription (one-time)
  //      2. La première mensualité (septembre) du niveau
  //    Le tout dans une seule facture liée à la candidature (sans élève —
  //    l'élève sera créé après paiement). Le montant provient du tarif
  //    configuré pour le niveau/site/année, ou 0 si aucun tarif n'est trouvé.
  let factureCreeId: string | null = null;

  if (data.statut === "ADMIS" && candidature.statut !== "ADMIS") {
    // Vérifier qu'il n'y a pas déjà une facture pour cette candidature
    // eslint-disable-next-line ecolemiriam/require-site-filter -- la candidatureId est déjà spécifique au tenant, pas de filtre site nécessaire
    const factureExistante = await prisma.facture.findFirst({
      where: { candidatureId: candidature.id, tenantId: session.user.tenantId },
    });

    if (!factureExistante) {
      // Les tarifs (TarifNiveau) sont indexés par NIVEAU pédagogique
      // ("Terminale", "CM2"…), alors que `classeVoulue` contient le NOM de la
      // classe ("Terminale A", sélectionné dans la liste). On résout d'abord le
      // niveau depuis la classe correspondante ; à défaut (candidature publique
      // en texte libre) on retombe sur `classeVoulue` tel quel.
      // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par nom de classe, borné au tenant + site de la candidature
      const classeVisee = await prisma.classe.findFirst({
        where: {
          tenantId: session.user.tenantId,
          nom: candidature.classeVoulue,
          // Année de la candidature : une classe homonyme d'une année révolue
          // donnerait un niveau tarifaire faux.
          annee: candidature.annee,
          ...(candidature.siteId ? { siteId: candidature.siteId } : {}),
        },
        select: { niveau: true },
      });
      const niveauTarif = classeVisee?.niveau ?? candidature.classeVoulue;

      // Récupérer le tarif d'inscription pour le niveau/année, en privilégiant
      // le tarif spécifique au site mais en acceptant le tarif partagé
      // (siteId null) — sans quoi un tarif commun à tous les sites serait ignoré
      // et la facture tomberait à 0.
       
      const tarif = await prisma.tarifNiveau.findFirst({
        where: {
          tenantId: session.user.tenantId,
          niveau: niveauTarif,
          annee: candidature.annee,
          actif: true,
          OR: [{ siteId: candidature.siteId ?? null }, { siteId: null }],
        },
        orderBy: { siteId: { sort: "desc", nulls: "last" } }, // privilégier le tarif spécifique au site (NULLs en dernier sur Postgres)
      });

      // Garde-fou : sans tarif configuré (ou tarif à 0), la facture serait vide
      // et l'encaissement impossible. On bloque l'admission avec un message
      // explicite plutôt que de créer une facture inexploitable.
      const fraisInscription = tarif?.fraisInscription ?? 0;
      const mensualite = tarif?.mensualite ?? 0;
      const montantTotal = fraisInscription + mensualite;
      const devise = tarif?.devise ?? "DJF";

      if (!tarif || montantTotal <= 0) {
        return NextResponse.json(
          {
            error: `Aucun tarif actif n'est configuré pour le niveau « ${niveauToLabel(niveauTarif)} » (année ${candidature.annee}). Renseignez les frais d'inscription et la mensualité dans Paramètres → Tarifs avant d'admettre ce candidat.`,
          },
          { status: 400 }
        );
      }

      // La facture d'inscription inclut : frais d'inscription + une mensualité de
      // scolarité. Le mois facturé est choisi par l'utilisateur au moment de
      // l'admission ; à défaut on applique la règle par date (septembre en
      // août/septembre, sinon le mois en cours).
      const moisScolarite = data.moisScolarite ?? moisScolariteDefaut();
      const moisLabel = formatMoisScolarite(moisScolarite);

      // Générer un numéro de facture
      // eslint-disable-next-line ecolemiriam/require-site-filter -- count global pour numéro séquentiel
      const factureCount = await prisma.facture.count({
        where: { tenantId: session.user.tenantId },
      });
      const numeroFacture = `FAC-${new Date().getFullYear()}-${String(factureCount + 1).padStart(5, "0")}`;

      const facture = await prisma.facture.create({
        data: {
          tenantId: session.user.tenantId,
          siteId: candidature.siteId,
          candidatureId: candidature.id,
          numero: numeroFacture,
          libelle: `Frais d'inscription + Scolarité ${moisLabel} — ${candidature.prenom} ${candidature.nom} (${candidature.classeVoulue}, ${candidature.annee})`,
          montant: montantTotal,
          devise,
          statut: "EN_ATTENTE",
          type: "INSCRIPTION",
          // Rattacher la facture au mois de scolarité inclus (ex: "2026-09")
          // pour qu'elle apparaisse dans la vue mensuelle et que genererMensualites
          // puisse détecter le doublon (sinon mois=null → invisible + double facturation).
          mois: moisScolarite,
          createdById: session.user.id,
        },
      });

      factureCreeId = facture.id;
    }
  }

  // ── Création automatique de la fiche élève quand le statut passe à INSCRIT ──
  //    AVANT de créer l'élève, on vérifie que la facture d'inscription
  //    a été entièrement payée. C'est le gate de paiement.
  let eleveCreeId: string | null = null;
  let matricule: string | null = null;

  if (data.statut === "INSCRIT" && candidature.statut !== "INSCRIT") {
    const tenantId = session.user.tenantId;

    // ── Gate de paiement : la facture d'inscription doit être PAYEE ──
    // eslint-disable-next-line ecolemiriam/require-site-filter -- la candidatureId est déjà spécifique au tenant, pas de filtre site nécessaire
    const factureInscription = await prisma.facture.findFirst({
      where: { candidatureId: candidature.id, tenantId },
      include: {
        paiements: true,
      },
    });

    if (!factureInscription) {
      return NextResponse.json(
        { error: "Aucune facture d'inscription trouvée. Le candidat doit d'abord être admis pour générer la facture." },
        { status: 400 }
      );
    }

    // Calculer le total payé
    const totalPaye = factureInscription.paiements.reduce((sum, p) => sum + p.montant, 0);
    const estPayee = totalPaye >= factureInscription.montant && factureInscription.montant > 0;

    if (!estPayee) {
      const restant = factureInscription.montant - totalPaye;
      return NextResponse.json(
        {
          error: `La facture d'inscription (${factureInscription.numero}) n'est pas entièrement payée. Montant: ${factureInscription.montant} ${factureInscription.devise}, Payé: ${totalPaye} ${factureInscription.devise}, Restant: ${restant} ${factureInscription.devise}. Encaissez le paiement avant de finaliser l'inscription.`,
          factureId: factureInscription.id,
          montant: factureInscription.montant,
          totalPaye,
          restant,
        },
        { status: 400 }
      );
    }

    // Générer le matricule
    const anneeInscription = await getAnneeCouranteLibelle(tenantId);
    // eslint-disable-next-line ecolemiriam/require-site-filter -- count global pour matricule sequentiel
    const count = await prisma.eleve.count({ where: { tenantId } });
    matricule = `ECL-${anneeInscription ?? new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;

    // Vérifier que le matricule n'existe pas déjà
    // eslint-disable-next-line ecolemiriam/require-site-filter -- findUnique sur contrainte unique tenantId_matricule
    const existingMatricule = await prisma.eleve.findUnique({
      where: { tenantId_matricule: { tenantId, matricule } },
    });
    if (existingMatricule) {
      return NextResponse.json(
        { error: `Le matricule ${matricule} existe déjà. Contactez l'administrateur.` },
        { status: 409 }
      );
    }

    // ── Résoudre la classe AVANT la transaction, pour pouvoir refuser proprement ──
    //    `candidature.classeVoulue` contient le NOM de la classe. Le couple
    //    (SITE, ANNÉE) est une borne stricte, sans repli :
    //      - SITE  : la classe définit la structure d'accueil, donc le site de
    //                l'élève ; une classe d'un autre site est un mélange de
    //                périmètres.
    //      - ANNÉE : les classes des années révolues restent en base pour
    //                l'historique. L'ancien repli « nom + site » sans année
    //                rattachait silencieusement un élève 2026-2027 à une
    //                classe 2025-2026 homonyme (cas « 6ème2 » / « 1ère SG »
    //                sur l'Annexe Warabaleh). Mieux vaut refuser et demander
    //                la création de la structure de l'année en cours.
    //    Une candidature sans site est refusée : créer un élève hors site
    //    fabriquerait précisément la donnée orpheline visible depuis tous
    //    les sites.
    if (!candidature.siteId) {
      return NextResponse.json(
        {
          error: "Cette candidature n'est rattachée à aucun site. Rouvrez-la et sélectionnez une classe du site concerné avant de finaliser l'inscription.",
        },
        { status: 400 }
      );
    }

    // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup borné au tenant + site de la candidature
    const classeVisee = await prisma.classe.findFirst({
      where: {
        tenantId,
        nom: candidature.classeVoulue,
        annee: candidature.annee,
        siteId: candidature.siteId,
      },
      select: { id: true },
    });

    if (!classeVisee) {
      return NextResponse.json(
        {
          error: `La classe « ${candidature.classeVoulue} » n'existe pas dans ce site pour l'année ${candidature.annee}. Créez la structure (Classes) pour l'année en cours ou corrigez la classe de la candidature avant d'inscrire l'élève.`,
        },
        { status: 400 }
      );
    }

    // Créer l'élève + parent + lien en transaction + lier la facture à l'élève
    const result = await prisma.$transaction(async (tx) => {
      // 1. Créer le parent (s'il n'existe pas déjà par téléphone)
      let parent = await tx.parent.findFirst({
        where: { tenantId, phone: candidature.parentPhone },
      });

      if (!parent) {
        parent = await tx.parent.create({
          data: {
            tenantId,
            nom: candidature.parentNom,
            prenom: candidature.parentPrenom,
            email: candidature.parentEmail || null,
            phone: candidature.parentPhone,
          },
        });
      }

      // 2. Créer l'élève, rattaché à sa classe (résolue et vérifiée ci-dessus)
      const eleve = await tx.eleve.create({
        data: {
          tenantId,
          siteId: candidature.siteId,
          classeId: classeVisee.id,
          matricule: matricule!,
          nom: candidature.nom,
          prenom: candidature.prenom,
          dateNaissance: new Date(candidature.dateNaissance),
          lieuNaissance: candidature.lieuNaissance,
          nationalite: candidature.nationalite || "SN",
          sexe: candidature.sexe,
          statut: "ACTIF",
          anneeInscription: candidature.annee,
        },
      });

      // 3. Créer le lien EleveParent
      await tx.eleveParent.create({
        data: {
          eleveId: eleve.id,
          parentId: parent.id,
          lien: candidature.parentLien,
          isGardien: true,
        },
      });

      // 4. Lier la facture d'inscription à l'élève nouvellement créé
      if (factureInscription) {
        await tx.facture.update({
          where: { id: factureInscription.id },
          data: { eleveId: eleve.id },
        });
      }

      return { eleve, parent };
    });

    eleveCreeId = result.eleve.id;

    auditFire({
      userId: session.user.id,
      action: "admissions:inscrire",
      verdict: "ALLOWED",
      resource: "eleve",
      resourceId: result.eleve.id,
      reason: `Élève créé automatiquement depuis candidature ${candidature.id} après paiement de la facture ${factureInscription.numero}`,
      metadata: {
        candidatureId: candidature.id,
        matricule,
        eleveNom: `${candidature.prenom} ${candidature.nom}`,
        parentId: result.parent.id,
        factureId: factureInscription.id,
      },
    });
  }

  const updated = await prisma.candidature.update({
    where: { id },
    data: {
      ...(data.statut && { statut: data.statut }),
      ...(data.dateExamen !== undefined && {
        dateExamen: data.dateExamen ? new Date(data.dateExamen) : null,
      }),
      ...(data.noteExamen !== undefined && { noteExamen: data.noteExamen }),
      ...(data.commentaire !== undefined && { commentaire: data.commentaire }),
      ...(data.motifRefus !== undefined && { motifRefus: data.motifRefus }),
      ...(data.documents !== undefined && { documents: data.documents }),
    },
  });

  // ── Notifications automatiques à la direction (TENANT_ADMIN + PRINCIPAL) ──
  //    Le comptable gère le flux bout-en-bout ; la direction est tenue informée
  //    à chaque étape clé (admission → inscription finale).
  const eleveNomComplet = `${candidature.prenom} ${candidature.nom}`;
  const auteurNom = session.user.name ?? "Comptable";

  if (data.statut === "ADMIS") {
    await notifyDirection({
      tenantId: session.user.tenantId,
      titre: `Candidat admis — ${eleveNomComplet}`,
      contenu: `Le candidat ${eleveNomComplet} (classe souhaitée: ${candidature.classeVoulue}) a été admis par ${auteurNom}.${
        factureCreeId ? `\n\nUne facture d'inscription a été générée automatiquement. L'inscription finale sera possible après encaissement du paiement.` : ""
      }`,
      envoyeParId: session.user.id,
      siteId: candidature.siteId ?? null,
    });
  }

  if (data.statut === "INSCRIT") {
    await notifyDirection({
      tenantId: session.user.tenantId,
      titre: `Nouvel élève inscrit — ${eleveNomComplet}`,
      contenu: `L'élève ${eleveNomComplet} a été inscrit par ${auteurNom}.${
        matricule ? `\nMatricule: ${matricule}` : ""
      }\nClasse souhaitée: ${candidature.classeVoulue}\nAnnée: ${candidature.annee}\n\nLa fiche élève et le compte parent ont été créés automatiquement.`,
      envoyeParId: session.user.id,
      siteId: candidature.siteId ?? null,
    });
  }

  if (data.statut === "REFUSE") {
    await notifyDirection({
      tenantId: session.user.tenantId,
      titre: `Candidature refusée — ${eleveNomComplet}`,
      contenu: `La candidature de ${eleveNomComplet} (classe: ${candidature.classeVoulue}) a été refusée par ${auteurNom}.${
        data.motifRefus ? `\nMotif: ${data.motifRefus}` : ""
      }`,
      envoyeParId: session.user.id,
      siteId: candidature.siteId ?? null,
    });
  }

  return NextResponse.json({ candidature: updated, eleveCreeId, factureCreeId });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const denied = checkPermission(session.user.role, "admissions:delete");
  if (denied) return denied;

  const { id } = await params;

  const siteFilter2 = siteFilterForModel("candidature", session.user);

  // eslint-disable-next-line ecolemiriam/require-annee-filter -- lookup par id : la candidature porte sa propre année
  const candidature = await prisma.candidature.findFirst({
    where: { id, tenantId: session.user.tenantId, ...siteFilter2 },
  });

  if (!candidature) {
    return NextResponse.json({ error: "Candidature introuvable" }, { status: 404 });
  }

  await prisma.candidature.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
