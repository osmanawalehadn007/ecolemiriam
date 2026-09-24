/**
 * Génération de 3 propositions de style pour chaque document (bulletin, facture, attestation)
 * avec le logo en pleine largeur en haut de page (pas de texte à côté).
 *
 * Style 1: Bandeau plein — logo centré sur fond coloré, bordure décorative
 * Style 2: Bannière large — logo étiré sur toute la largeur, fond dégradé subtil
 * Style 3: Minimaliste — logo pleine largeur sans fond, séparateur fin (STYLE PAR DÉFAUT)
 */
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const DIRECT_URL =
  "postgresql://ecolemiriam_owner:8D5NC8kgQwOFficKddABfHJ6JwE1dp6E@127.0.0.1:15432/ecolemiriam?connect_timeout=15";
const prisma = new PrismaClient({ datasources: { db: { url: DIRECT_URL } } });

const TENANT_ID = "cms8kt0b40001zbi3o63y7c5v";
const OUTPUT_DIR = "/tmp/ecolpro-documents-v2";

function fmt(v) {
  return v !== null && v !== undefined ? v.toFixed(2) : "—";
}
function getOrdinal(n) {
  if (!n) return "—";
  return n === 1 ? "1er" : `${n}e`;
}
function formatDateFr(date) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("fr-FR");
}
function formatMoney(amount, devise) {
  try {
    return new Intl.NumberFormat("fr-DJ", { style: "currency", currency: devise }).format(amount);
  } catch {
    return `${amount.toLocaleString("fr-DJ")} ${devise}`;
  }
}

// ═══════════════════════════════════════════════════════════════
// 3 STYLES D'EN-TÊTE LOGO PLEINE LARGEUR
// ═══════════════════════════════════════════════════════════════

/**
 * Style 1 — BANDEAU PLEIN
 * Logo centré sur un fond bleu foncé, bordure dorée, hauteur fixe.
 * Le logo est contenu dans une zone blanche arrondie au centre.
 */
function headerStyle1(logoUrl, height = "30mm") {
  return `
  <!-- STYLE 1: Bandeau plein -->
  <div style="
    width: 100%;
    background: linear-gradient(135deg, #1e3a8a, #1e40af);
    padding: 6mm 0;
    display: flex;
    justify-content: center;
    align-items: center;
    border-top: 3px solid #d4af37;
    border-bottom: 3px solid #d4af37;
    margin-bottom: 6mm;
  ">
    <div style="
      background: white;
      border-radius: 6px;
      padding: 3mm 8mm;
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <img src="${logoUrl}" alt="Logo" style="
        max-height: ${height};
        max-width: 160mm;
        width: auto;
        object-fit: contain;
      " />
    </div>
  </div>`;
}

/**
 * Style 2 — BANNIÈRE LARGE
 * Logo étiré sur toute la largeur, fond dégradé subtil, pas de cadre blanc.
 * Le logo occupe toute la zone avec un padding minimal.
 */
function headerStyle2(logoUrl, height = "35mm") {
  return `
  <!-- STYLE 2: Bannière large -->
  <div style="
    width: 100%;
    background: linear-gradient(180deg, #f0f4ff 0%, #ffffff 100%);
    padding: 4mm 6mm;
    display: flex;
    justify-content: center;
    align-items: center;
    border-bottom: 2px solid #1e40af;
    margin-bottom: 6mm;
    position: relative;
  ">
    <img src="${logoUrl}" alt="Logo" style="
      max-height: ${height};
      max-width: 180mm;
      width: 100%;
      object-fit: contain;
    " />
  </div>`;
}

/**
 * Style 3 — MINIMALISTE (PAR DÉFAUT)
 * Logo pleine largeur sans fond, séparateur fin en bas.
 * Le plus épuré, le logo est l'élément principal.
 */
function headerStyle3(logoUrl, height = "32mm") {
  return `
  <!-- STYLE 3: Minimaliste (PAR DÉFAUT) -->
  <div style="
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 2mm 0;
    margin-bottom: 5mm;
    border-bottom: 1px solid #e5e7eb;
  ">
    <img src="${logoUrl}" alt="Logo" style="
      max-height: ${height};
      max-width: 175mm;
      width: 100%;
      object-fit: contain;
    " />
  </div>`;
}

