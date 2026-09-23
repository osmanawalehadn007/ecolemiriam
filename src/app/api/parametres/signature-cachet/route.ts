import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkPermission } from "@/lib/rbac";

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  // Signature, cachet et nom du chef d'établissement alimentent les documents
  // officiels (bulletins, attestations, convocations) : acte du propriétaire.
  // Permission dédiée → le refus est journalisé dans `auditLog`.
  const denied = checkPermission(session.user.role, "etablissement:write");
  if (denied) return denied;

  const body = await req.json();
  const { chefEtablissement, signatureUrl, cachetUrl } = body;

  const tenant = await prisma.tenant.update({
    where: { id: session.user.tenantId },
    data: {
      chefEtablissement: chefEtablissement || null,
      signatureUrl: signatureUrl || null,
      cachetUrl: cachetUrl || null,
    },
    select: { name: true, chefEtablissement: true, signatureUrl: true, cachetUrl: true },
  });

  return NextResponse.json(tenant);
}
