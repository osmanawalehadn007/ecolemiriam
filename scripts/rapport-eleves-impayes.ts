import { PrismaClient } from "@prisma/client";
import { PDFDocument, rgb, StandardFonts } from "pdfkit";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();
const OUTPUT_DIR = path.resolve("./tmp/rapports-impayes");

const MOIS_NOMS = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

async function main() {
  const maintenant = new Date();
  const mois = parseInt(process.argv.find((a) => a.startsWith("--mois="))?.split("=")[1] ?? String(maintenant.getMonth() + 1), 10);
  const annee = parseInt(process.argv.find((a) => a.startsWith("--annee="))?.split("=")[1] ?? String(maintenant.getFullYear()), 10);

  if (mois < 1 || mois > 12) {
    console.error("--mois doit être compris entre 1 et 12");
    process.exit(2);
  }

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const tenants = await prisma.tenant.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, slug: true },
  });

  for (const tenant of tenants) {
    genererPDFparTenant(tenant, mois, annee);
  }

  await prisma.$disconnect();
}

async function genererPDFparTenant(tenant: { id: string; name: string; slug: string }, mois: number, annee: number) {
  const moisNom = MOIS_NOMS[mois - 1];
  const cleMois = `${annee}-${String(mois).padStart(2, "0")}`;
  console.log(`  Traitant ${tenant.name}...`);

  const eleves = await prisma.eleve.findMany({
    where: {
      tenantId: tenant.id,
      statut: "ACTIF",
      deletedAt: null,
    },
    include: {
      classe: {
        select: { id: true, nom: true, niveau: true },
      },
      site: {
        select: { id: true, nom: true },
      },
    },
    orderBy: [
      { classe: { nom: "asc" } },
      { nom: "asc" },
    ],
  });

  const facturesMois = await prisma.facture.findMany({
    where: {
      tenantId: tenant.id,
      type: "MENSUALITE",
      mois: cleMois,
      statut: { not: "PAYEE" },
    },
    include: {
      eleve: {
        select: { id: true, nom: true, prenom: true, siteId: true, classeId: true },
      },
    },
  });

  const eleveIdsImpayes = new Set();
  const elevesImpayesMap = new Map();

  for (const f of facturesMois) {
    if (f.eleve && !eleveIdsImpayes.has(f.eleve.id)) {
      eleveIdsImpayes.add(f.eleve.id);
      elevesImpayesMap.set(f.eleve.id, {
        facture: f,
        classe: eleves.find((e) => e.id === f.eleve.id)?.classe || null,
        site: f.eleve.site || null,
      });
    }
  }

  const facturesAnnee = await prisma.facture.findMany({
    where: {
      tenantId: tenant.id,
      type: "MENSUALITE",
      statut: { not: "PAYEE" },
    },
    include: {
      eleve: {
        select: { id: true, nom: true, prenom: true, classe: { select: { nom: true, niveau: true } } },
      },
    },
  });

  const totalImpayeParEleve = new Map<string, { total: number; details: Array<{ mois: string; montant: number }> }>();

  for (const f of facturesAnnee) {
    if (!totalImpayeParEleve.has(f.eleveId)) {
      totalImpayeParEleve.set(f.eleveId, { total: 0, details: [] });
    }
    const entry = totalImpayeParEleve.get(f.eleveId)!;
    entry.total += f.montant || 0;
    entry.details.push({ mois: f.mois || "", montant: f.montant || 0 });
  }

  genererContenuPDF(OUTPUT_DIR, tenant, mois, annee, eleves, elevesImpayesMap, totalImpayeParEleve);
}

async function genererContenuPDF(
  dir: string,
  tenant: { id: string; name: string; slug: string },
  mois: number,
  annee: number,
  eleves: any[],
  elevesImpayesMap: Map<any, { facture: any; classe: any; site: any }>,
  totalImpayeParEleve: Map<string, { total: number; details: Array<{ mois: string; montant: number }> }>
) {
  const moisNom = MOIS_NOMS[mois - 1];
  const chemin = path.join(dir, `impayes-${tenant.slug}-${annee}-${String(mois).padStart(2, "0")}.pdf`);

  const doc = new PDFDocument({ margin: 40, size: "A4" });
  const out = fs.createWriteStream(chemin);
  doc.pipe(out);

  doc.fontSize(20).text(`Ecole ${tenant.name}`, { underline: true });
  doc.fontSize(13).text(`Rapport mensualités impayées - ${moisNom} ${annee}`, { underline: false });
  doc.moveDown(2);

  doc.fontSize(10).text(`Période : ${moisNom} ${annee} | Élèves status: ACTIF | Factures non payées`);
  doc.moveDown(1);

  const elevesImpayes = Array.from(elevesImpayesMap.values())
    .filter((e: any) => e.classe)
    .sort((a: any, b: any) => (a.classe?.nom || "").localeCompare(b.classe?.nom || ""));

  if (elevesImpayes.length === 0) {
    doc.text("Aucun élève n'a de mensualité impayée pour ce mois.", { indent: 20 });
    doc.end();
    console.log("  -> Aucun élève impayé");
    return;
  }

  let classeCourante = "";
  for (const eleve of elevesImpayes) {
    const nomClasse = eleve.classe?.nom || "Inconnue";

    if (nomClasse !== classeCourante) {
      classeCourante = nomClasse;
      doc.fontSize(13).text(nomClasse, { underline: true, margin: 20 });
      doc.moveDown(0.5);
      doc.fontSize(9).text(`Niveau : ${eleve.classe?.niveau || "Non défini"}`, { margin: 20 });
      doc.moveDown(2);

      doc.fontSize(8).text(
        "Élève" + "               ".slice(0, 15) +
        "Montant du mois" + "            ".slice(0, 15) +
        "Total année" + "               ".slice(0, 15) +
        "Statut",
        { indent: 20 }
      );
      doc.moveDown(0.3);
      doc.fontSize(8).text(
        "-".repeat(50) + "-".repeat(20) + "-".repeat(20) + "-".repeat(15),
        { indent: 20 }
      );
      doc.moveDown(1);
    }

    const eleveData = eleves.find((e: any) => e.id === eleve.facture.eleveId);
    const pleinNom = `${eleveData?.prenom || ""} ${eleveData?.nom || ""}`.trim() || "Inconnu";
    const montantMois = eleve.facture.montant || 0;
    const totalAnnee = totalImpayeParEleve.get(eleve.facture.eleveId)?.total || 0;
    const statut = eleve.facture.statut || "EN_ATTENTE";

    doc.fontSize(8).text(
      pleinNom.padEnd(30) +
      `${montantMois}`.padEnd(15) +
      `${totalAnnee}`.padEnd(15) +
      statut,
      { indent: 20 }
    );
  }

  doc.end();
}

main().catch((e) => {
  console.error("Erreur fatale :", e);
  process.exit(1);
});