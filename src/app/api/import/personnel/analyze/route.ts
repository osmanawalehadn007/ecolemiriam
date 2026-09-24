import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import prismaBase from "@/lib/prisma-base";
import { checkPermission } from "@/lib/rbac";
import { mergeFilters, siteFilterForModel } from "@/lib/site-scope";
import {
  parsePersonnelWorkbook,
  analyzePersonnelImport,
} from "@/lib/import-personnel";

/**
 * POST /api/import/personnel/analyze
 *
 * Première étape : lire le fichier et dire ce qui se passerait, sans écrire.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "parametres:write");
    if (denied) return denied;

    const tenantId = session.user.tenantId;

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Aucun fichier fourni" }, { status: 400 });

    // Charger les sites du tenant
     
    const sites = await prisma.site.findMany({
      where: { tenantId },
      select: { id: true, nom: true },
    });

    const buffer = await file.arrayBuffer();
    const { rows, erreurs, hash } = await parsePersonnelWorkbook(buffer, sites.map((s) => s.nom));

    // Vérifier les emails existants (inter-tenants)
    const emailsAVerifier = rows.map((r) => r.email);
    let emailsExistants = new Set<string>();
    if (emailsAVerifier.length > 0) {
      const existants = await prismaBase.user.findMany({
        where: { email: { in: emailsAVerifier, mode: "insensitive" } },
        select: { email: true },
      });
      emailsExistants = new Set(existants.map((u) => u.email.toLowerCase()));
    }

    const plan = analyzePersonnelImport(rows, erreurs, emailsExistants, sites, hash);

    if (plan.lignes.length === 0) {
      return NextResponse.json(
        { error: "Aucune ligne exploitable. Vérifiez les en-têtes : nom, email, site et rôle sont requis." },
        { status: 400 },
      );
    }

    return NextResponse.json(plan);
  } catch (error) {
    console.error("[API/import/personnel/analyze]", error);
    const message = error instanceof Error ? error.message : "Erreur lors de l'analyse";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
