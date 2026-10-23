import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/rbac";
import { isTenantWideRole } from "@/lib/site-scope";
import { getSitesForUser } from "@/lib/actions/eleve";
import prisma from "@/lib/prisma";
import { dateDjibouti } from "@/lib/cron";
import { rateLimit, getClientIP } from "@/lib/security/rateLimit";
import { chargerRapportsImpayes } from "@/lib/rapports/impayes";
import { genererPdfImpayes } from "@/lib/rapports/impayes-pdf";

/**
 * Rapport des mensualités impayées À CE JOUR, à la demande (bouton de la page
 * Finances). Même contenu que le rapport mensuel automatique du 10 : voir
 * `/api/cron/rapport-impayes`.
 *
 *   ?siteId=<id>   un site (doit être dans le périmètre de l'utilisateur)
 *   ?siteId=all    tous les sites visibles, réunis dans un seul PDF (défaut)
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const rl = rateLimit({ max: 10, windowSec: 60, key: `impayes-pdf:${session.user.id}:${getClientIP(req)}` });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Trop de demandes. Réessayez dans un instant." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const denied = checkPermission(session.user.role, "finance:read");
  if (denied) return denied;

  const demande = new URL(req.url).searchParams.get("siteId") || "all";
  const visibles = await getSitesForUser();
  let siteIds: string[] | null;
  if (demande === "all") {
    // Rôle transverse : tous les sites, élèves « sans site » compris.
    siteIds = isTenantWideRole(session.user.role) ? null : visibles.map((s) => s.id);
  } else if (visibles.some((s) => s.id === demande)) {
    siteIds = [demande];
  } else {
    return NextResponse.json({ error: "Site non autorisé" }, { status: 403 });
  }

  const { annee, mois, jour: jourDuMois } = dateDjibouti();
  const genereLe = new Date();
  const rapports = await chargerRapportsImpayes(session.user.tenantId, annee, mois, siteIds);
  if (rapports.length === 0) {
    return NextResponse.json({ error: "Aucun site à rapporter" }, { status: 404 });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: session.user.tenantId }, select: { name: true } });
  const ecole = tenant?.name ?? "Établissement";
  const pdfs = [];
  for (const rapport of rapports) pdfs.push(await genererPdfImpayes({ ecole, rapport, annee, mois, genereLe }));

  let sortie = pdfs[0];
  if (pdfs.length > 1) {
    const fusion = await PDFDocument.create();
    for (const octets of pdfs) {
      const src = await PDFDocument.load(octets);
      (await fusion.copyPages(src, src.getPageIndices())).forEach((p) => fusion.addPage(p));
    }
    sortie = await fusion.save();
  }

  const jour = `${annee}-${String(mois).padStart(2, "0")}-${String(jourDuMois).padStart(2, "0")}`;
  return new NextResponse(Buffer.from(sortie), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="impayes-${jour}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
