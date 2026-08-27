import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import { siteFilterForModel } from "@/lib/site-scope";
import {
  startOfDay, endOfDay, startOfMonth, endOfMonth, startOfYear, endOfYear,
  startOfWeek, endOfWeek, subMonths, format,
} from "date-fns";

/**
 * GET /api/finances/comptabilite?periode=month|year|all&date=2025-01
 *
 * Comptabilité simplifiée :
 * - Journal des recettes (paiements)
 * - Journal des dépenses
 * - Compte de résultat (recettes - dépenses)
 * - Bilan par catégorie
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const denied = checkPermission(session.user.role, "finance:read");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const periode = searchParams.get("periode") ?? "month";
  const dateStr = searchParams.get("date");

  const now = new Date();
  let dateStart: Date;
  let dateEnd: Date;

  if (dateStr) {
    const ref = new Date(dateStr);
    if (periode === "year") {
      dateStart = startOfYear(ref);
      dateEnd = endOfYear(ref);
    } else if (periode === "all") {
      dateStart = new Date(2000, 0, 1);
      dateEnd = endOfDay(now);
    } else {
      dateStart = startOfMonth(ref);
      dateEnd = endOfMonth(ref);
    }
  } else {
    if (periode === "year") {
      dateStart = startOfYear(now);
      dateEnd = endOfYear(now);
    } else if (periode === "all") {
      dateStart = new Date(2000, 0, 1);
      dateEnd = endOfDay(now);
    } else {
      dateStart = startOfMonth(now);
      dateEnd = endOfMonth(now);
    }
  }

  const tenantId = session.user.tenantId;
  const paiementFilter = { facture: { tenantId, ...siteFilterForModel("facture", session.user) } };
  const depenseFilter = { tenantId, ...siteFilterForModel("depense", session.user) };

  // 1. Recettes (paiements)
  // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId déjà dans le where (le linter ne détecte pas le spread/merge)
  const paiements = await prisma.paiement.findMany({
    where: {
      ...paiementFilter,
      date: { gte: dateStart, lte: dateEnd },
    },
    include: {
      facture: {
        select: {
          id: true, numero: true, eleve: { select: { nom: true, prenom: true } },
        },
      },
      enregistrePar: { select: { name: true } },
    },
    orderBy: { date: "desc" },
  });

  // 2. Dépenses
  const depenses = await prisma.depense.findMany({
    where: {
      ...depenseFilter,
      date: { gte: dateStart, lte: dateEnd },
    },
    include: {
      payePar: { select: { name: true } },
    },
    orderBy: { date: "desc" },
  });

  // 3. Totaux
  const totalRecettes = paiements.reduce((sum, p) => sum + p.montant, 0);
  const totalDepenses = depenses.reduce((sum, d) => sum + d.montant, 0);
  const resultat = totalRecettes - totalDepenses;

  // 4. Recettes par méthode
  const recettesParMethode: Record<string, number> = {};
  for (const p of paiements) {
    recettesParMethode[p.methode] = (recettesParMethode[p.methode] ?? 0) + p.montant;
  }

  // 5. Dépenses par catégorie
  const depensesParCategorie: Record<string, number> = {};
  for (const d of depenses) {
    depensesParCategorie[d.categorie] = (depensesParCategorie[d.categorie] ?? 0) + d.montant;
  }

  // 6. Évolution mensuelle (6 derniers mois)
  const evolution: Array<{ mois: string; recettes: number; depenses: number; resultat: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const mStart = startOfMonth(subMonths(now, i));
    const mEnd = endOfMonth(subMonths(now, i));
    // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId déjà dans le where (le linter ne détecte pas le spread/merge)
    const mPaiements = await prisma.paiement.aggregate({
      where: { ...paiementFilter, date: { gte: mStart, lte: mEnd } },
      _sum: { montant: true },
    });
    const mDepenses = await prisma.depense.aggregate({
      where: { ...depenseFilter, date: { gte: mStart, lte: mEnd } },
      _sum: { montant: true },
    });
    const recettes = mPaiements._sum.montant ?? 0;
    const dep = mDepenses._sum.montant ?? 0;
    evolution.push({
      mois: format(mStart, "MMM yyyy"),
      recettes,
      depenses: dep,
      resultat: recettes - dep,
    });
  }

  // 7. Journal combiné (recettes + dépenses triées par date)
  const journal = [
    ...paiements.map((p) => ({
      type: "RECETTE" as const,
      date: p.date,
      montant: p.montant,
      devise: p.devise,
      description: `Paiement ${p.facture.numero} - ${p.facture.eleve?.prenom ?? ""} ${p.facture.eleve?.nom ?? ""}`,
      categorie: p.methode,
      reference: p.reference ?? null,
      operateur: p.enregistrePar?.name ?? null,
    })),
    ...depenses.map((d) => ({
      type: "DEPENSE" as const,
      date: d.date,
      montant: d.montant,
      devise: d.devise,
      description: d.description ?? d.categorie,
      categorie: d.categorie,
      reference: d.fournisseur ?? null,
      operateur: d.payePar?.name ?? null,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  return NextResponse.json({
    periode: { start: dateStart, end: dateEnd, label: periode },
    totalRecettes,
    totalDepenses,
    resultat,
    recettesParMethode,
    depensesParCategorie,
    evolution,
    journal,
    nbRecettes: paiements.length,
    nbDepenses: depenses.length,
  });
}
