import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForModel } from "@/lib/site-scope";
import { auditFire } from "@/lib/audit";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";

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

  // ── Restriction : le statut INSCRIT est réservé au directeur (TENANT_ADMIN)
  //    et au super-admin. Un comptable peut faire tout le workflow jusqu'à
  //    ADMIS, mais l'inscription finale doit être confirmée par le directeur.
  //    Sans cette vérification côté serveur, un comptable pourrait contourner
  //    l'UI et appeler l'API directement avec { statut: "INSCRIT" }.
  if (
    data.statut === "INSCRIT" &&
    session.user.role !== "TENANT_ADMIN" &&
    session.user.role !== "SUPER_ADMIN"
  ) {
    return NextResponse.json(
      { error: "L'inscription finale (INSCRIT) est réservée au directeur." },
      { status: 403 }
    );
  }

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

  if (data.statut === "INSCRIT" && candidature.statut !== "INSCRIT") {
    const tenantId = session.user.tenantId;

    // Générer le matricule
    const anneeInscription = await getAnneeCouranteLibelle(tenantId);
    // eslint-disable-next-line ecolemiriam/require-site-filter -- count global pour matricule sequentiel
    const count = await prisma.eleve.count({ where: { tenantId } });
    const matricule = `ECL-${anneeInscription ?? new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;

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
          matricule,
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
