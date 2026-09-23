import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForRelation, siteFilterForModel } from "@/lib/site-filter";

const UpdateSchema = z.object({
  statut: z.enum(["JUSTIFIEE", "INJUSTIFIEE", "EN_ATTENTE"]),
  commentaire: z.string().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const denied = checkPermission(session.user.role, "rh:write");
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json();
  const { statut, commentaire } = UpdateSchema.parse(body);

  const userFilter = siteFilterForRelation(session.user, "user");
  const siteFilter = Object.keys(userFilter).length > 0
    ? { enseignant: (userFilter as any).user }
    : {};
  // Filtres canoniques : la construction manuelle ci-dessus ne couvrait que le
  // chemin Enseignant → User, sans passer par EnseignantSite. `absencePersonnel`
  // et `ficheRH` étant rattachés à `enseignant`, on laisse `site-scope` décider
  // du bon chemin (source unique de vérité).
  const absenceFilter = siteFilterForModel("absencePersonnel", session.user);
  const ficheFilter = siteFilterForModel("ficheRH", session.user);

  const absence = await prisma.absencePersonnel.findFirst({
    where: { id, tenantId: session.user.tenantId, ...siteFilter, ...absenceFilter },
  });
  if (!absence) {
    return NextResponse.json({ error: "Absence introuvable" }, { status: 404 });
  }

  const updated = await prisma.absencePersonnel.update({
    where: { id },
    data: {
      statut,
      commentaire: commentaire || absence.commentaire,
    },
  });

  if (statut === "INJUSTIFIEE" || statut === "JUSTIFIEE") {
    // Le compteur doit porter sur le même périmètre que l'absence traitée :
    // un enseignant peut être rattaché à plusieurs sites.
    const count = await prisma.absencePersonnel.count({
      where: {
        enseignantId: absence.enseignantId,
        tenantId: session.user.tenantId,
        statut: "INJUSTIFIEE",
        ...absenceFilter,
      },
    });
    // Écriture par identifiant : on vérifie d'abord que la fiche visée est bien
    // dans le périmètre (une fiche d'un autre site ne doit pas être touchée).
    const fiche = await prisma.ficheRH.findFirst({
      where: { enseignantId: absence.enseignantId, tenantId: session.user.tenantId, ...ficheFilter },
      select: { id: true },
    });
    if (fiche) {
      await prisma.ficheRH.update({
        where: { id: fiche.id },
        data: { absencesCount: count },
      }).catch(() => {});
    }
  }

  return NextResponse.json({ absence: updated });
}
