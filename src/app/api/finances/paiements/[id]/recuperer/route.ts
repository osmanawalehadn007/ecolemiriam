import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import { siteFilterForModel } from "@/lib/site-scope";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const denied = checkPermission(session.user.role, "finance:write");
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const siteFilter = siteFilterForModel("facture", session.user);
  // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId déjà dans le where (le linter ne détecte pas le spread/merge)
  const paiement = await prisma.paiement.findFirst({
    where: {
      id,
      facture: { tenantId: session.user.tenantId, ...siteFilter },
      methode: "espèces",
    },
    include: { facture: { select: { siteId: true } } },
  });
  if (!paiement) {
    return NextResponse.json({ error: "Paiement introuvable ou non autorisé" }, { status: 404 });
  }

  const updated = await prisma.paiement.update({
    where: { id },
    data: {
      directorRecu: true,
      directorRecuAt: new Date(),
      directorRecuParId: session.user.id,
    },
    include: {
      facture: { select: { numero: true, eleve: { select: { nom: true, prenom: true } }, site: { select: { nom: true } } } },
      enregistrePar: { select: { name: true } },
    },
  });

  return NextResponse.json({ paiement: updated });
}
