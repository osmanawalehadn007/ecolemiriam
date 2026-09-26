import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { alerterImpayes } from "@/lib/factures/impayes";

/**
 * Cron — Alerte « factures impayées » au responsable.
 * ============================================================
 * À déclencher LE 15 DE CHAQUE MOIS par un ordonnanceur (cron systemd du
 * conteneur, Cloudflare Worker Cron, cron-job.org, GitHub Actions…).
 * Protégé par CRON_SECRET : `Authorization: Bearer <CRON_SECRET>`.
 *
 * Envoie à l'administration et au gestionnaire de l'établissement (rôles
 * TENANT_ADMIN, PRINCIPAL, ACCOUNTANT, plus les adresses listées dans
 * ALERTE_IMPAYES_DESTINATAIRES) l'état des factures non encaissées, puis
 * journalise l'alerte dans les logs d'audit.
 *
 * Paramètres optionnels (query string) :
 *   ?tenantId=...   ne traiter qu'un établissement
 *   ?dry=1          n'envoie rien, renvoie seulement l'état calculé
 *
 * Mise en place (exemple crontab de l'hôte) :
 *   0 7 15 * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
 *               https://<domaine>/api/cron/alerte-impayes
 */
async function handler(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization");

  if (!secret || provided !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const tenantIdFiltre = searchParams.get("tenantId");
  const dryRun = searchParams.get("dry") === "1";

  // eslint-disable-next-line ecolpro/require-tenant-id -- cron cross-tenant : parcourt les établissements (tenantId posé explicitement sur chaque requête ensuite), protégé par CRON_SECRET
  const tenants = await prisma.tenant.findMany({
    where: tenantIdFiltre ? { id: tenantIdFiltre } : {},
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const resultats: Array<{
    tenantId: string;
    tenant: string;
    mois: string;
    nbImpayesMois: number;
    montantRestantMois: number;
    nbImpayesTotal: number;
    montantRestantTotal: number;
    destinataires: number;
    emailEnvoye: boolean;
    erreurEmail?: string;
    erreur?: string;
  }> = [];

  for (const tenant of tenants) {
    try {
      const resultat = await alerterImpayes({ tenantId: tenant.id, sansEnvoi: dryRun });
      resultats.push({
        tenantId: tenant.id,
        tenant: tenant.name,
        mois: resultat.libelleMois,
        nbImpayesMois: resultat.statsMois.nbFactures,
        montantRestantMois: resultat.statsMois.montantRestant,
        nbImpayesTotal: resultat.statsGlobal.nbFactures,
        montantRestantTotal: resultat.statsGlobal.montantRestant,
        destinataires: resultat.destinataires.length,
        emailEnvoye: resultat.emailEnvoye,
        erreurEmail: resultat.erreurEmail,
      });
    } catch (err) {
      console.error(`[Cron] Échec alerte impayés (tenant ${tenant.id}):`, err);
      resultats.push({
        tenantId: tenant.id,
        tenant: tenant.name,
        mois: "",
        nbImpayesMois: 0,
        montantRestantMois: 0,
        nbImpayesTotal: 0,
        montantRestantTotal: 0,
        destinataires: 0,
        emailEnvoye: false,
        erreur: err instanceof Error ? err.message : "Erreur inconnue",
      });
    }
  }

  return NextResponse.json({
    dryRun,
    // L'alerte ne part que s'il reste des impayés sur le mois en cours.
    totalImpayesMois: resultats.reduce((s, r) => s + r.nbImpayesMois, 0),
    emailsEnvoyes: resultats.filter((r) => r.emailEnvoye).length,
    resultats,
  });
}

export const GET = handler;
export const POST = handler;
