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

const UpdateSchema = z.object({
  statut: z.enum(["SOUMISE", "DOSSIER_COMPLET", "EN_EXAMEN", "ADMIS", "REFUSE", "INSCRIT", "ANNULE"]).optional(),
  dateExamen: z.string().optional().nullable(),
  noteExamen: z.number().min(0).max(20).optional().nullable(),
  commentaire: z.string().optional(),
  motifRefus: z.string().optional(),
  documents: z.array(z.object({ nom: z.string(), url: z.string(), type: z.string().optional() })).optional(),
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
      // Récupérer le tarif d'inscription pour le niveau/site/année
      // eslint-disable-next-line ecolemiriam/require-site-filter -- recherche tarif par niveau, pas par site obligatoire
      const tarif = await prisma.tarifNiveau.findFirst({
        where: {
          tenantId: session.user.tenantId,
          niveau: candidature.classeVoulue,
          annee: candidature.annee,
          actif: true,
          ...(candidature.siteId ? { siteId: candidature.siteId } : {}),
        },
      });

      // La facture d'inscription inclut : frais d'inscription + mensualité de septembre
      const fraisInscription = tarif?.fraisInscription ?? 0;
      const mensualite = tarif?.mensualite ?? 0;
      const montantTotal = fraisInscription + mensualite;
      const devise = tarif?.devise ?? "DJF";

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
          libelle: `Frais d'inscription + Scolarité Septembre — ${candidature.prenom} ${candidature.nom} (${candidature.classeVoulue}, ${candidature.annee})`,
          montant: montantTotal,
          devise,
          statut: "EN_ATTENTE",
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
    // eslint-disable-next-line ecolemiriam/require-tenant-id, ecolemiriam/require-site-filter -- findUnique sur contrainte unique tenantId_matricule
    const existingMatricule = await prisma.eleve.findUnique({
      where: { tenantId_matricule: { tenantId, matricule } },
    });
    if (existingMatricule) {
      return NextResponse.json(
        { error: `Le matricule ${matricule} existe déjà. Contactez l'administrateur.` },
        { status: 409 }
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

      // 2. Créer l'élève
      const eleve = await tx.eleve.create({
        data: {
          tenantId,
          siteId: candidature.siteId,
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

  const candidature = await prisma.candidature.findFirst({
    where: { id, tenantId: session.user.tenantId, ...siteFilter2 },
  });

  if (!candidature) {
    return NextResponse.json({ error: "Candidature introuvable" }, { status: 404 });
  }

  await prisma.candidature.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
