import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import { siteFilterForModel } from "@/lib/site-scope";
import { getSitesForUser } from "@/lib/actions/eleve";
import ExcelJS from "exceljs";
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
} from "date-fns";

type Periode = "today" | "week" | "month" | "semester" | "year";

function getPeriodRange(periode: Periode) {
  const today = new Date();
  switch (periode) {
    case "today":
      return { start: startOfDay(today), end: endOfDay(today) };
    case "week":
      return { start: startOfWeek(today, { weekStartsOn: 1 }), end: endOfWeek(today, { weekStartsOn: 1 }) };
    case "month":
      return { start: startOfMonth(today), end: endOfMonth(today) };
    case "semester":
      if (today.getMonth() < 6) {
        return { start: startOfYear(today), end: new Date(today.getFullYear(), 5, 30, 23, 59, 59, 999) };
      }
      return { start: new Date(today.getFullYear(), 6, 1), end: endOfYear(today) };
    case "year":
    default:
      return { start: startOfYear(today), end: endOfYear(today) };
  }
}

function formatCurrency(value: number, devise: string) {
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: devise,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${value} ${devise}`;
  }
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const denied = checkPermission(session.user.role, "finance:read");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const siteId = searchParams.get("siteId") || "all";
  const periode = (searchParams.get("periode") as Periode) || "month";
  const { start, end } = getPeriodRange(periode);

  const validSites = await getSitesForUser();
  const activeSite = siteId === "all" || validSites.some((s) => s.id === siteId) ? siteId : "all";

  const financeClaims = {
    ...session.user,
    siteId: activeSite === "all" ? null : activeSite,
  };

  const factureFilter = siteFilterForModel("facture", financeClaims);
  const depenseFilter = siteFilterForModel("depense", financeClaims);
  const budgetFilter = siteFilterForModel("budget", financeClaims);

  const [totalEncaisse, totalFactures, totalDepenses, paiements, depenses, budgets] = await Promise.all([
    prisma.paiement.aggregate({ _sum: { montant: true }, where: { date: { gte: start, lte: end }, facture: { tenantId: session.user.tenantId, ...factureFilter } } }),
    prisma.facture.aggregate({ _sum: { montant: true }, where: { tenantId: session.user.tenantId, ...factureFilter } }),
    prisma.depense.aggregate({ _sum: { montant: true }, where: { tenantId: session.user.tenantId, ...depenseFilter, date: { gte: start, lte: end } } }),
    prisma.paiement.findMany({
      where: { date: { gte: start, lte: end }, facture: { tenantId: session.user.tenantId, ...factureFilter } },
      include: { facture: { select: { numero: true, eleve: { select: { nom: true, prenom: true } } } } },
      orderBy: { date: "desc" },
    }),
    prisma.depense.findMany({
      where: { tenantId: session.user.tenantId, ...depenseFilter, date: { gte: start, lte: end } },
      include: { createdBy: { select: { name: true } } },
      orderBy: { date: "desc" },
    }),
    prisma.budget.findMany({
      where: { tenantId: session.user.tenantId, ...budgetFilter },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const currency = "DJF";
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  wb.title = "Finances";

  const summary = wb.addWorksheet("Synthèse");
  summary.columns = [{ width: 35 }, { width: 20 }];
  summary.addRow(["Période", periode]);
  summary.addRow(["Site", activeSite === "all" ? "Tous les sites" : (validSites.find((s) => s.id === activeSite)?.nom ?? activeSite)]);
  summary.addRow([]);
  summary.addRow(["Total facturé", formatCurrency(totalFactures._sum.montant ?? 0, currency)]);
  summary.addRow(["Total encaissé", formatCurrency(totalEncaisse._sum.montant ?? 0, currency)]);
  summary.addRow(["Reste à encaisser", formatCurrency((totalFactures._sum.montant ?? 0) - (totalEncaisse._sum.montant ?? 0), currency)]);
  summary.addRow(["Dépenses de la période", formatCurrency(totalDepenses._sum.montant ?? 0, currency)]);
  summary.addRow(["Solde trésorerie (encaisse - dépenses)", formatCurrency((totalEncaisse._sum.montant ?? 0) - (totalDepenses._sum.montant ?? 0), currency)]);

  const encaissements = wb.addWorksheet("Encaissements");
  encaissements.columns = [
    { header: "Date", key: "date", width: 15 },
    { header: "Élève", key: "eleve", width: 25 },
    { header: "Facture", key: "facture", width: 18 },
    { header: "Méthode", key: "methode", width: 15 },
    { header: "Montant", key: "montant", width: 15 },
  ];
  encaissements.addRows(
    paiements.map((p) => ({
      date: p.date.toISOString().split("T")[0],
      eleve: p.facture.eleve ? `${p.facture.eleve.prenom ? `${p.facture.eleve.prenom} ` : ""}${p.facture.eleve.nom}` : "—",
      facture: p.facture.numero,
      methode: p.methode,
      montant: p.montant,
    }))
  );

  const depensesSheet = wb.addWorksheet("Dépenses");
  depensesSheet.columns = [
    { header: "Date", key: "date", width: 15 },
    { header: "Catégorie", key: "categorie", width: 20 },
    { header: "Fournisseur", key: "fournisseur", width: 20 },
    { header: "Description", key: "description", width: 30 },
    { header: "Montant", key: "montant", width: 15 },
    { header: "Enregistré par", key: "par", width: 20 },
  ];
  depensesSheet.addRows(
    depenses.map((d) => ({
      date: d.date.toISOString().split("T")[0],
      categorie: d.categorie,
      fournisseur: d.fournisseur || "—",
      description: d.description || "—",
      montant: d.montant,
      par: d.createdBy?.name || "—",
    }))
  );

  const budgetSheet = wb.addWorksheet("Budget");
  budgetSheet.columns = [
    { header: "Catégorie", key: "categorie", width: 20 },
    { header: "Période", key: "periode", width: 15 },
    { header: "Montant prévu", key: "prevp", width: 18 },
  ];
  budgetSheet.addRows(
    budgets.map((b) => ({
      categorie: b.categorie,
      periode: b.periode,
      prevp: b.montantPrevu,
    }))
  );

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `finances_${periode}_${activeSite}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
