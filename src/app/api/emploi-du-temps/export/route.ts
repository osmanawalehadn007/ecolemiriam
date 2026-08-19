import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import { siteFilterForRelation } from "@/lib/site-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import ExcelJS from "exceljs";

/**
 * GET /api/emploi-du-temps/export?classeId=...&enseignantId=...&format=excel
 *
 * Export Excel de l'emploi du temps par classe ou par enseignant.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const denied = checkPermission(session.user.role, "emploi-du-temps:read");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const classeId = searchParams.get("classeId");
  const enseignantId = searchParams.get("enseignantId");
  const format = searchParams.get("format") ?? "excel";

  if (!classeId && !enseignantId) {
    return NextResponse.json({ error: "classeId ou enseignantId requis" }, { status: 400 });
  }

  const tenantId = session.user.tenantId;
  const annee = await getAnneeCouranteLibelle(tenantId);
  const emploiFilter = siteFilterForRelation(session.user, "classe");

  const where: Record<string, unknown> = {
    tenantId,
    ...emploiFilter,
    ...(annee ? { annee } : {}),
  };
  if (classeId) where.classeId = classeId;
  if (enseignantId) where.enseignantId = enseignantId;

  const emplois = await prisma.emploiTemps.findMany({
    where,
    include: {
      matiere: { select: { nom: true, code: true, couleur: true } },
      classe: { select: { nom: true } },
      enseignant: { include: { user: { select: { name: true } } } },
    },
    orderBy: [{ jour: "asc" }, { heureDebut: "asc" }],
  });

  if (emplois.length === 0) {
    return NextResponse.json({ error: "Aucun créneau trouvé" }, { status: 404 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true },
  });
  const ecoleNom = tenant?.name ?? "EcolPro";

  // Organiser par jour
  const jours = ["DIMANCHE", "LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI"];
  const jourLabels: Record<string, string> = {
    DIMANCHE: "Dimanche", LUNDI: "Lundi", MARDI: "Mardi", MERCREDI: "Mercredi",
    JEUDI: "Jeudi", VENDREDI: "Vendredi", SAMEDI: "Samedi",
  };

  const parJour: Record<string, typeof emplois> = {};
  for (const j of jours) parJour[j] = [];
  for (const e of emplois) {
    if (parJour[e.jour]) parJour[e.jour].push(e);
  }

  // Titre du document
  let titre = "Emploi du temps";
  if (classeId) titre += ` - ${emplois[0].classe.nom}`;
  if (enseignantId) titre += ` - ${emplois[0].enseignant?.user.name ?? "Enseignant"}`;
  titre += ` (${annee ?? "Année courante"})`;

  // Générer Excel
  const wb = new ExcelJS.Workbook();
  wb.creator = ecoleNom;
  wb.created = new Date();
  const ws = wb.addWorksheet("Emploi du temps", {
    views: [{ state: "frozen", ySplit: 2 }],
  });

  // En-tête
  ws.mergeCells("A1:G1");
  const titleCell = ws.getCell("A1");
  titleCell.value = titre;
  titleCell.font = { size: 14, bold: true };
  titleCell.alignment = { horizontal: "center" };

  // Colonnes
  ws.columns = [
    { header: "Jour", key: "jour", width: 14 },
    { header: "Heure début", key: "heureDebut", width: 12 },
    { header: "Heure fin", key: "heureFin", width: 12 },
    { header: "Matière", key: "matiere", width: 20 },
    { header: "Classe", key: "classe", width: 15 },
    { header: "Enseignant", key: "enseignant", width: 20 },
    { header: "Salle", key: "salle", width: 12 },
  ];

  // Style header
  ws.getRow(2).font = { bold: true };
  ws.getRow(2).fill = {
    type: "pattern", pattern: "solid",
    fgColor: { argb: "FF6366F1" },
  };
  ws.getRow(2).font = { bold: true, color: { argb: "FFFFFFFF" } };

  // Données
  for (const jour of jours) {
    const creneaux = parJour[jour];
    if (creneaux.length === 0) continue;
    for (const c of creneaux) {
      ws.addRow({
        jour: jourLabels[jour],
        heureDebut: c.heureDebut,
        heureFin: c.heureFin,
        matiere: c.matiere.nom,
        classe: c.classe.nom,
        enseignant: c.enseignant?.user.name ?? "—",
        salle: c.salle ?? "—",
      });
    }
  }

  // Bordures
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin" }, left: { style: "thin" },
        bottom: { style: "thin" }, right: { style: "thin" },
      };
    });
  });

  // Grouper par jour visuellement
  let prevJour = "";
  ws.eachRow((row, rowNum) => {
    if (rowNum <= 2) return;
    const jourVal = row.getCell(1).value;
    if (jourVal === prevJour) {
      row.getCell(1).value = "";
    } else {
      row.getCell(1).font = { bold: true };
      prevJour = jourVal as string;
    }
  });

  const buffer = await wb.xlsx.writeBuffer();

  const filename = encodeURIComponent(
    `emploi-du-temps-${classeId ? emplois[0].classe.nom : "enseignant"}-${annee ?? ""}.xlsx`
  );

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
