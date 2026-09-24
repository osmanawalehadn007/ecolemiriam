/**
 * Script de génération de documents de démonstration (bulletin, facture, attestation)
 * avec le logo de l'établissement.
 *
 * Crée les données de test nécessaires (période, notes, bulletins) puis génère
 * trois fichiers HTML ouverts dans le navigateur.
 */
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const DIRECT_URL =
  "postgresql://ecolemiriam_owner:8D5NC8kgQwOFficKddABfHJ6JwE1dp6E@127.0.0.1:15432/ecolemiriam?connect_timeout=15";
const prisma = new PrismaClient({ datasources: { db: { url: DIRECT_URL } } });

const TENANT_ID = "cms8kt0b40001zbi3o63y7c5v";
const OUTPUT_DIR = "/tmp/ecolpro-documents";

function fmt(v) {
  return v !== null && v !== undefined ? v.toFixed(2) : "—";
}
function getOrdinal(n) {
  if (!n) return "—";
  return n === 1 ? "1er" : `${n}e`;
}
function formatDateFr(date) {
  if (!date) return "—";
  const d = new Date(date);
  return d.toLocaleDateString("fr-FR");
}
function formatMoney(amount, devise) {
  try {
    return new Intl.NumberFormat("fr-DJ", {
      style: "currency",
      currency: devise,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("fr-DJ")} ${devise}`;
  }
}

async function main() {
  // ─── 0. Préparer le dossier de sortie ───
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // ─── 1. Récupérer le tenant (avec logo) ───
  const tenant = await prisma.tenant.findUnique({ where: { id: TENANT_ID } });
  if (!tenant) throw new Error("Tenant non trouvé");
  console.log("✓ Tenant:", tenant.name, "| logo:", tenant.logoUrl ? "OUI" : "NON");

  // ─── 2. Créer une période pour l'année courante ───
  const annee = await prisma.anneesScolaires.findFirst({
    where: { tenantId: TENANT_ID, isCurrent: true },
  });
  if (!annee) throw new Error("Aucune année scolaire active");

  // Supprimer ancienne période de test si elle existe
  const existingPeriode = await prisma.periode.findFirst({
    where: { anneeId: annee.id, nom: "Trimestre 1 (Demo)" },
  });
  if (existingPeriode) {
    // Supprimer les bulletins et notes liés
    await prisma.bulletinMatiere.deleteMany({
      where: { bulletin: { periodeId: existingPeriode.id } },
    });
    await prisma.bulletin.deleteMany({ where: { periodeId: existingPeriode.id } });
    await prisma.note.deleteMany({ where: { periodeId: existingPeriode.id } });
    await prisma.periode.delete({ where: { id: existingPeriode.id } });
  }

  const periode = await prisma.periode.create({
    data: {
      anneeId: annee.id,
      nom: "Trimestre 1 (Demo)",
      numero: 1,
      dateDebut: new Date("2026-09-01"),
      dateFin: new Date("2026-12-15"),
    },
  });
  console.log("✓ Période créée:", periode.nom);

  // ─── 3. Récupérer une classe et des élèves ───
  const classe = await prisma.classe.findFirst({
    where: { tenantId: TENANT_ID, nom: "8ème1" },
    include: { eleves: { where: { statut: "ACTIF" }, take: 5 } },
  });
  if (!classe) throw new Error("Classe 8ème1 non trouvée");
  console.log("✓ Classe:", classe.nom, "| élèves:", classe.eleves.length);

  // ─── 4. Récupérer des matières ───
  const matieres = await prisma.matiere.findMany({
    where: { tenantId: TENANT_ID },
    take: 5,
  });
  if (matieres.length < 4) throw new Error("Pas assez de matières");
  console.log("✓ Matières:", matieres.map((m) => m.nom).join(", "));

  // ─── 5. Créer des notes pour les élèves ───
  const notesData = [
    // élève 1 - bon élève
    { eleveIdx: 0, notes: [16, 14, 15, 17] },
    // élève 2 - moyen
    { eleveIdx: 1, notes: [12, 10, 11, 13] },
    // élève 3 - excellent
    { eleveIdx: 2, notes: [18, 17, 19, 16] },
    // élève 4 - passable
    { eleveIdx: 3, notes: [10, 11, 9, 12] },
    // élève 5 - faible
    { eleveIdx: 4, notes: [8, 7, 9, 10] },
  ];

  for (const nd of notesData) {
    const eleve = classe.eleves[nd.eleveIdx];
    if (!eleve) continue;
    for (let mi = 0; mi < 4; mi++) {
      const matiere = matieres[mi];
      // Créer 2 notes par matière (devoir + examen)
      for (let ni = 0; ni < 2; ni++) {
        const baseNote = nd.notes[mi];
        const variation = ni === 0 ? -1 : 2;
        const valeur = Math.max(0, Math.min(20, baseNote + variation));
        await prisma.note.create({
          data: {
            tenantId: TENANT_ID,
            eleveId: eleve.id,
            matiereId: matiere.id,
            classeId: classe.id,
            periodeId: periode.id,
            intitule: ni === 0 ? "Devoir n°1" : "Examen n°1",
            type: ni === 0 ? "DEVOIR" : "EXAMEN",
            valeur,
            noteMax: 20,
            coefficient: matiere.coefficient,
            isPubliee: true,
            date: new Date(2026, 8 + mi, 15),
          },
        });
      }
    }
  }
  console.log("✓ Notes créées pour 5 élèves × 4 matières × 2 notes");

  // ─── 6. Générer les bulletins (même logique que l'API generer) ───
  const allNotes = await prisma.note.findMany({
    where: { tenantId: TENANT_ID, classeId: classe.id, periodeId: periode.id, isPubliee: true },
    include: { matiere: true },
  });

  const matieresMap = new Map();
  const eleveMatiereMoyennes = {};
  const matiereStats = {};

  for (const note of allNotes) {
    if (!matieresMap.has(note.matiereId)) {
      matieresMap.set(note.matiereId, note.matiere);
      eleveMatiereMoyennes[note.matiereId] = {};
    }
  }

  for (const [matiereId, matiere] of matieresMap.entries()) {
    let max = -1, min = 21;
    for (const eleve of classe.eleves) {
      const notesEleve = allNotes.filter(
        (n) => n.eleveId === eleve.id && n.matiereId === matiereId
      );
      if (notesEleve.length > 0) {
        const moy =
          notesEleve.reduce((s, n) => s + (n.valeur / n.noteMax) * 20 * n.coefficient, 0) /
          notesEleve.reduce((s, n) => s + n.coefficient, 0);
        eleveMatiereMoyennes[matiereId][eleve.id] = Number(moy.toFixed(2));
        if (moy > max) max = moy;
        if (moy < min) min = moy;
      }
    }
    matiereStats[matiereId] = { max: max === -1 ? 0 : max, min: min === 21 ? 0 : min };
  }

  const bulletinsAverages = [];
  for (const eleve of classe.eleves) {
    let totalCoef = 0, totalPoints = 0;
    const matieresToSave = [];

    for (const [matiereId, matiere] of matieresMap.entries()) {
      const moy = eleveMatiereMoyennes[matiereId]?.[eleve.id] ?? null;
      if (moy !== null) {
        totalPoints += moy * matiere.coefficient;
        totalCoef += matiere.coefficient;
      }
      const allMoy = Object.values(eleveMatiereMoyennes[matiereId] || {}).sort((a, b) => b - a);
      const rang = moy !== null ? allMoy.indexOf(moy) + 1 : null;

      let appreciation = "Travail à évaluer.";
      if (moy !== null) {
        if (moy >= 18) appreciation = "Excellent. Résultats remarquables.";
        else if (moy >= 16) appreciation = "Très bons résultats. Élève sérieux.";
        else if (moy >= 14) appreciation = "Bons résultats. Peut encore progresser.";
        else if (moy >= 12) appreciation = "Résultats satisfaisants. Efforts attendus.";
        else if (moy >= 10) appreciation = "Résultats moyens. Travail plus régulier requis.";
        else if (moy >= 8) appreciation = "Résultats insuffisants. Suivi nécessaire.";
        else appreciation = "Résultats très insuffisants. Soutien recommandé.";
      }

      matieresToSave.push({
        matiereId,
        nomProfesseur: "Professeur",
        coefficient: matiere.coefficient,
        moyenneEleve: moy,
        rang,
        moyenneMax: matiereStats[matiereId].max,
        moyenneMin: matiereStats[matiereId].min,
        appreciation,
      });
    }

    const moyenneGenerale = totalCoef > 0 ? Number((totalPoints / totalCoef).toFixed(2)) : null;
    let appreciationGen = "Travail à évaluer.";
    if (moyenneGenerale !== null) {
      if (moyenneGenerale >= 16) appreciationGen = "Excellent trimestre. Continuez ainsi.";
      else if (moyenneGenerale >= 14) appreciationGen = "Très bon trimestre.";
      else if (moyenneGenerale >= 12) appreciationGen = "Bon trimestre. Des efforts supplémentaires attendus.";
      else if (moyenneGenerale >= 10) appreciationGen = "Trimestre moyen. Un travail plus régulier s'impose.";
      else appreciationGen = "Trimestre insuffisant. Un soutien est recommandé.";
    }

    const bulletin = await prisma.bulletin.upsert({
      where: { eleveId_periodeId: { eleveId: eleve.id, periodeId: periode.id } },
      update: {
        moyenneGenerale,
        heuresAbsence: 0,
        appreciation: appreciationGen,
        effectifClasse: classe.eleves.length,
      },
      create: {
        tenantId: TENANT_ID,
        eleveId: eleve.id,
        periodeId: periode.id,
        moyenneGenerale,
        heuresAbsence: 0,
        appreciation: appreciationGen,
        effectifClasse: classe.eleves.length,
      },
    });

    await prisma.bulletinMatiere.deleteMany({
      where: { bulletinId: bulletin.id, tenantId: TENANT_ID },
    });
    if (matieresToSave.length > 0) {
      await prisma.bulletinMatiere.createMany({
        data: matieresToSave.map((m) => ({ ...m, bulletinId: bulletin.id, tenantId: TENANT_ID })),
      });
    }

    bulletinsAverages.push({ eleveId: eleve.id, moyenne: moyenneGenerale });
  }

  // Calculer les rangs
  const validMoyennes = bulletinsAverages
    .filter((b) => b.moyenne !== null)
    .map((b) => b.moyenne);
  const moyenneClasse =
    validMoyennes.length > 0
      ? Number((validMoyennes.reduce((a, b) => a + b, 0) / validMoyennes.length).toFixed(2))
      : null;
  const moyennePremier = validMoyennes.length > 0 ? Math.max(...validMoyennes) : null;

  bulletinsAverages.sort((a, b) => (b.moyenne ?? -1) - (a.moyenne ?? -1));
  for (let i = 0; i < bulletinsAverages.length; i++) {
    const b = bulletinsAverages[i];
    await prisma.bulletin.updateMany({
      where: { eleveId: b.eleveId, periodeId: periode.id, tenantId: TENANT_ID },
      data: { rang: b.moyenne !== null ? i + 1 : null, moyenneClasse, moyennePremier },
    });
  }
  console.log("✓ Bulletins générés pour", classe.eleves.length, "élèves");

  // ─── 7. Récupérer les données du bulletin du premier élève ───
  const eleve = classe.eleves[0];
  const bulletin = await prisma.bulletin.findFirst({
    where: { eleveId: eleve.id, periodeId: periode.id, tenantId: TENANT_ID },
    include: { matieres: { include: { matiere: true } } },
  });
  const notesEleve = await prisma.note.findMany({
    where: { eleveId: eleve.id, periodeId: periode.id, tenantId: TENANT_ID },
    include: { matiere: { select: { nom: true, code: true } } },
    orderBy: { date: "asc" },
  });

  const notesByMatiere = {};
  for (const n of notesEleve) {
    if (!notesByMatiere[n.matiereId]) notesByMatiere[n.matiereId] = [];
    notesByMatiere[n.matiereId].push({
      intitule: n.intitule ?? n.type,
      type: n.type,
      valeur: n.valeur,
      noteMax: n.noteMax,
      coefficient: n.coefficient,
      date: n.date,
    });
  }

  // Calculer la moyenne de classe par matière
  const classeEleves = await prisma.eleve.findMany({
    where: { classeId: classe.id, tenantId: TENANT_ID, statut: "ACTIF" },
    select: { id: true },
  });
  const allBulletinsMatieres = await prisma.bulletinMatiere.findMany({
    where: {
      tenantId: TENANT_ID,
      bulletin: {
        tenantId: TENANT_ID,
        periodeId: periode.id,
        eleveId: { in: classeEleves.map((e) => e.id) },
      },
    },
    select: { matiereId: true, moyenneEleve: true },
  });
  const moyenneClasseByMatiere = {};
  const matIds = [...new Set(allBulletinsMatieres.map((bm) => bm.matiereId))];
  for (const matId of matIds) {
    const moyennes = allBulletinsMatieres
      .filter((bm) => bm.matiereId === matId && bm.moyenneEleve !== null)
      .map((bm) => bm.moyenneEleve);
    moyenneClasseByMatiere[matId] =
      moyennes.length > 0
        ? Number((moyennes.reduce((a, b) => a + b, 0) / moyennes.length).toFixed(2))
        : null;
  }

  const notesMatiere = bulletin.matieres
    .map((bm) => ({
      matiereNom: bm.matiere.nom,
      matiereCode: bm.matiere.code,
      coefficient: bm.coefficient,
      moyenne: bm.moyenneEleve,
      moyenneClasse: moyenneClasseByMatiere[bm.matiereId] ?? null,
      rang: bm.rang,
      moyenneMax: bm.moyenneMax,
      moyenneMin: bm.moyenneMin,
      nomProfesseur: bm.nomProfesseur,
      appreciation: bm.appreciation,
      notesExamen: notesByMatiere[bm.matiereId] ?? [],
    }))
    .sort((a, b) => a.matiereNom.localeCompare(b.matiereNom));

  const bulletinData = {
    ecoleName: tenant.name,
    ecoleVille: tenant.city ?? "Ville",
    ecolePays: tenant.country,
    ecoleLogo: tenant.logoUrl,
    chefEtablissement: tenant.chefEtablissement,
    signatureUrl: tenant.signatureUrl,
    cachetUrl: tenant.cachetUrl,
    eleveNom: eleve.nom,
    elevePrenom: eleve.prenom,
    eleveMatricule: eleve.matricule,
    eleveClasse: classe.nom,
    eleveNiveau: classe.niveau,
    eleveSexe: eleve.sexe,
    eleveDateNaissance: eleve.dateNaissance,
    periodeNom: periode.nom,
    periodeNumero: periode.numero,
    annee: annee.libelle,
    notes: notesMatiere,
    moyenneGenerale: bulletin.moyenneGenerale,
    moyenneClasse: bulletin.moyenneClasse,
    moyennePremier: bulletin.moyennePremier,
    heuresAbsence: bulletin.heuresAbsence,
    rang: bulletin.rang,
    effectifClasse: bulletin.effectifClasse,
    appreciation: bulletin.appreciation,
    generatedAt: bulletin.createdAt,
  };

  console.log("✓ Données bulletin récupérées pour", eleve.nom, eleve.prenom);

  // ─── 8. Générer le HTML du bulletin ───
  const maxExamNotes = Math.max(...notesMatiere.map((n) => n.notesExamen.length), 0);
  const bulletinHtml = generateBulletinHTML(bulletinData, maxExamNotes);
  const bulletinPath = path.join(OUTPUT_DIR, "bulletin.html");
  fs.writeFileSync(bulletinPath, bulletinHtml);
  console.log("✓ Bulletin HTML:", bulletinPath);

  // ─── 9. Générer le HTML de la facture ───
  const facture = await prisma.facture.findFirst({
    where: { id: "cmtfe3ppq000dpa07i77bzfoj", tenantId: TENANT_ID },
    include: {
      eleve: {
        select: {
          id: true,
          nom: true,
          prenom: true,
          matricule: true,
          classe: { select: { nom: true, niveau: true } },
          parents: { include: { parent: true }, where: { isGardien: true }, take: 1 },
        },
      },
      tenant: true,
      paiements: { orderBy: { date: "desc" }, include: { enregistrePar: { select: { name: true } } } },
      createdBy: { select: { name: true } },
    },
  });

  if (facture) {
    const factureHtml = generateFactureHTML(facture, tenant);
    const facturePath = path.join(OUTPUT_DIR, "facture.html");
    fs.writeFileSync(facturePath, factureHtml);
    console.log("✓ Facture HTML:", facturePath);
  } else {
    console.log("⚠ Facture non trouvée, utilisation d'une facture de démonstration");
    const demoFacture = {
      id: "demo",
      numero: "FAC-2026-DEMO",
      statut: "PAYEE",
      montant: 50000,
      devise: "DJF",
      libelle: "Frais de scolarité - Trimestre 1",
      echeance: null,
      createdAt: new Date(),
      eleve: { nom: eleve.nom, prenom: eleve.prenom, matricule: eleve.matricule, classe: { nom: classe.nom, niveau: classe.niveau } },
      paiements: [{ date: new Date(), montant: 50000, devise: "DJF", methode: "especes", reference: "REC-001", enregistrePar: { name: "Administration" } }],
      createdBy: { name: "Administration" },
    };
    const factureHtml = generateFactureHTML(demoFacture, tenant);
    const facturePath = path.join(OUTPUT_DIR, "facture.html");
    fs.writeFileSync(facturePath, factureHtml);
    console.log("✓ Facture HTML (demo):", facturePath);
  }

  // ─── 10. Générer le HTML de l'attestation / dossier d'inscription ───
  const attestationHtml = generateAttestationHTML({
    ecoleName: tenant.name,
    ecoleVille: tenant.city ?? "Ville",
    ecolePays: tenant.country,
    ecolePhone: tenant.phone,
    ecoleEmail: tenant.email,
    ecoleLogo: tenant.logoUrl,
    ecoleAddress: tenant.address,
    eleveNom: eleve.nom,
    elevePrenom: eleve.prenom,
    eleveMatricule: eleve.matricule,
    eleveClasse: classe.nom,
    eleveNiveau: classe.niveau,
    eleveSexe: eleve.sexe,
    eleveDateNaissance: eleve.dateNaissance,
    annee: annee.libelle,
    dateDelivrance: new Date(),
    chefEtablissement: tenant.chefEtablissement,
    signatureUrl: tenant.signatureUrl,
    cachetUrl: tenant.cachetUrl,
    honorifique: "M.",
    titre: "Attestation de Scolarité",
  });
  const attestationPath = path.join(OUTPUT_DIR, "attestation.html");
  fs.writeFileSync(attestationPath, attestationHtml);
  console.log("✓ Attestation HTML:", attestationPath);

  // ─── 11. Créer une page index qui affiche les 3 documents ───
  const indexHtml = generateIndexHTML();
  const indexPath = path.join(OUTPUT_DIR, "index.html");
  fs.writeFileSync(indexPath, indexHtml);
  console.log("✓ Page index:", indexPath);

  // ─── 12. Ouvrir dans le navigateur ───
  console.log("\n📄 Ouverture des documents dans le navigateur...");
  execSync(`open "${indexPath}"`);
  console.log("✓ Terminé!");
}

// ═══════════════════════════════════════════════════════════════
// Templates HTML
// ═══════════════════════════════════════════════════════════════

function generateBulletinHTML(data, maxExamNotes) {
  const logoHtml = data.ecoleLogo
    ? `<img src="${data.ecoleLogo}" alt="Logo" style="max-height:20mm;max-width:30mm;object-fit:contain" />`
    : '<div style="width:30mm"></div>';

  const notesRows = data.notes
    .map(
      (n) => `
    <tr>
      <td style="border:1px solid #000;background:#ffe4e1;padding:2px 4px;text-align:center">
        <div style="font-weight:bold;text-transform:uppercase;color:#8b0000;font-size:9px">${n.matiereNom}</div>
        <div style="font-size:8px;font-style:italic;color:#555">${n.nomProfesseur ?? "PROFESSEUR"}</div>
      </td>
      <td style="border:1px solid #000;padding:2px 4px;text-align:center">${n.coefficient}</td>
      ${Array.from(
        { length: maxExamNotes },
        (_, i) => {
          const note = n.notesExamen[i];
          return `<td style="border:1px solid #000;padding:1px;text-align:center;font-size:9px">${
            note ? (note.valeur !== null ? note.valeur.toFixed(2) : "—") : '<span style="color:#ccc">—</span>'
          }</td>`;
        }
      ).join("")}
      <td style="border:1px solid #000;background:#fffacd;padding:2px 4px;text-align:center;font-weight:bold">${fmt(n.moyenne)}</td>
      <td style="border:1px solid #000;background:#e0f2fe;padding:2px 4px;text-align:center;font-weight:bold;color:#1e40af">${fmt(n.moyenneClasse)}</td>
      <td style="border:1px solid #000;background:#fffacd;padding:2px 4px;text-align:center;font-weight:bold;color:#b8860b">${getOrdinal(n.rang)}/${data.effectifClasse ?? "—"}</td>
      <td style="border:1px solid #000;padding:2px 4px;text-align:center;color:#15803d;font-weight:bold">${fmt(n.moyenneMax)}</td>
      <td style="border:1px solid #000;padding:2px 4px;text-align:center;color:#dc2626;font-weight:bold">${fmt(n.moyenneMin)}</td>
      <td style="border:1px solid #000;background:#e6f4ea;padding:2px 4px;font-style:italic;color:#15803d;font-size:9px">${n.appreciation ?? "—"}</td>
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bulletin de notes — ${data.eleveNom} ${data.elevePrenom}</title>
<style>
  @page { size: A4; margin: 8mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; background: #f5f5f5; padding: 20px; }
  .bulletin { width: 210mm; min-height: 297mm; padding: 10mm; margin: 0 auto; background: white; border: 1px solid #000; box-sizing: border-box; }
  table { border-collapse: collapse; width: 100%; }
  .print-btn { display: block; margin: 16px auto; padding: 10px 24px; background: #1e40af; color: white; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; }
  .print-btn:hover { background: #1e3a8a; }
  @media print { .print-btn { display: none; } body { padding: 0; background: white; } .bulletin { border: none; } }
</style>
</head>
<body>
<div class="bulletin">
  <!-- En-tête -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
    ${logoHtml}
    <div style="text-align:right;font-size:10px;line-height:1.3">
      <div style="font-weight:bold;font-size:14px;color:#1e40af">${data.ecoleName}</div>
      ${data.ecoleVille ? `<div>${data.ecoleVille}${data.ecolePays ? `, ${data.ecolePays}` : ""}</div>` : ""}
    </div>
  </div>

  <!-- Infos élève -->
  <table style="border:1px solid #000;margin-bottom:4px;font-size:10px;text-align:center">
    <tr>
      <td style="border:1px solid #000;background:#fef3c7;font-weight:bold;padding:3px 6px;width:60px">NOM</td>
      <td style="border:1px solid #000;padding:3px 6px;text-transform:uppercase">${data.eleveNom} ${data.elevePrenom}</td>
      <td style="border:1px solid #000;padding:3px 6px;width:60px">Né(e) le</td>
      <td style="border:1px solid #000;padding:3px 6px">${formatDateFr(data.eleveDateNaissance)}</td>
      <td style="border:1px solid #000;padding:3px 6px;width:60px">Classe</td>
      <td style="border:1px solid #000;padding:3px 6px">${data.eleveClasse}</td>
      <td style="border:1px solid #000;padding:3px 6px;width:60px">Carnet</td>
      <td style="border:1px solid #000;padding:3px 6px">${data.eleveMatricule}</td>
      <td style="border:1px solid #000;width:90px;background:#e5e7eb;vertical-align:middle;font-size:8px;color:#999">PHOTO</td>
    </tr>
    <tr>
      <td colspan="8" style="border:1px solid #000;background:#e0f2fe;text-align:center;font-weight:bold;padding:6px">
        Année scolaire ${data.annee}
      </td>
      <td style="border:1px solid #000"></td>
    </tr>
  </table>

  <!-- Tableau des disciplines -->
  <table style="border:1px solid #000;margin-bottom:12px;font-size:10px;text-align:center">
    <thead>
      <tr style="font-weight:bold;font-size:9px">
        <th style="border:1px solid #000;padding:3px;width:18%" rowspan="2">DISCIPLINES</th>
        <th style="border:1px solid #000;padding:3px" rowspan="2">COEF</th>
        ${maxExamNotes > 0 ? `<th style="border:1px solid #000;padding:3px" colspan="${maxExamNotes}">NOTES D'EXAMEN</th>` : ""}
        <th style="border:1px solid #000;padding:3px" rowspan="2">MOY. ÉLÈVE</th>
        <th style="border:1px solid #000;padding:3px" rowspan="2">MOY. CLASSE</th>
        <th style="border:1px solid #000;padding:3px" rowspan="2">RANG</th>
        <th style="border:1px solid #000;padding:3px" rowspan="2">M.N +</th>
        <th style="border:1px solid #000;padding:3px" rowspan="2">M.N -</th>
        <th style="border:1px solid #000;padding:3px;width:20%" rowspan="2">OBSERVATIONS</th>
      </tr>
      ${
        maxExamNotes > 0
          ? `<tr style="font-weight:bold;font-size:8px;background:#f9fafb">
        ${Array.from({ length: maxExamNotes }, (_, i) => `<th style="border:1px solid #000;padding:1px;min-width:28px">N${i + 1}</th>`).join("")}
      </tr>`
          : ""
      }
    </thead>
    <tbody>
      ${notesRows}
    </tbody>
    <tfoot>
      <tr style="font-weight:bold;background:#fbcfe8;font-size:10px">
        <td style="border:1px solid #000;padding:3px;text-align:left;padding-left:6px" colspan="${2 + maxExamNotes}">MOYENNE GÉNÉRALE</td>
        <td style="border:1px solid #000;background:#bae6fd;padding:3px;color:#1e3a8a;font-weight:bold">${fmt(data.moyenneGenerale)}</td>
        <td style="border:1px solid #000;background:#bae6fd;padding:3px;color:#1e3a8a;font-weight:bold">${fmt(data.moyenneClasse)}</td>
        <td style="border:1px solid #000;background:#bae6fd;padding:3px;color:#1e3a8a">${getOrdinal(data.rang)}/${data.effectifClasse ?? "—"}</td>
        <td style="border:1px solid #000;padding:3px;color:#15803d">${fmt(data.moyennePremier)}</td>
        <td style="border:1px solid #000;padding:3px">—</td>
        <td style="border:1px solid #000;padding:3px;font-style:italic;text-align:left">${data.appreciation ?? ""}</td>
      </tr>
    </tfoot>
  </table>

  <!-- Tableau des trimestres -->
  <table style="border:1px solid #000;margin-bottom:12px;font-size:10px;text-align:center">
    <thead>
      <tr style="font-weight:bold;background:#fbcfe8;font-size:10px">
        <th style="border:1px solid #000;padding:6px;width:25%;text-align:left;padding-left:6px">TRIMESTRES</th>
        <th style="border:1px solid #000;padding:6px">MGC</th>
        <th style="border:1px solid #000;padding:6px">MGE</th>
        <th style="border:1px solid #000;padding:6px">POSITION</th>
        <th style="border:1px solid #000;padding:6px">MG du 1er</th>
        <th style="border:1px solid #000;padding:6px;width:25%;text-align:left;padding-left:6px">HEURES D'ABSENCE</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="border:1px solid #000;padding:6px;text-align:left;font-weight:bold">${data.periodeNom.toUpperCase()}</td>
        <td style="border:1px solid #000;padding:6px;background:#bae6fd;color:#1e3a8a">${fmt(data.moyenneClasse)}</td>
        <td style="border:1px solid #000;padding:6px;background:#bae6fd;color:#1e3a8a;font-weight:bold">${fmt(data.moyenneGenerale)}</td>
        <td style="border:1px solid #000;padding:6px;background:#bae6fd;color:#1e3a8a">${getOrdinal(data.rang)}/${data.effectifClasse ?? "—"}</td>
        <td style="border:1px solid #000;padding:6px;background:#bae6fd;color:#1e3a8a">${fmt(data.moyennePremier)}</td>
        <td style="border:1px solid #000;padding:6px;background:#dcfce7;color:#15803d;text-align:left;padding-left:6px">${data.heuresAbsence ?? 0} h</td>
      </tr>
      <tr>
        <td style="border:1px solid #000;padding:6px;text-align:left;font-weight:bold">2e TRIMESTRE</td>
        <td style="border:1px solid #000;padding:6px">-</td><td style="border:1px solid #000;padding:6px">-</td>
        <td style="border:1px solid #000;padding:6px">-</td><td style="border:1px solid #000;padding:6px">-</td>
        <td style="border:1px solid #000;padding:6px">-</td>
      </tr>
      <tr>
        <td style="border:1px solid #000;padding:6px;text-align:left;font-weight:bold">3e TRIMESTRE</td>
        <td style="border:1px solid #000;padding:6px">-</td><td style="border:1px solid #000;padding:6px">-</td>
        <td style="border:1px solid #000;padding:6px">-</td><td style="border:1px solid #000;padding:6px">-</td>
        <td style="border:1px solid #000;padding:6px">-</td>
      </tr>
    </tbody>
  </table>

  <!-- Appréciation -->
  ${
    data.appreciation
      ? `<table style="border:1px solid #000;margin-bottom:12px;font-size:10px">
    <tr>
      <td style="border:1px solid #000;padding:6px;font-weight:bold;width:25%;background:#fbcfe8">Appréciation du conseil</td>
      <td style="border:1px solid #000;padding:6px;text-align:left">${data.appreciation}</td>
    </tr>
  </table>`
      : ""
  }

  <!-- Signature -->
  <div style="display:flex;justify-content:flex-end;margin-top:20px">
    <div style="text-align:center;font-size:10px;width:60mm">
      <p style="margin-bottom:4px">${data.ecoleVille}, le ${formatDateFr(data.generatedAt)}</p>
      ${data.chefEtablissement ? `<p style="font-weight:bold">${data.chefEtablissement}</p>` : ""}
      <div style="position:relative;height:26mm;display:flex;align-items:center;justify-content:center;margin-top:4px">
        ${data.cachetUrl ? `<img src="${data.cachetUrl}" alt="Cachet" style="position:absolute;inset:0;margin:auto;max-height:26mm;object-fit:contain;opacity:0.8" />` : ""}
        ${data.signatureUrl ? `<img src="${data.signatureUrl}" alt="Signature" style="position:relative;max-height:20mm;object-fit:contain" />` : ""}
      </div>
      <p style="border-top:1px solid #000;padding-top:4px">Le Chef d'Établissement</p>
    </div>
  </div>
</div>
<button class="print-btn" onclick="window.print()">🖨️ Imprimer / Enregistrer en PDF</button>
</body>
</html>`;
}

function generateFactureHTML(facture, tenant) {
  const totalPaye = (facture.paiements || []).reduce((s, p) => s + p.montant, 0);
  const restant = facture.montant - totalPaye;
  const eleve = facture.eleve;
  const tuteur = eleve?.parents?.[0]?.parent;

  const statutLabels = { EN_ATTENTE: "En attente", PAYEE: "Payée", EN_RETARD: "En retard", ANNULEE: "Annulée" };
  const statutColors = { EN_ATTENTE: "#f59e0b", PAYEE: "#10b981", EN_RETARD: "#ef4444", ANNULEE: "#6b7280" };

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Facture ${facture.numero}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; background: #f5f5f5; padding: 20px; }
  .invoice { max-width: 800px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
  .header { background: linear-gradient(135deg, #1e40af, #3b82f6); color: white; padding: 28px 32px; display: flex; justify-content: space-between; align-items: center; }
  .header h1 { font-size: 22px; font-weight: 700; }
  .header .inv-num { font-size: 14px; opacity: 0.9; }
  .status-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; color: white; }
  .school-info { padding: 20px 32px; border-bottom: 1px solid #e5e7eb; }
  .school-info h2 { font-size: 18px; font-weight: 700; color: #1e40af; }
  .school-info p { font-size: 13px; color: #6b7280; margin-top: 2px; }
  .body { padding: 24px 32px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; margin: 0 0 8px; font-weight: 600; }
  .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
  .row .label { font-size: 13px; color: #6b7280; font-weight: 500; }
  .row .value { font-size: 13px; color: #111827; font-weight: 600; text-align: right; }
  .amount-box { margin: 20px 0; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 20px; text-align: center; }
  .amount-box .label { font-size: 12px; color: #1e40af; text-transform: uppercase; letter-spacing: 0.5px; }
  .amount-box .amount { font-size: 32px; font-weight: 800; color: #1e40af; margin-top: 4px; }
  .summary-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin: 20px 0; }
  .summary-card { padding: 16px; border-radius: 8px; text-align: center; }
  .summary-card .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; }
  .summary-card .amount { font-size: 18px; font-weight: 700; margin-top: 4px; }
  .summary-invoiced { background: #eff6ff; }
  .summary-invoiced .amount { color: #1e40af; }
  .summary-paid { background: #ecfdf5; }
  .summary-paid .amount { color: #059669; }
  .summary-due { background: ${restant > 0 ? "#fef2f2" : "#ecfdf5"}; }
  .summary-due .amount { color: ${restant > 0 ? "#dc2626" : "#059669"}; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th { text-align: left; padding: 10px 12px; background: #f9fafb; font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e5e7eb; }
  td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #f3f4f6; }
  .footer { padding: 20px 32px; border-top: 2px solid #e5e7eb; display: flex; justify-content: space-between; align-items: flex-end; }
  .signature { font-size: 12px; color: #6b7280; }
  .signature-line { margin-top: 40px; border-top: 1px dashed #9ca3af; width: 180px; text-align: center; padding-top: 4px; }
  .stamp { font-size: 11px; color: #d1d5db; text-align: right; }
  .print-btn { display: block; margin: 16px auto; padding: 10px 24px; background: #1e40af; color: white; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; }
  .print-btn:hover { background: #1e3a8a; }
  @media print { .print-btn { display: none; } body { padding: 0; background: white; } .invoice { box-shadow: none; } }
</style>
</head>
<body>
  <div class="invoice">
    <div class="header">
      <div style="display:flex;align-items:center;gap:16px">
        ${tenant.logoUrl ? `<img src="${tenant.logoUrl}" alt="Logo" style="max-height:56px;max-width:120px;object-fit:contain;background:white;border-radius:6px;padding:4px" />` : ""}
        <div>
          <h1>FACTURE</h1>
          <div class="inv-num">N° ${facture.numero}</div>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:13px;opacity:0.9">${new Date(facture.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}</div>
        <div style="margin-top:6px">
          <span class="status-badge" style="background:${statutColors[facture.statut] ?? "#6b7280"}">
            ${statutLabels[facture.statut] ?? facture.statut}
          </span>
        </div>
      </div>
    </div>

    <div class="school-info">
      <h2>${tenant.name}</h2>
      <p>${tenant.city ?? ""}${tenant.city && tenant.country ? ", " : ""}${tenant.country}</p>
      ${tenant.email ? `<p>${tenant.email}</p>` : ""}
      ${tenant.phone ? `<p>${tenant.phone}</p>` : ""}
    </div>

    <div class="body">
      <div class="two-col">
        <div>
          <div class="section-title">Élève</div>
          <div class="row"><span class="label">Nom & Prénom</span><span class="value">${eleve?.prenom ?? ""} ${eleve?.nom ?? ""}</span></div>
          <div class="row"><span class="label">Matricule</span><span class="value">${eleve?.matricule ?? ""}</span></div>
          <div class="row"><span class="label">Classe</span><span class="value">${eleve?.classe?.nom ?? "N/A"} — ${eleve?.classe?.niveau ?? ""}</span></div>
        </div>
        <div>
          ${tuteur ? `
          <div class="section-title">Tuteur légal</div>
          <div class="row"><span class="label">Nom</span><span class="value">${tuteur.prenom} ${tuteur.nom}</span></div>
          ${tuteur.phone ? `<div class="row"><span class="label">Téléphone</span><span class="value">${tuteur.phone}</span></div>` : ""}
          ${tuteur.email ? `<div class="row"><span class="label">Email</span><span class="value">${tuteur.email}</span></div>` : ""}
          ` : ""}
        </div>
      </div>

      <div class="section-title" style="margin-top:20px">Détails de la facture</div>
      <div class="row"><span class="label">Libellé</span><span class="value">${facture.libelle}</span></div>
      ${facture.echeance ? `<div class="row"><span class="label">Échéance</span><span class="value">${new Date(facture.echeance).toLocaleDateString("fr-FR")}</span></div>` : ""}
      ${facture.createdBy ? `<div class="row"><span class="label">Émise par</span><span class="value">${facture.createdBy.name}</span></div>` : ""}

      <div class="amount-box">
        <div class="label">Montant facturé</div>
        <div class="amount">${formatMoney(facture.montant, facture.devise)}</div>
      </div>

      <div class="summary-grid">
        <div class="summary-card summary-invoiced">
          <div class="label">Facturé</div>
          <div class="amount">${formatMoney(facture.montant, facture.devise)}</div>
        </div>
        <div class="summary-card summary-paid">
          <div class="label">Payé</div>
          <div class="amount">${formatMoney(totalPaye, facture.devise)}</div>
        </div>
        <div class="summary-card summary-due">
          <div class="label">Reste à payer</div>
          <div class="amount">${formatMoney(restant, facture.devise)}</div>
        </div>
      </div>

      ${(facture.paiements || []).length > 0 ? `
      <div class="section-title">Historique des paiements</div>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Montant</th>
            <th>Méthode</th>
            <th>Référence</th>
            <th>Enregistré par</th>
          </tr>
        </thead>
        <tbody>
          ${facture.paiements.map((p) => `
          <tr>
            <td>${new Date(p.date).toLocaleDateString("fr-FR")}</td>
            <td style="font-weight:600;color:#059669">${formatMoney(p.montant, p.devise)}</td>
            <td style="text-transform:capitalize">${p.methode}</td>
            <td>${p.reference ?? "—"}</td>
            <td>${p.enregistrePar?.name ?? "—"}</td>
          </tr>
          `).join("")}
        </tbody>
      </table>
      ` : ""}
    </div>

    <div class="footer">
      <div class="signature">
        <div class="signature-line">Cachet & Signature</div>
      </div>
      <div class="stamp">
        ${tenant.name} — Facture générée le ${new Date().toLocaleDateString("fr-FR")}
      </div>
    </div>
  </div>
  <button class="print-btn" onclick="window.print()">🖨️ Imprimer / Enregistrer en PDF</button>
</body>
</html>`;
}

function generateAttestationHTML(d) {
  const dateFr = new Date(d.dateDelivrance).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const dateNaissance = d.eleveDateNaissance
    ? new Date(d.eleveDateNaissance).toLocaleDateString("fr-FR")
    : "—";

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${d.titre} — ${d.eleveNom} ${d.elevePrenom}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Times New Roman', serif; color: #1a1a1a; background: #f5f5f5; padding: 20px; }
  .doc { max-width: 210mm; min-height: 297mm; margin: 0 auto; background: white; padding: 20mm; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px; }
  .logo { max-width: 80px; max-height: 80px; }
  .ecole-info { text-align: right; font-size: 11px; line-height: 1.4; }
  .ecole-info .name { font-size: 16px; font-weight: bold; }
  .title { text-align: center; font-size: 22px; font-weight: bold; text-transform: uppercase; margin: 20px 0; letter-spacing: 1px; }
  .body { text-align: justify; font-size: 14px; line-height: 1.8; margin: 30px auto; max-width: 170mm; }
  .body strong { font-weight: bold; }
  .footer { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 60px; }
  .date-lieu { font-size: 12px; }
  .signature { text-align: center; font-size: 12px; }
  .signature img { max-height: 60px; }
  .signature .name { border-top: 1px solid #333; padding-top: 4px; margin-top: 8px; font-weight: bold; }
  .cachet { position: absolute; right: 60px; bottom: 80px; opacity: 0.8; max-height: 100px; }
  .eleve-info { background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px; padding: 12px 20px; margin: 20px auto; max-width: 170mm; font-size: 13px; }
  .eleve-info table { width: 100%; }
  .eleve-info td { padding: 4px 8px; }
  .eleve-info .label { font-weight: bold; color: #555; width: 120px; }
  .print-btn { display: block; margin: 16px auto; padding: 10px 24px; background: #1e40af; color: white; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; }
  .print-btn:hover { background: #1e3a8a; }
  @media print { .print-btn { display: none; } body { padding: 0; background: white; } .doc { box-shadow: none; } }
</style>
</head>
<body>
<div class="doc" style="position:relative">
  <div class="header">
    ${d.ecoleLogo ? `<img src="${d.ecoleLogo}" class="logo" alt="Logo" />` : '<div style="width:80px"></div>'}
    <div class="ecole-info">
      <div class="name">${d.ecoleName}</div>
      ${d.ecoleAddress ? `<div>${d.ecoleAddress}</div>` : ""}
      ${d.ecoleVille ? `<div>${d.ecoleVille}, ${d.ecolePays}</div>` : ""}
      ${d.ecolePhone ? `<div>Tél: ${d.ecolePhone}</div>` : ""}
      ${d.ecoleEmail ? `<div>Email: ${d.ecoleEmail}</div>` : ""}
    </div>
  </div>

  <div class="title">${d.titre}</div>

  <div class="eleve-info">
    <table>
      <tr>
        <td class="label">Nom & Prénom:</td><td><strong>${d.eleveNom} ${d.elevePrenom}</strong></td>
        <td class="label">Matricule:</td><td>${d.eleveMatricule}</td>
      </tr>
      <tr>
        <td class="label">Né(e) le:</td><td>${dateNaissance}</td>
        <td class="label">Sexe:</td><td>${d.eleveSexe === "M" ? "Masculin" : "Féminin"}</td>
      </tr>
      <tr>
        <td class="label">Classe:</td><td>${d.eleveClasse}</td>
        <td class="label">Niveau:</td><td>${d.eleveNiveau}</td>
      </tr>
      <tr>
        <td class="label">Année scolaire:</td><td colspan="3"><strong>${d.annee}</strong></td>
      </tr>
    </table>
  </div>

  <div class="body">
    <p>Je soussigné(e) <strong>${d.honorifique} ${d.chefEtablissement ?? "_______________"}</strong>,
    Directeur(trice) de l'établissement <strong>${d.ecoleName}</strong>,</p>
    <p style="margin-top:12px">atteste par la présente que l'élève <strong>${d.eleveNom} ${d.elevePrenom}</strong>,
    ${d.eleveDateNaissance ? `né(e) le ${dateNaissance},` : ""} matricule N° <strong>${d.eleveMatricule}</strong>,
    est régulièrement inscrit(e) en classe de <strong>${d.eleveClasse}</strong> (${d.eleveNiveau})
    pour l'année scolaire <strong>${d.annee}</strong>.</p>
    <p style="margin-top:12px">En foi de quoi la présente ${d.titre.toLowerCase()} lui est délivrée pour servir et valoir ce que de droit.</p>
  </div>

  <div class="footer">
    <div class="date-lieu">Fait à ${d.ecoleVille}, le ${dateFr}</div>
    <div class="signature">
      ${d.signatureUrl ? `<img src="${d.signatureUrl}" alt="Signature" /><br/>` : ""}
      <div class="name">${d.chefEtablissement ?? "Le Directeur"}</div>
      <div style="font-size:10px;color:#666">Directeur de l'établissement</div>
    </div>
  </div>
  ${d.cachetUrl ? `<img src="${d.cachetUrl}" class="cachet" alt="Cachet" />` : ""}
</div>
<button class="print-btn" onclick="window.print()">🖨️ Imprimer / Enregistrer en PDF</button>
</body>
</html>`;
}

function generateIndexHTML() {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Documents EcolPro — Démonstration</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #f0f4f8; padding: 40px; }
  .container { max-width: 900px; margin: 0 auto; }
  h1 { color: #1e40af; font-size: 28px; margin-bottom: 8px; }
  .subtitle { color: #6b7280; font-size: 14px; margin-bottom: 32px; }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .card { background: white; border-radius: 12px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); transition: transform 0.2s, box-shadow 0.2s; cursor: pointer; text-decoration: none; color: inherit; display: flex; flex-direction: column; align-items: center; }
  .card:hover { transform: translateY(-4px); box-shadow: 0 8px 24px rgba(0,0,0,0.12); }
  .card-icon { font-size: 48px; margin-bottom: 12px; }
  .card-title { font-size: 16px; font-weight: 700; color: #1e40af; margin-bottom: 4px; }
  .card-desc { font-size: 12px; color: #6b7280; text-align: center; }
  .note { margin-top: 32px; padding: 16px; background: #eff6ff; border-radius: 8px; font-size: 13px; color: #1e40af; }
</style>
</head>
<body>
<div class="container">
  <h1>📄 Documents de démonstration — École Miriam</h1>
  <p class="subtitle">Cliquez sur un document pour l'ouvrir. Chaque document contient le logo de l'établissement.</p>
  <div class="cards">
    <a class="card" href="bulletin.html" target="_blank">
      <div class="card-icon">📊</div>
      <div class="card-title">Bulletin de notes</div>
      <div class="card-desc">Trimestre 1 — 8ème1<br/>Avec moyennes, rang et appréciations</div>
    </a>
    <a class="card" href="facture.html" target="_blank">
      <div class="card-icon">🧾</div>
      <div class="card-title">Facture</div>
      <div class="card-desc">Frais de scolarité<br/>Avec historique des paiements</div>
    </a>
    <a class="card" href="attestation.html" target="_blank">
      <div class="card-icon">🎓</div>
      <div class="card-title">Attestation de scolarité</div>
      <div class="card-desc">Dossier d'inscription<br/>Avec signature et cachet</div>
    </a>
  </div>
  <div class="note">
    💡 Astuce : Chaque document a un bouton "Imprimer / Enregistrer en PDF" en bas de page.
    Utilisez Ctrl+P (Cmd+P sur Mac) ou le bouton pour générer le PDF.
  </div>
</div>
</body>
</html>`;
}

main()
  .catch((e) => {
    console.error("Erreur:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
