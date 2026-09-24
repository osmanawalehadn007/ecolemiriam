import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { siteFilterForModel } from "@/lib/site-scope";
import { authorizeSuperAdmin } from "@/lib/rbac";

export async function GET() {
  // Route de développement (crée un parent et le lie aux élèves) : réservée à
  // l'équipe plateforme, jamais accessible aux comptes d'établissement.
  const gate = await authorizeSuperAdmin();
  if (!gate.ok) return gate.response;

  const session = gate.session;
  const tenantId = gate.tenantId;
  if (!tenantId) {
    return NextResponse.json(
      { error: "Aucun établissement associé au compte" },
      { status: 403 }
    );
  }

  // Get first 3 active students
  const siteFilter = siteFilterForModel("eleve", session.user);
  const eleves = await prisma.eleve.findMany({
    where: { tenantId, ...siteFilter, statut: "ACTIF" },
    take: 3,
    orderBy: { nom: "asc" },
    select: { id: true, nom: true, prenom: true, matricule: true },
  });

  // Get or create a parent
  let parent = await prisma.parent.findFirst({
    where: { tenantId, ...siteFilterForModel("parent", session.user) },
    orderBy: { createdAt: "desc" },
  });

  if (!parent) {
    parent = await prisma.parent.create({
      data: {
        tenantId,
        nom: "Ndiaye",
        prenom: "Fatou",
        phone: "779876543",
        email: "fatou.ndiaye@lycee-demo.ecolemiriam.app",
      },
    });
  }

  // Link each student to this parent if not already linked
  const results: string[] = [];
  for (const eleve of eleves) {
    // eslint-disable-next-line ecolemiriam/require-site-filter -- route de test/développement, élèves déjà filtrés par site ci-dessus
    // eslint-disable-next-line ecolpro/require-site-filter -- route de test/développement, élèves déjà filtrés par site ci-dessus
    const existing = await prisma.eleveParent.findUnique({
      where: { eleveId_parentId: { eleveId: eleve.id, parentId: parent.id } },
    });
    if (!existing) {
      await prisma.eleveParent.create({
        data: {
          eleveId: eleve.id,
          parentId: parent.id,
          lien: "TUTEUR",
          isGardien: true,
        },
      });
      results.push(`✅ ${eleve.prenom} ${eleve.nom} lié à ${parent.prenom} ${parent.nom}`);
    } else {
      results.push(`⏭️ ${eleve.prenom} ${eleve.nom} déjà lié à ${parent.prenom} ${parent.nom}`);
    }
  }

  // Return eleve IDs and parent info for the test
  return NextResponse.json({
    parent: { id: parent.id, nom: parent.nom, prenom: parent.prenom, phone: parent.phone, email: parent.email },
    eleves: eleves.map((e) => ({ id: e.id, nom: e.nom, prenom: e.prenom, matricule: e.matricule })),
    links: results,
  });
}
