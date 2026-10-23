import { NextRequest, NextResponse } from "next/server";
import { refuserSiNonAutorise, pourChaqueTenant, dateDjibouti } from "@/lib/cron";
import { chargerRapportsImpayes } from "@/lib/rapports/impayes";
import { genererPdfImpayes, MOIS_NOMS } from "@/lib/rapports/impayes-pdf";

/**
 * Cron — Rapport mensuel des mensualités impayées (un PDF par site).
 * ============================================================
 * À déclencher LE 10 DE CHAQUE MOIS (workflow `rapport-impayes.yml`).
 * Protégé par CRON_SECRET : `Authorization: Bearer <CRON_SECRET>`.
 *
 * Lecture seule : rien n'est écrit en base, rejouer est sans effet de bord.
 * Chaque PDF liste, par structure puis par classe, les élèves actifs qui n'ont
 * pas soldé leurs mensualités, avec l'impayé du mois et le cumul de l'année
 * scolaire. Les PDF sont renvoyés en base64 dans la réponse JSON : le conteneur
 * n'a pas de stockage durable où les déposer, c'est le workflow qui les récupère.
 *
 * Paramètres optionnels (query string) :
 *   ?mois=10&annee=2026   mois civil du rapport (défaut : aujourd'hui, heure de Djibouti)
 *   ?siteId=...           ne traiter qu'un site
 *   ?resume=1             comptes et totaux seulement, sans les PDF
 */
async function handler(req: NextRequest) {
  const refus = refuserSiNonAutorise(req);
  if (refus) return refus;

  const { searchParams } = new URL(req.url);
  const aujourdhui = dateDjibouti();
  const mois = searchParams.get("mois") ? parseInt(searchParams.get("mois")!, 10) : aujourdhui.mois;
  const annee = searchParams.get("annee") ? parseInt(searchParams.get("annee")!, 10) : aujourdhui.annee;
  const siteId = searchParams.get("siteId");
  const resume = searchParams.get("resume") === "1";

  if (!Number.isInteger(mois) || mois < 1 || mois > 12) {
    return NextResponse.json({ error: "Paramètre `mois` invalide (1 à 12)" }, { status: 400 });
  }
  if (!Number.isInteger(annee) || annee < 2000 || annee > 2100) {
    return NextResponse.json({ error: "Paramètre `annee` invalide (année civile, ex. 2026)" }, { status: 400 });
  }

  const genereLe = new Date();
  const parTenant = await pourChaqueTenant(async (tenant) => {
    const rapports = await chargerRapportsImpayes(tenant.id, annee, mois, siteId ? [siteId] : null);
    const sorties = [];
    for (const rapport of rapports) {
      const pdf = resume ? null : await genererPdfImpayes({ ecole: tenant.name, rapport, annee, mois, genereLe });
      const slug = `${tenant.name} ${rapport.siteNom}`.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "site";
      sorties.push({
        siteId: rapport.siteId,
        site: rapport.siteNom,
        fichier: `impayes-${slug}-${annee}-${String(mois).padStart(2, "0")}.pdf`,
        eleves: rapport.nbEleves,
        totalMois: rapport.totalMois,
        totalAnnee: rapport.totalAnnee,
        ...(pdf && { pdfBase64: Buffer.from(pdf).toString("base64") }),
      });
    }
    return sorties;
  });

  const erreurs = parTenant.filter((r) => !r.ok);
  const rapports = parTenant.flatMap((r) => (r.ok ? r.resultat.map((s) => ({ tenantId: r.tenantId, ...s })) : []));

  return NextResponse.json(
    {
      periode: `${MOIS_NOMS[mois - 1]} ${annee}`,
      rapports,
      ...(erreurs.length > 0 && { erreurs }),
    },
    { status: erreurs.length > 0 ? 500 : 200 },
  );
}

export const GET = handler;
export const POST = handler;
