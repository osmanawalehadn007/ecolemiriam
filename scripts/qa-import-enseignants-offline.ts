/**
 * QA — Import d'enseignants : analyse HORS PRODUCTION.
 * ============================================================
 * Exerce le vrai chemin d'analyse (parseEnseignantsWorkbook + analyzeImport)
 * avec des classeurs Excel synthétiques, en utilisant le vocabulaire réel de
 * l'établissement (sites, matières, classes, emails déjà pris) lu en base.
 *
 * AUCUNE ÉCRITURE : ni user, ni enseignant, ni audit. Le POST /api/import/
 * enseignants n'est jamais appelé (il créerait des comptes).
 *
 * Usage :
 *   set -a; . ./.env; set +a
 *   npx tsx scripts/qa-import-enseignants-offline.ts
 */
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import {
  analyzeImport,
  parseEnseignantsWorkbook,
  fileHash,
  type MatiereExistante,
  type SiteExistant,
  type ClasseExistante,
} from "@/lib/import-enseignants";

const TENANT = "cms8kt0b40001zbi3o63y7c5v";
const ANNEE = "2026-2027";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

/** Construit un classeur en mémoire et renvoie son ArrayBuffer. */
async function workbook(headers: string[], rows: (string | number)[][]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Enseignants");
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  const bytes = new Uint8Array(buf as ArrayBuffer);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

let pass = 0;
const echecs: string[] = [];

function check(label: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✔ ${label}`);
  } else {
    echecs.push(`${label} → ${detail}`);
    console.log(`  ✘ ${label} → ${detail}`);
  }
}

async function main() {
  // ── Contexte réel, en lecture seule ──────────────────────────────
  const [sites, matieres, classes, teacher] = await Promise.all([
    prisma.site.findMany({ where: { tenantId: TENANT, deletedAt: null }, select: { id: true, nom: true } }),
    prisma.matiere.findMany({ where: { tenantId: TENANT }, select: { id: true, nom: true, code: true }, take: 500 }),
    prisma.classe.findMany({
      where: { tenantId: TENANT, annee: ANNEE },
      select: { id: true, nom: true, niveau: true, siteId: true, annee: true },
    }),
    prisma.user.findFirst({ where: { tenantId: TENANT, role: "TEACHER" }, select: { email: true } }),
  ]);

  const sitesCtx: SiteExistant[] = sites.map((s) => ({ id: s.id, nom: s.nom }));
  const matieresCtx: MatiereExistante[] = matieres.map((m) => ({ id: m.id, nom: m.nom, code: m.code }));
  const classesCtx: ClasseExistante[] = classes.map((c) => ({
    id: c.id,
    nom: c.nom,
    niveau: c.niveau,
    siteId: c.siteId ?? "",
    annee: c.annee,
  }));

  console.log(
    `Contexte : ${sitesCtx.length} site(s), ${matieresCtx.length} matière(s), ` +
      `${classesCtx.length} classe(s) ${ANNEE}, enseignant de référence : ${teacher?.email ?? "AUCUN"}`,
  );

  const site1 = sitesCtx[0];
  const matiere1 = matieresCtx[0];
  if (!site1 || !matiere1 || !teacher?.email) {
    throw new Error("Contexte insuffisant : il faut au moins 1 site, 1 matière et 1 enseignant en base.");
  }

  // ── Fichier 1 : modèle officiel + cas limites ────────────────────
  const headers = ["Nom", "Email", "Site d'affectation", "Temps", "Téléphone", "Matière", "Classe"];
  const rows: (string | number)[][] = [
    ["ALI QA NOUVEAU", "qa.enseignant.1@example.com", site1.nom, "Plein", "+253 77000001", matiere1.nom, ""],
    ["DOUBLON FICHIER", "qa.enseignant.1@example.com", site1.nom, "Plein", "", "", ""],
    ["DEJA EN BASE", teacher.email, site1.nom, "Plein", "", "", ""],
    ["SITE INCONNU", "qa.enseignant.4@example.com", "Site Fantôme 404", "Plein", "", "", ""],
    ["MATIERE INCONNUE", "qa.enseignant.5@example.com", site1.nom, "Plein", "", "Zorglubologie 42", ""],
    ["SANS EMAIL", "", site1.nom, "Plein", "", "", ""],
    ["EMAIL INVALIDE", "pas-un-email", site1.nom, "Plein", "", "", ""],
    ["SANS SITE", "qa.enseignant.8@example.com", "", "Plein", "", "", ""],
    ["TEMPS PARTIEL", "qa.enseignant.9@example.com", site1.nom, "Vacation", "", "", ""],
    ["CLASSE A CREER", "qa.enseignant.10@example.com", site1.nom, "CDI", "", "", "99ème Z"],
  ];

  const buffer1 = await workbook(headers, rows);
  const parsed1 = await parseEnseignantsWorkbook(buffer1, sitesCtx.map((s) => s.nom), matieresCtx.map((m) => m.nom));

  console.log(`\n[Fichier 1 — modèle officiel] lignes exploitables=${parsed1.rows.length} erreurs=${parsed1.erreurs.length}`);
  console.log(`  erreurs : ${parsed1.erreurs.map((e) => `L${e.ligne}:${e.message}`).join(" | ") || "aucune"}`);

  const plan1 = analyzeImport(
    parsed1.rows,
    parsed1.erreurs,
    new Set([teacher.email.toLowerCase()]),
    matieresCtx,
    sitesCtx,
    parsed1.hash,
    classesCtx,
  );

  const ligne = (email: string) => plan1.lignes.find((l) => l.email === email);
  const erreur = (fragment: string) => parsed1.erreurs.find((e) => e.message.includes(fragment));

  check("ligne valide conservée avec son site résolu", ligne("qa.enseignant.1@example.com")?.siteId === site1.id);
  check("matière existante résolue en ID", ligne("qa.enseignant.1@example.com")?.matiereId === matiere1.id);
  check("email en double détecté (rejeté, pas créé)", !!erreur("Email en double"));
  check(
    "email déjà en base → EMAIL_EXISTANT + IGNORER",
    ligne(teacher.email.toLowerCase())?.verdict === "EMAIL_EXISTANT" &&
      ligne(teacher.email.toLowerCase())?.action === "IGNORER",
  );
  check(
    "site inconnu → SITE_INCONNU + IGNORER",
    ligne("qa.enseignant.4@example.com")?.verdict === "SITE_INCONNU" &&
      ligne("qa.enseignant.4@example.com")?.action === "IGNORER",
  );
  check(
    "matière inconnue → signalée mais enseignant créé",
    ligne("qa.enseignant.5@example.com")?.verdict === "MATIERE_INCONNUE" &&
      ligne("qa.enseignant.5@example.com")?.action === "CREER" &&
      !!ligne("qa.enseignant.5@example.com")?.siteId,
  );
  check("email manquant rejeté", !!erreur("Email manquant"));
  check("email invalide rejeté", !!erreur("Email invalide"));
  check("site manquant rejeté", !!erreur("Site d'affectation manquant"));
  check("« Vacation » interprété en temps partiel", ligne("qa.enseignant.9@example.com")?.tempsPlein === false);
  check(
    "classe inconnue → CLASSE_A_CREER",
    ligne("qa.enseignant.10@example.com")?.verdict === "CLASSE_A_CREER" &&
      ligne("qa.enseignant.10@example.com")?.classeACreer === true,
  );
  check("matières inconnues listées", plan1.matieresInconnues.includes("Zorglubologie 42"));
  check("sites inconnus listés", plan1.sitesInconnus.includes("Site Fantôme 404"));
  check(
    `résumé cohérent (aCreer=${plan1.resume.aCreer} attendu 4)`,
    plan1.resume.aCreer === 4,
    `attendu 4 CREER (lignes 1 valide, 5 matière inconnue, 9 vacation, 10 classe à créer)`,
  );
  check("hash stable pour un même fichier", (await parseEnseignantsWorkbook(buffer1)).hash === parsed1.hash);
  check(
    "hash différent pour un autre fichier",
    fileHash(await workbook(headers, [["X", "qa.other@example.com", site1.nom, "Plein", "", "", ""]])) !== parsed1.hash,
  );

  // ── Fichier 2 : en-têtes « bruités » (fichier réel mal formaté) ──
  const messy = await workbook(
    ["Prénom", "Nom de famille", "Email professionnel", "Téléphone pro", "Département", "Matière enseignée", "Site d'affectation", "Type de contrat"],
    [
      ["Ahmed", "Hassan Omar", "qa.messy.1@example.com", "+253 77 11 11 11", "Sciences", matiere1.nom, site1.nom, "Plein"],
      ["Yusuf", "Ismail", "qa.messy.2@example.com", "+253 77 66 66 66", "Histoire", "Zorglubologie 42", "Site Imaginaire", "Partiel"],
    ],
  );
  try {
    const parsed2 = await parseEnseignantsWorkbook(messy, sitesCtx.map((s) => s.nom), matieresCtx.map((m) => m.nom));
    const plan2 = analyzeImport(parsed2.rows, parsed2.erreurs, new Set(), matieresCtx, sitesCtx, parsed2.hash, classesCtx);
    check(
      "en-têtes bruités : 2 lignes lues, 1 créable, 1 site inconnu",
      parsed2.rows.length === 2 && plan2.resume.aCreer === 1 && plan2.sitesInconnus.length === 1,
      `lignes=${parsed2.rows.length} erreurs=${parsed2.erreurs.length} aCreer=${plan2.resume.aCreer} sitesInconnus=${plan2.resume.sitesInconnus.length}`,
    );
  } catch (e) {
    check("en-têtes bruités : lecture possible", false, e instanceof Error ? e.message.slice(0, 160) : "erreur inconnue");
  }

  // ── Fichier 3 : mauvais modèle (doit être refusé proprement) ─────
  try {
    // Volontairement sans colonnes obligatoires (ni « Temps », ni « Site »).
    // Domaine du projet : le garde-fou CI (`scan-secrets`) ne doit pas prendre
    // ce couple e-mail/étiquette pour un identifiant versionné.
    await parseEnseignantsWorkbook(
      await workbook(["Nom", "Email", "Rôle"], [["A", "qa.modele@ecolemiriam.com", "ROLE_INCONNU"]]),
      [],
      [],
    );
    check("mauvais modèle refusé avec message actionnable", false, "aucune erreur levée");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    check(
      "mauvais modèle refusé avec message actionnable",
      msg.includes("Colonnes obligatoires manquantes"),
      msg.slice(0, 140),
    );
  }

  console.log(`\n═══ ${pass} vérification(s) OK, ${echecs.length} échec(s) ═══`);
  if (echecs.length) {
    for (const e of echecs) console.log(`  ✘ ${e}`);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
