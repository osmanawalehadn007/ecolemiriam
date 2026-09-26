import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { getAnneeCourante } from "@/lib/annee-scolaire";
import { genererMensualitesPourTenant } from "@/lib/factures/mensualites";

/**
 * Cron — Génération automatique des factures de scolarité du mois.
 * ============================================================
 * À déclencher LE 1ER DE CHAQUE MOIS par un ordonnanceur (cron systemd du
 * conteneur, Cloudflare Worker Cron, cron-job.org, GitHub Actions…).
 * Protégé par CRON_SECRET : `Authorization: Bearer <CRON_SECRET>`.
 *
 * Les factures sont créées au statut EN_ATTENTE (impayée) et le restent
 * jusqu'à l'encaissement complet. L'appel est IDEMPOTENT : rejouer le cron ne
 * crée jamais de doublon (le libellé « Scolarité <Mois> <Année> » sert de clé).
 *
 * Paramètres optionnels (query string) :
 *   ?mois=9            mois à facturer (défaut : mois courant)
 *   ?annee=2026-2027   année scolaire (défaut : année active de l'établissement)
 *   ?tenantId=...      ne traiter qu'un établissement
 *   ?cantine=1         inclure les frais de cantine
 *   ?transport=1       inclure les frais de transport
 *   ?dry=1             simulation : calcule sans rien écrire
 *
 * Mise en place (exemple crontab de l'hôte) :
 *   0 6 1 * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
 *              https://<domaine>/api/cron/facturation-mensuelle
 */
async function handler(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization");

  if (!secret || provided !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const maintenant = new Date();
  const mois = searchParams.get("mois")
    ? parseInt(searchParams.get("mois") as string, 10)
    : maintenant.getMonth() + 1;
  const anneeForcee = searchParams.get("annee");
  const tenantIdFiltre = searchParams.get("tenantId");
  const inclureCantine = searchParams.get("cantine") === "1";
  const inclureTransport = searchParams.get("transport") === "1";
  const dryRun = searchParams.get("dry") === "1";

  if (!Number.isInteger(mois) || mois < 1 || mois > 12) {
    return NextResponse.json({ error: "Paramètre `mois` invalide (1 à 12)" }, { status: 400 });
  }

  // eslint-disable-next-line ecolpro/require-tenant-id -- cron cross-tenant : parcourt les établissements (tenantId posé explicitement sur chaque requête ensuite), protégé par CRON_SECRET
  const tenants = await prisma.tenant.findMany({
    where: tenantIdFiltre ? { id: tenantIdFiltre } : {},
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const resultats: Array<{
    tenantId: string;
    tenant: string;
    annee: string | null;
    generated?: number;
    skipped?: number;
    sansTarif?: number;
    montantTotal?: number;
    erreur?: string;
  }> = [];

  for (const tenant of tenants) {
    let annee = anneeForcee;
    if (!annee) {
      const active = await getAnneeCourante(tenant.id);
      annee = active?.libelle ?? null;
    }

    if (!annee) {
      // Sans année scolaire active, la grille tarifaire n'est pas identifiable :
      // on n'invente pas de montant.
      resultats.push({
        tenantId: tenant.id,
        tenant: tenant.name,
        annee: null,
        erreur: "Aucune année scolaire active",
      });
      continue;
    }

    try {
      if (dryRun) {
        resultats.push({ tenantId: tenant.id, tenant: tenant.name, annee, generated: 0, skipped: 0, sansTarif: 0, montantTotal: 0 });
        continue;
      }

      const resultat = await genererMensualitesPourTenant({
        tenantId: tenant.id,
        mois,
        annee,
        inclureCantine,
        inclureTransport,
        acteurId: null, // tâche planifiée : aucune session utilisateur
      });
      resultats.push({ tenantId: tenant.id, tenant: tenant.name, annee, ...resultat });
    } catch (err) {
      console.error(`[Cron] Échec génération mensualités (tenant ${tenant.id}):`, err);
      resultats.push({
        tenantId: tenant.id,
        tenant: tenant.name,
        annee,
        erreur: err instanceof Error ? err.message : "Erreur inconnue",
      });
    }
  }

  if (!dryRun && resultats.some((r) => (r.generated ?? 0) > 0)) {
    revalidatePath("/facturation");
    revalidateTag("dashboard-data");
  }

  return NextResponse.json({
    mois,
    inclureCantine,
    inclureTransport,
    dryRun,
    totalGenerated: resultats.reduce((s, r) => s + (r.generated ?? 0), 0),
    resultats,
  });
}

export const GET = handler;
export const POST = handler;
