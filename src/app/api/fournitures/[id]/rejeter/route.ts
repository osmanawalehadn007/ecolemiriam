import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { authorize } from "@/lib/rbac";
import { siteFilterForModel } from "@/lib/site-scope";

const RejetSchema = z.object({
  raison: z.string().optional(),
});

// POST /api/fournitures/[id]/rejeter
// Le secrétariat rejette une liste soumise avec un motif
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await authorize({ permission: "fournitures:validate" });
  if (!gate.ok) return gate.response;
  const { tenantId } = gate;
  const { id } = await params;

  const siteFilter = siteFilterForModel("fournitureListe", gate.session.user);

  // eslint-disable-next-line ecolemiriam/require-annee-filter -- lookup par id : la liste porte sa propre année
  const liste = await prisma.fournitureListe.findFirst({
    where: { id, tenantId, ...siteFilter },
    select: { id: true, statut: true },
  });

  if (!liste) {
    return NextResponse.json({ error: "Liste introuvable" }, { status: 404 });
  }

  if (liste.statut !== "SOUMISE") {
    return NextResponse.json(
      { error: "Seules les listes soumises peuvent être rejetées." },
      { status: 400 }
    );
  }

  let raison: string | undefined;
  try {
    const json = await request.json();
    const data = RejetSchema.parse(json);
    raison = data.raison;
  } catch {
    // Corps optionnel — on ignore les erreurs de parsing
  }

  const updated = await prisma.fournitureListe.update({
    where: { id },
    data: {
      statut: "REJETEE",
      commentaireSecretariat: raison ?? null,
    },
  });

  return NextResponse.json(updated);
}