// ═══════════════════════════════════════════════════════════════
// GÉNÉRATEURS DE DOCUMENTS AVEC STYLE PARAMÉTRABLE
// ═══════════════════════════════════════════════════════════════

function generateBulletinHTML(data, maxExamNotes, styleNum) {
  const headerFn = [headerStyle1, headerStyle2, headerStyle3][styleNum - 1];
  const header = headerFn(data.ecoleLogo, styleNum === 1 ? "26mm" : styleNum === 2 ? "32mm" : "30mm");

  const notesRows = data.notes.map((n) => `
    <tr>
      <td style="border:1px solid #000;background:#ffe4e1;padding:2px 4px;text-align:center">
        <div style="font-weight:bold;text-transform:uppercase;color:#8b0000;font-size:9px">${n.matiereNom}</div>
        <div style="font-size:8px;font-style:italic;color:#555">${n.nomProfesseur ?? "PROFESSEUR"}</div>
      </td>
      <td style="border:1px solid #000;padding:2px 4px;text-align:center">${n.coefficient}</td>
      ${Array.from({ length: maxExamNotes }, (_, i) => {
        const note = n.notesExamen[i];
        return `<td style="border:1px solid #000;padding:1px;text-align:center;font-size:9px">${note ? (note.valeur !== null ? note.valeur.toFixed(2) : "—") : '<span style="color:#ccc">—</span>'}</td>`;
      }).join("")}
      <td style="border:1px solid #000;background:#fffacd;padding:2px 4px;text-align:center;font-weight:bold">${fmt(n.moyenne)}</td>
      <td style="border:1px solid #000;background:#e0f2fe;padding:2px 4px;text-align:center;font-weight:bold;color:#1e40af">${fmt(n.moyenneClasse)}</td>
      <td style="border:1px solid #000;background:#fffacd;padding:2px 4px;text-align:center;font-weight:bold;color:#b8860b">${getOrdinal(n.rang)}/${data.effectifClasse ?? "—"}</td>
      <td style="border:1px solid #000;padding:2px 4px;text-align:center;color:#15803d;font-weight:bold">${fmt(n.moyenneMax)}</td>
      <td style="border:1px solid #000;padding:2px 4px;text-align:center;color:#dc2626;font-weight:bold">${fmt(n.moyenneMin)}</td>
      <td style="border:1px solid #000;background:#e6f4ea;padding:2px 4px;font-style:italic;color:#15803d;font-size:9px">${n.appreciation ?? "—"}</td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bulletin Style ${styleNum} — ${data.eleveNom} ${data.elevePrenom}</title>
<style>
  @page { size: A4; margin: 8mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; background: #f5f5f5; padding: 20px; }
  .bulletin { width: 210mm; min-height: 297mm; padding: 8mm; margin: 0 auto; background: white; border: 1px solid #ddd; box-sizing: border-box; }
  table { border-collapse: collapse; width: 100%; }
  .print-btn { display: block; margin: 16px auto; padding: 10px 24px; background: #1e40af; color: white; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; }
  .print-btn:hover { background: #1e3a8a; }
  @media print { .print-btn { display: none; } body { padding: 0; background: white; } .bulletin { border: none; } }
  .style-badge { position: fixed; top: 10px; right: 10px; background: #1e40af; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; z-index: 999; }
</style>
</head>
<body>
<div class="style-badge">Style ${styleNum}</div>
<div class="bulletin">
  ${header}

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
      <td colspan="8" style="border:1px solid #000;background:#e0f2fe;text-align:center;font-weight:bold;padding:6px">Année scolaire ${data.annee}</td>
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
      ${maxExamNotes > 0 ? `<tr style="font-weight:bold;font-size:8px;background:#f9fafb">${Array.from({ length: maxExamNotes }, (_, i) => `<th style="border:1px solid #000;padding:1px;min-width:28px">N${i + 1}</th>`).join("")}</tr>` : ""}
    </thead>
    <tbody>${notesRows}</tbody>
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
        <th style="border:1px solid #000;padding:6px">MGC</th><th style="border:1px solid #000;padding:6px">MGE</th>
        <th style="border:1px solid #000;padding:6px">POSITION</th><th style="border:1px solid #000;padding:6px">MG du 1er</th>
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
      <tr><td style="border:1px solid #000;padding:6px;text-align:left;font-weight:bold">2e TRIMESTRE</td><td style="border:1px solid #000;padding:6px">-</td><td style="border:1px solid #000;padding:6px">-</td><td style="border:1px solid #000;padding:6px">-</td><td style="border:1px solid #000;padding:6px">-</td><td style="border:1px solid #000;padding:6px">-</td></tr>
      <tr><td style="border:1px solid #000;padding:6px;text-align:left;font-weight:bold">3e TRIMESTRE</td><td style="border:1px solid #000;padding:6px">-</td><td style="border:1px solid #000;padding:6px">-</td><td style="border:1px solid #000;padding:6px">-</td><td style="border:1px solid #000;padding:6px">-</td><td style="border:1px solid #000;padding:6px">-</td></tr>
    </tbody>
  </table>

  ${data.appreciation ? `<table style="border:1px solid #000;margin-bottom:12px;font-size:10px"><tr><td style="border:1px solid #000;padding:6px;font-weight:bold;width:25%;background:#fbcfe8">Appréciation du conseil</td><td style="border:1px solid #000;padding:6px;text-align:left">${data.appreciation}</td></tr></table>` : ""}

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

function generateFactureHTML(facture, tenant, styleNum) {
  const headerFn = [headerStyle1, headerStyle2, headerStyle3][styleNum - 1];
  const header = headerFn(tenant.logoUrl, styleNum === 1 ? "28mm" : styleNum === 2 ? "34mm" : "30mm");

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
<title>Facture Style ${styleNum} — ${facture.numero}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; background: #f5f5f5; padding: 20px; }
  .invoice { max-width: 800px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
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
  .summary-invoiced { background: #eff6ff; } .summary-invoiced .amount { color: #1e40af; }
  .summary-paid { background: #ecfdf5; } .summary-paid .amount { color: #059669; }
  .summary-due { background: ${restant > 0 ? "#fef2f2" : "#ecfdf5"}; } .summary-due .amount { color: ${restant > 0 ? "#dc2626" : "#059669"}; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th { text-align: left; padding: 10px 12px; background: #f9fafb; font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e5e7eb; }
  td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #f3f4f6; }
  .footer { padding: 20px 32px; border-top: 2px solid #e5e7eb; display: flex; justify-content: space-between; align-items: flex-end; }
  .signature-line { margin-top: 40px; border-top: 1px dashed #9ca3af; width: 180px; text-align: center; padding-top: 4px; font-size: 12px; color: #6b7280; }
  .stamp { font-size: 11px; color: #d1d5db; text-align: right; }
  .facture-meta { display: flex; justify-content: space-between; align-items: center; padding: 12px 32px; background: #f8fafc; border-bottom: 1px solid #e5e7eb; }
  .facture-meta .num { font-size: 16px; font-weight: 700; color: #1e40af; }
  .print-btn { display: block; margin: 16px auto; padding: 10px 24px; background: #1e40af; color: white; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; }
  .print-btn:hover { background: #1e3a8a; }
  @media print { .print-btn { display: none; } body { padding: 0; background: white; } .invoice { box-shadow: none; } }
  .style-badge { position: fixed; top: 10px; right: 10px; background: #1e40af; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; z-index: 999; }
</style>
</head>
<body>
<div class="style-badge">Style ${styleNum}</div>
<div class="invoice">
  ${header}

  <!-- Métadonnées facture (sous le logo) -->
  <div class="facture-meta">
    <div>
      <div class="num">FACTURE N° ${facture.numero}</div>
      <div style="font-size:13px;color:#6b7280">${new Date(facture.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}</div>
    </div>
    <div>
      <span style="display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;color:white;background:${statutColors[facture.statut] ?? "#6b7280"}">${statutLabels[facture.statut] ?? facture.statut}</span>
    </div>
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
        ${tuteur ? `<div class="section-title">Tuteur légal</div>
        <div class="row"><span class="label">Nom</span><span class="value">${tuteur.prenom} ${tuteur.nom}</span></div>
        ${tuteur.phone ? `<div class="row"><span class="label">Téléphone</span><span class="value">${tuteur.phone}</span></div>` : ""}
        ${tuteur.email ? `<div class="row"><span class="label">Email</span><span class="value">${tuteur.email}</span></div>` : ""}` : ""}
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
      <div class="summary-card summary-invoiced"><div class="label">Facturé</div><div class="amount">${formatMoney(facture.montant, facture.devise)}</div></div>
      <div class="summary-card summary-paid"><div class="label">Payé</div><div class="amount">${formatMoney(totalPaye, facture.devise)}</div></div>
      <div class="summary-card summary-due"><div class="label">Reste à payer</div><div class="amount">${formatMoney(restant, facture.devise)}</div></div>
    </div>

    ${(facture.paiements || []).length > 0 ? `
    <div class="section-title">Historique des paiements</div>
    <table>
      <thead><tr><th>Date</th><th>Montant</th><th>Méthode</th><th>Référence</th><th>Enregistré par</th></tr></thead>
      <tbody>${facture.paiements.map((p) => `<tr><td>${new Date(p.date).toLocaleDateString("fr-FR")}</td><td style="font-weight:600;color:#059669">${formatMoney(p.montant, p.devise)}</td><td style="text-transform:capitalize">${p.methode}</td><td>${p.reference ?? "—"}</td><td>${p.enregistrePar?.name ?? "—"}</td></tr>`).join("")}</tbody>
    </table>` : ""}
  </div>

  <div class="footer">
    <div class="signature-line">Cachet & Signature</div>
    <div class="stamp">${tenant.name} — Facture générée le ${new Date().toLocaleDateString("fr-FR")}</div>
  </div>
</div>
<button class="print-btn" onclick="window.print()">🖨️ Imprimer / Enregistrer en PDF</button>
</body>
</html>`;
}

function generateAttestationHTML(d, styleNum) {
  const headerFn = [headerStyle1, headerStyle2, headerStyle3][styleNum - 1];
  const header = headerFn(d.ecoleLogo, styleNum === 1 ? "30mm" : styleNum === 2 ? "38mm" : "34mm");

  const dateFr = new Date(d.dateDelivrance).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  const dateNaissance = d.eleveDateNaissance ? new Date(d.eleveDateNaissance).toLocaleDateString("fr-FR") : "—";

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Attestation Style ${styleNum} — ${d.eleveNom} ${d.elevePrenom}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Times New Roman', serif; color: #1a1a1a; background: #f5f5f5; padding: 20px; }
  .doc { max-width: 210mm; min-height: 297mm; margin: 0 auto; background: white; padding: 15mm; box-shadow: 0 4px 24px rgba(0,0,0,0.08); position: relative; }
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
  .style-badge { position: fixed; top: 10px; right: 10px; background: #1e40af; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; z-index: 999; }
</style>
</head>
<body>
<div class="style-badge">Style ${styleNum}</div>
<div class="doc">
  ${header}

  <div class="title">${d.titre}</div>

  <div class="eleve-info">
    <table>
      <tr><td class="label">Nom & Prénom:</td><td><strong>${d.eleveNom} ${d.elevePrenom}</strong></td><td class="label">Matricule:</td><td>${d.eleveMatricule}</td></tr>
      <tr><td class="label">Né(e) le:</td><td>${dateNaissance}</td><td class="label">Sexe:</td><td>${d.eleveSexe === "M" ? "Masculin" : "Féminin"}</td></tr>
      <tr><td class="label">Classe:</td><td>${d.eleveClasse}</td><td class="label">Niveau:</td><td>${d.eleveNiveau}</td></tr>
      <tr><td class="label">Année scolaire:</td><td colspan="3"><strong>${d.annee}</strong></td></tr>
    </table>
  </div>

  <div class="body">
    <p>Je soussigné(e) <strong>${d.honorifique} ${d.chefEtablissement ?? "_______________"}</strong>, Directeur(trice) de l'établissement <strong>${d.ecoleName}</strong>,</p>
    <p style="margin-top:12px">atteste par la présente que l'élève <strong>${d.eleveNom} ${d.elevePrenom}</strong>, ${d.eleveDateNaissance ? `né(e) le ${dateNaissance},` : ""} matricule N° <strong>${d.eleveMatricule}</strong>, est régulièrement inscrit(e) en classe de <strong>${d.eleveClasse}</strong> (${d.eleveNiveau}) pour l'année scolaire <strong>${d.annee}</strong>.</p>
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

// ═══════════════════════════════════════════════════════════════
// PAGE INDEX AVEC LES 9 MODÈLES
// ═══════════════════════════════════════════════════════════════

function generateIndexHTML() {
  const styles = [
    { num: 1, name: "Bandeau plein", desc: "Logo centré sur fond bleu foncé avec bordure dorée" },
    { num: 2, name: "Bannière large", desc: "Logo étiré sur toute la largeur, fond dégradé subtil" },
    { num: 3, name: "Minimaliste (PAR DÉFAUT)", desc: "Logo pleine largeur sans fond, séparateur fin" },
  ];
  const docs = [
    { key: "bulletin", name: "Bulletin de notes", icon: "📊" },
    { key: "facture", name: "Facture", icon: "🧾" },
    { key: "attestation", name: "Attestation de scolarité", icon: "🎓" },
  ];

  const cards = docs.map((doc) => {
    const styleCards = styles.map((s) => {
      const isDefault = s.num === 3;
      return `<a class="style-card ${isDefault ? 'default' : ''}" href="${doc.key}-style${s.num}.html" target="_blank">
        <div class="style-num">${s.num}</div>
        <div class="style-name">${s.name}</div>
        <div class="style-desc">${s.desc}</div>
        ${isDefault ? '<div class="default-badge">PAR DÉFAUT</div>' : ''}
      </a>`;
    }).join("");
    return `<div class="doc-section">
      <h2>${doc.icon} ${doc.name}</h2>
      <div class="styles-grid">${styleCards}</div>
    </div>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Propositions de documents — Logo pleine largeur</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #f0f4f8; padding: 40px; color: #1a1a1a; }
  .container { max-width: 1100px; margin: 0 auto; }
  h1 { color: #1e40af; font-size: 28px; margin-bottom: 8px; }
  .subtitle { color: #6b7280; font-size: 14px; margin-bottom: 32px; }
  .doc-section { margin-bottom: 40px; }
  .doc-section h2 { font-size: 20px; color: #1e40af; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb; }
  .styles-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .style-card { background: white; border-radius: 12px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); transition: transform 0.2s, box-shadow 0.2s; cursor: pointer; text-decoration: none; color: inherit; display: flex; flex-direction: column; position: relative; border: 2px solid transparent; }
  .style-card:hover { transform: translateY(-4px); box-shadow: 0 8px 24px rgba(0,0,0,0.12); }
  .style-card.default { border-color: #10b981; }
  .style-num { font-size: 36px; font-weight: 800; color: #dbeafe; line-height: 1; margin-bottom: 8px; }
  .style-name { font-size: 15px; font-weight: 700; color: #1e40af; margin-bottom: 4px; }
  .style-desc { font-size: 12px; color: #6b7280; line-height: 1.5; }
  .default-badge { position: absolute; top: 12px; right: 12px; background: #10b981; color: white; font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 12px; }
  .note { margin-top: 32px; padding: 16px 20px; background: #eff6ff; border-radius: 8px; font-size: 13px; color: #1e40af; line-height: 1.6; }
  .preview-section { margin-top: 32px; padding: 24px; background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
  .preview-section h3 { font-size: 16px; color: #1e40af; margin-bottom: 12px; }
  .preview-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .preview-item { text-align: center; }
  .preview-item img { width: 100%; border-radius: 8px; border: 1px solid #e5e7eb; }
  .preview-item .label { font-size: 12px; color: #6b7280; margin-top: 8px; }
</style>
</head>
<body>
<div class="container">
  <h1>📄 Propositions — Logo en pleine largeur</h1>
  <p class="subtitle">3 styles d'en-tête pour chaque document. Cliquez pour prévisualiser. Le Style 3 (Minimaliste) est le style par défaut.</p>

  ${cards}

  <div class="note">
    <strong>📋 Description des styles :</strong><br><br>
    <strong>Style 1 — Bandeau plein :</strong> Logo centré dans un cadre blanc arrondi, sur fond bleu foncé avec bordure dorée. Hauteur ~26-30mm. Aspect institutionnel et formel.<br><br>
    <strong>Style 2 — Bannière large :</strong> Logo étiré sur toute la largeur (180mm max), fond dégradé bleu très clair vers blanc, bordure bleue en bas. Hauteur ~32-38mm. Aspect moderne et élégant.<br><br>
    <strong>Style 3 — Minimaliste (PAR DÉFAUT) :</strong> Logo pleine largeur (175mm max) sans aucun fond, séparateur fin gris en bas. Hauteur ~30-34mm. Aspect épuré, le logo est l'élément principal. <strong>Ce style sera utilisé par défaut pour tous les documents générés.</strong>
  </div>
</div>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const tenant = await prisma.tenant.findUnique({ where: { id: TENANT_ID } });
  if (!tenant) throw new Error("Tenant non trouvé");
  console.log("✓ Tenant:", tenant.name, "| logo:", tenant.logoUrl ? "OUI" : "NON");

  // Récupérer les données existantes (période demo déjà créée)
  const annee = await prisma.anneesScolaires.findFirst({ where: { tenantId: TENANT_ID, isCurrent: true } });
  const periode = await prisma.periode.findFirst({ where: { anneeId: annee.id, nom: "Trimestre 1 (Demo)" } });
  if (!periode) throw new Error("Période demo non trouvée. Exécutez d'abord generate-demo-documents.mjs");

  const classe = await prisma.classe.findFirst({
    where: { tenantId: TENANT_ID, nom: "8ème1" },
    include: { eleves: { where: { statut: "ACTIF" }, take: 5 } },
  });
  const eleve = classe.eleves[0];

  // Récupérer le bulletin
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
      intitule: n.intitule ?? n.type, type: n.type, valeur: n.valeur,
      noteMax: n.noteMax, coefficient: n.coefficient, date: n.date,
    });
  }

  const classeEleves = await prisma.eleve.findMany({
    where: { classeId: classe.id, tenantId: TENANT_ID, statut: "ACTIF" }, select: { id: true },
  });
  const allBulletinsMatieres = await prisma.bulletinMatiere.findMany({
    where: { tenantId: TENANT_ID, bulletin: { tenantId: TENANT_ID, periodeId: periode.id, eleveId: { in: classeEleves.map(e => e.id) } } },
    select: { matiereId: true, moyenneEleve: true },
  });
  const moyenneClasseByMatiere = {};
  for (const matId of [...new Set(allBulletinsMatieres.map(bm => bm.matiereId))]) {
    const moyennes = allBulletinsMatieres.filter(bm => bm.matiereId === matId && bm.moyenneEleve !== null).map(bm => bm.moyenneEleve);
    moyenneClasseByMatiere[matId] = moyennes.length > 0 ? Number((moyennes.reduce((a, b) => a + b, 0) / moyennes.length).toFixed(2)) : null;
  }

  const notesMatiere = bulletin.matieres.map((bm) => ({
    matiereNom: bm.matiere.nom, matiereCode: bm.matiere.code, coefficient: bm.coefficient,
    moyenne: bm.moyenneEleve, moyenneClasse: moyenneClasseByMatiere[bm.matiereId] ?? null,
    rang: bm.rang, moyenneMax: bm.moyenneMax, moyenneMin: bm.moyenneMin,
    nomProfesseur: bm.nomProfesseur, appreciation: bm.appreciation,
    notesExamen: notesByMatiere[bm.matiereId] ?? [],
  })).sort((a, b) => a.matiereNom.localeCompare(b.matiereNom));

  const bulletinData = {
    ecoleName: tenant.name, ecoleVille: tenant.city ?? "Ville", ecolePays: tenant.country,
    ecoleLogo: tenant.logoUrl, chefEtablissement: tenant.chefEtablissement,
    signatureUrl: tenant.signatureUrl, cachetUrl: tenant.cachetUrl,
    eleveNom: eleve.nom, elevePrenom: eleve.prenom, eleveMatricule: eleve.matricule,
    eleveClasse: classe.nom, eleveNiveau: classe.niveau, eleveSexe: eleve.sexe,
    eleveDateNaissance: eleve.dateNaissance, periodeNom: periode.nom, periodeNumero: periode.numero,
    annee: annee.libelle, notes: notesMatiere, moyenneGenerale: bulletin.moyenneGenerale,
    moyenneClasse: bulletin.moyenneClasse, moyennePremier: bulletin.moyennePremier,
    heuresAbsence: bulletin.heuresAbsence, rang: bulletin.rang,
    effectifClasse: bulletin.effectifClasse, appreciation: bulletin.appreciation,
    generatedAt: bulletin.createdAt,
  };

  // Récupérer la facture
  const facture = await prisma.facture.findFirst({
    where: { id: "cmtfe3ppq000dpa07i77bzfoj", tenantId: TENANT_ID },
    include: {
      eleve: { select: { id: true, nom: true, prenom: true, matricule: true, classe: { select: { nom: true, niveau: true } }, parents: { include: { parent: true }, where: { isGardien: true }, take: 1 } } },
      paiements: { orderBy: { date: "desc" }, include: { enregistrePar: { select: { name: true } } } },
      createdBy: { select: { name: true } },
    },
  });
  const factureData = facture || {
    id: "demo", numero: "FAC-2026-DEMO", statut: "PAYEE", montant: 50000, devise: "DJF",
    libelle: "Frais de scolarité - Trimestre 1", echeance: null, createdAt: new Date(),
    eleve: { nom: eleve.nom, prenom: eleve.prenom, matricule: eleve.matricule, classe: { nom: classe.nom, niveau: classe.niveau } },
    paiements: [{ date: new Date(), montant: 50000, devise: "DJF", methode: "especes", reference: "REC-001", enregistrePar: { name: "Administration" } }],
    createdBy: { name: "Administration" },
  };

  const attestationData = {
    ecoleName: tenant.name, ecoleVille: tenant.city ?? "Ville", ecolePays: tenant.country,
    ecolePhone: tenant.phone, ecoleEmail: tenant.email, ecoleLogo: tenant.logoUrl, ecoleAddress: tenant.address,
    eleveNom: eleve.nom, elevePrenom: eleve.prenom, eleveMatricule: eleve.matricule,
    eleveClasse: classe.nom, eleveNiveau: classe.niveau, eleveSexe: eleve.sexe,
    eleveDateNaissance: eleve.dateNaissance, annee: annee.libelle, dateDelivrance: new Date(),
    chefEtablissement: tenant.chefEtablissement, signatureUrl: tenant.signatureUrl, cachetUrl: tenant.cachetUrl,
    honorifique: "M.", titre: "Attestation de Scolarité",
  };

  // Générer les 9 documents (3 styles × 3 documents)
  const maxExamNotes = Math.max(...notesMatiere.map(n => n.notesExamen.length), 0);

  for (let style = 1; style <= 3; style++) {
    // Bulletin
    const bullHtml = generateBulletinHTML(bulletinData, maxExamNotes, style);
    fs.writeFileSync(path.join(OUTPUT_DIR, `bulletin-style${style}.html`), bullHtml);
    console.log(`✓ Bulletin Style ${style}`);

    // Facture
    const factHtml = generateFactureHTML(factureData, tenant, style);
    fs.writeFileSync(path.join(OUTPUT_DIR, `facture-style${style}.html`), factHtml);
    console.log(`✓ Facture Style ${style}`);

    // Attestation
    const attHtml = generateAttestationHTML(attestationData, style);
    fs.writeFileSync(path.join(OUTPUT_DIR, `attestation-style${style}.html`), attHtml);
    console.log(`✓ Attestation Style ${style}`);
  }

  // Page index
  const indexHtml = generateIndexHTML();
  const indexPath = path.join(OUTPUT_DIR, "index.html");
  fs.writeFileSync(indexPath, indexHtml);
  console.log("\n✓ Page index:", indexPath);

  console.log("\n📄 Ouverture dans le navigateur...");
  execSync(`open "${indexPath}"`);
  console.log("✓ Terminé! 9 modèles générés.");
}

main().catch((e) => { console.error("Erreur:", e); process.exit(1); }).finally(() => prisma.$disconnect());
