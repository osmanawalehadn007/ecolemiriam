import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import { siteFilterForModel } from "@/lib/site-scope";
import { z } from "zod";

const DepotSchema = z.object({
  banque: z.string().min(1, "Le nom de la banque est requis"),
  date: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const denied = checkPermission(session.user.role, "finance:write");
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json();
  const parsed = DepotSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(", ") }, { status: 400 });
  }

  const siteFilter = siteFilterForModel("facture", session.user);
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
      depotBanque: parsed.data.banque,
      depotDate: parsed.data.date ? new Date(parsed.data.date) : new Date(),
      depotParId: session.user.id,
    },
    include: {
      facture: { select: { numero: true, eleve: { select: { nom: true, prenom: true } }, site: { select: { nom: true } } } },
      enregistrePar: { select: { name: true } },
    },
  });

  return NextResponse.json({ paiement: updated });
}
