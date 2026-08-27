import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForModel } from "@/lib/site-scope";
import { auditFire } from "@/lib/audit";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { notifyDirection } from "@/lib/notifications/notify-direction";

const UpdateSchema = z.object({
  statut: z.enum(["SOUMISE", "EN_EXAMEN", "ADMIS", "REFUSE", "INSCRIT", "ANNULE"]).optional(),
  dateExamen: z.string().optional().nullable(),
  noteExamen: z.number().min(0).max(20).optional().nullable(),
  commentaire: z.string().optional(),
  motifRefus: z.string().optional(),
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

  // ── Création automatique de la fiche élève quand le statut passe à INSCRIT ──
  //    Le directeur confirme l'inscription → on crée l'élève + le parent
  //    + le lien EleveParent en une seule transaction.
  let eleveCreeId: string | null = null;
  let matricule: string | null = null;

  if (data.statut === "INSCRIT" && candidature.statut !== "INSCRIT") {
    const tenantId = session.user.tenantId;

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

    // Créer l'élève + parent + lien en transaction
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

      return { eleve, parent };
    });

    eleveCreeId = result.eleve.id;

    auditFire({
      userId: session.user.id,
      action: "admissions:inscrire",
      verdict: "ALLOWED",
      resource: "eleve",
      resourceId: result.eleve.id,
      reason: `Élève créé automatiquement depuis candidature ${candidature.id}`,
      metadata: {
        candidatureId: candidature.id,
        matricule,
        eleveNom: `${candidature.prenom} ${candidature.nom}`,
        parentId: result.parent.id,
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
      contenu: `Le candidat ${eleveNomComplet} (classe souhaitée: ${candidature.classeVoulue}) a été admis par ${auteurNom}.\n\nLa candidature est en attente de confirmation d'inscription.`,
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

  return NextResponse.json({ candidature: updated, eleveCreeId });
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
