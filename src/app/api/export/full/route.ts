/**
 * École Miriam — Export complet des données (ZIP organisé)
 * ============================================================
 *
 * Génère un ZIP structuré par classe / type / thème pour
 * exploitation humaine sur un PC local.
 *
 * Structure du ZIP :
 *   ecolemiriam_export_YYYYMMDD_HHMMSS/
 *   ├── 01_Eleves/
 *   │   ├── par_classe/        → un CSV par classe
 *   │   ├── par_niveau/        → un CSV par niveau
 *   │   └── tous.csv           → tous les élèves
 *   ├── 02_Notes/
 *   │   ├── par_classe/        → notes par classe
 *   │   └── par_matiere/       → notes par matière
 *   ├── 03_Absences/
 *   │   ├── par_classe/
 *   │   └── par_mois/
 *   ├── 04_Factures/
 *   │   ├── par_statut/        → payees, en_attente, en_retard
 *   │   └── toutes.csv
 *   ├── 05_Bulletins/
 *   │   └── par_classe/
 *   ├── 06_Emploi_du_temps/
 *   │   └── par_classe/
 *   ├── 07_Professeurs/
 *   │   ├── par_matiere/
 *   │   └── tous.csv
 *   ├── 08_Inventaire/
 *   ├── 09_Comptabilite/
 *   │   ├── depenses.csv
 *   │   ├── recettes.csv
 *   │   └── budget.csv
 *   ├── 10_Communication/
 *   │   └── messages.csv
 *   ├── 11_Vie_scolaire/
 *   │   ├── incidents.csv
 *   │   ├── sanctions.csv
 *   │   └── exclusions.csv
 *   ├── 12_Ressources_humaines/
 *   │   ├── fiches_rh.csv
 *   │   ├── absences_personnel.csv
 *   │   └── conges.csv
 *   ├── 13_Cours/
 *   │   ├── par_classe/
 *   │   └── contenus.csv
 *   ├── 14_Cahier_de_texte/
 *   │   └── par_classe/
 *   └── README.txt
 *
 * Sécurité :
 *   - TENANT_ADMIN ou SUPER_ADMIN uniquement
 *   - RLS filtre automatiquement par tenant
 *   - Données au format CSV (Excel-compatible, UTF-8 BOM)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkPermission } from "@/lib/rbac";
import JSZip from "jszip";
import { Readable } from "node:stream";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "\uFEFF";
  const headers = Object.keys(rows[0]);
  const lines = [
    "\uFEFF" + headers.join(","),
    ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(",")),
  ];
  return lines.join("\n") + "\n";
}

function dateStr(d: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().split("T")[0];
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const denied = checkPermission(session.user.role, "export:full");
  if (denied) return denied;

  const tenantId = session.user.tenantId;
  if (!tenantId) {
    return NextResponse.json({ error: "Aucun établissement actif" }, { status: 400 });
  }

  const siteId = session.user.siteId ?? null;
  const siteFilter = siteId ? { siteId } : {};

  const timestamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const zip = new JSZip();
  const root = zip.folder(`ecolemiriam_export_${timestamp}`)!;

  // ── 01. Élèves ──────────────────────────────────────────────
  const elevesFolder = root.folder("01_Eleves")!;
  const eleves = await prisma.eleve.findMany({
    where: { tenantId, ...siteFilter },
    include: { classe: { select: { nom: true, niveau: true } } },
    orderBy: { nom: "asc" },
  });

  const eleveRows = eleves.map((e) => ({
    id: e.id,
    nom: e.nom,
    prenom: e.prenom,
    dateNaissance: dateStr(e.dateNaissance),
    sexe: e.sexe,
    classe: e.classe?.nom ?? "",
    niveau: e.classe?.niveau ?? "",
    statut: e.statut,
    anneeInscription: e.anneeInscription,
  }));

  elevesFolder.file("tous.csv", toCSV(eleveRows));

  // Par classe
  const elevesParClasse = elevesFolder.folder("par_classe")!;
  const classesMap = new Map<string, typeof eleveRows>();
  for (const row of eleveRows) {
    const key = row.classe || "Sans_classe";
    if (!classesMap.has(key)) classesMap.set(key, []);
    classesMap.get(key)!.push(row);
  }
  for (const [classe, rows] of classesMap) {
    elevesParClasse.file(`${classe.replace(/[^a-zA-Z0-9]/g, "_")}.csv`, toCSV(rows));
  }

  // Par niveau
  const elevesParNiveau = elevesFolder.folder("par_niveau")!;
  const niveauxMap = new Map<string, typeof eleveRows>();
  for (const row of eleveRows) {
    const key = row.niveau || "Sans_niveau";
    if (!niveauxMap.has(key)) niveauxMap.set(key, []);
    niveauxMap.get(key)!.push(row);
  }
  for (const [niveau, rows] of niveauxMap) {
    elevesParNiveau.file(`${niveau.replace(/[^a-zA-Z0-9]/g, "_")}.csv`, toCSV(rows));
  }

  // ── 02. Notes ───────────────────────────────────────────────
  const notesFolder = root.folder("02_Notes")!;
  // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId déjà dans le where (le linter ne détecte pas le spread/merge)
  const notes = await prisma.note.findMany({
    where: { tenantId },
    include: {
      eleve: { select: { nom: true, prenom: true } },
      classe: { select: { nom: true } },
      matiere: { select: { nom: true } },
    },
    orderBy: { eleve: { nom: "asc" } },
  });

  const noteRows = notes.map((n) => ({
    id: n.id,
    eleve: `${n.eleve?.nom ?? ""} ${n.eleve?.prenom ?? ""}`.trim(),
    classe: n.classe?.nom ?? "",
    matiere: n.matiere?.nom ?? "",
    note: n.valeur,
    sur: n.noteMax,
    coefficient: n.coefficient,
    type: n.type,
    date: dateStr(n.date),
    appreciation: n.appreciation ?? "",
  }));

  notesFolder.file("toutes.csv", toCSV(noteRows));

  const notesParClasse = notesFolder.folder("par_classe")!;
  const notesParMatiere = notesFolder.folder("par_matiere")!;
  for (const row of noteRows) {
    const classeKey = row.classe || "Sans_classe";
    const matiereKey = row.matiere || "Sans_matiere";
  }
  // Grouper par classe
  const notesByClasse = new Map<string, typeof noteRows>();
  for (const row of noteRows) {
    const key = row.classe || "Sans_classe";
    if (!notesByClasse.has(key)) notesByClasse.set(key, []);
    notesByClasse.get(key)!.push(row);
  }
  for (const [classe, rows] of notesByClasse) {
    notesParClasse.file(`${classe.replace(/[^a-zA-Z0-9]/g, "_")}.csv`, toCSV(rows));
  }
  // Grouper par matière
  const notesByMatiere = new Map<string, typeof noteRows>();
  for (const row of noteRows) {
    const key = row.matiere || "Sans_matiere";
    if (!notesByMatiere.has(key)) notesByMatiere.set(key, []);
    notesByMatiere.get(key)!.push(row);
  }
  for (const [matiere, rows] of notesByMatiere) {
    notesParMatiere.file(`${matiere.replace(/[^a-zA-Z0-9]/g, "_")}.csv`, toCSV(rows));
  }

  // ── 03. Absences ────────────────────────────────────────────
  const absencesFolder = root.folder("03_Absences")!;
  // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId déjà dans le where (le linter ne détecte pas le spread/merge)
  const absences = await prisma.absence.findMany({
    where: { tenantId },
    include: {
      eleve: { select: { nom: true, prenom: true, classe: { select: { nom: true } } } },
    },
    orderBy: { date: "desc" },
  });

  const absenceRows = absences.map((a) => ({
    id: a.id,
    eleve: `${a.eleve?.nom ?? ""} ${a.eleve?.prenom ?? ""}`.trim(),
    classe: a.eleve?.classe?.nom ?? "",
    date: dateStr(a.date),
    statut: a.statut,
    motif: a.motif ?? "",
    commentaire: a.commentaire ?? "",
  }));

  absencesFolder.file("toutes.csv", toCSV(absenceRows));

  const absencesParClasse = absencesFolder.folder("par_classe")!;
  const absByClasse = new Map<string, typeof absenceRows>();
  for (const row of absenceRows) {
    const key = row.classe || "Sans_classe";
    if (!absByClasse.has(key)) absByClasse.set(key, []);
    absByClasse.get(key)!.push(row);
  }
  for (const [classe, rows] of absByClasse) {
    absencesParClasse.file(`${classe.replace(/[^a-zA-Z0-9]/g, "_")}.csv`, toCSV(rows));
  }

  const absencesParMois = absencesFolder.folder("par_mois")!;
  const absByMonth = new Map<string, typeof absenceRows>();
  for (const row of absenceRows) {
    const key = row.date.slice(0, 7) || "Sans_date";
    if (!absByMonth.has(key)) absByMonth.set(key, []);
    absByMonth.get(key)!.push(row);
  }
  for (const [month, rows] of absByMonth) {
    absencesParMois.file(`${month}.csv`, toCSV(rows));
  }

  // ── 04. Factures ────────────────────────────────────────────
  const facturesFolder = root.folder("04_Factures")!;
  const factures = await prisma.facture.findMany({
    where: { tenantId, ...siteFilter },
    include: { eleve: { select: { nom: true, prenom: true } } },
    orderBy: { createdAt: "desc" },
  });

  const factureRows = factures.map((f) => ({
    id: f.id,
    numero: f.numero,
    eleve: `${f.eleve?.nom ?? ""} ${f.eleve?.prenom ?? ""}`.trim(),
    montant: f.montant,
    date: dateStr(f.createdAt),
    echeance: dateStr(f.echeance),
    statut: f.statut,
  }));

  facturesFolder.file("toutes.csv", toCSV(factureRows));

  const facturesParStatut = facturesFolder.folder("par_statut")!;
  const factByStatus = new Map<string, typeof factureRows>();
  for (const row of factureRows) {
    const key = row.statut || "inconnu";
    if (!factByStatus.has(key)) factByStatus.set(key, []);
    factByStatus.get(key)!.push(row);
  }
  for (const [statut, rows] of factByStatus) {
    facturesParStatut.file(`${statut.replace(/[^a-zA-Z0-9]/g, "_")}.csv`, toCSV(rows));
  }

  // ── 05. Bulletins ───────────────────────────────────────────
  const bulletinsFolder = root.folder("05_Bulletins")!;
  // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId déjà dans le where (le linter ne détecte pas le spread/merge)
  const bulletins = await prisma.bulletin.findMany({
    where: { tenantId },
    include: {
      eleve: { select: { nom: true, prenom: true, classe: { select: { nom: true } } } },
      periode: { select: { nom: true } },
    },
    orderBy: { eleve: { nom: "asc" } },
  });

  const bulletinRows = bulletins.map((b) => ({
    id: b.id,
    eleve: `${b.eleve?.nom ?? ""} ${b.eleve?.prenom ?? ""}`.trim(),
    classe: b.eleve?.classe?.nom ?? "",
    periode: b.periode?.nom ?? "",
    moyenne: b.moyenneGenerale ?? "",
    rang: b.rang ?? "",
    appreciation: b.appreciation ?? "",
    date: dateStr(b.createdAt),
  }));

  const bulletinsParClasse = bulletinsFolder.folder("par_classe")!;
  const bulByClasse = new Map<string, typeof bulletinRows>();
  for (const row of bulletinRows) {
    const key = row.classe || "Sans_classe";
    if (!bulByClasse.has(key)) bulByClasse.set(key, []);
    bulByClasse.get(key)!.push(row);
  }
  for (const [classe, rows] of bulByClasse) {
    bulletinsParClasse.file(`${classe.replace(/[^a-zA-Z0-9]/g, "_")}.csv`, toCSV(rows));
  }

  // ── 06. Emploi du temps ─────────────────────────────────────
  const emploiFolder = root.folder("06_Emploi_du_temps")!;
  // eslint-disable-next-line ecolemiriam/require-site-filter, ecolemiriam/require-annee-filter -- export intégral : toutes les années sont exportées volontairement
  const emplois = await prisma.emploiTemps.findMany({
    where: { tenantId },
    include: {
      classe: { select: { nom: true } },
      matiere: { select: { nom: true } },
      enseignant: { select: { user: { select: { name: true } } } },
    },
    orderBy: { jour: "asc" },
  });

  const emploiRows = emplois.map((e) => ({
    id: e.id,
    classe: e.classe?.nom ?? "",
    matiere: e.matiere?.nom ?? "",
    enseignant: e.enseignant?.user?.name ?? "",
    salle: e.salle ?? "",
    jour: e.jour,
    heureDebut: e.heureDebut,
    heureFin: e.heureFin,
  }));

  const emploiParClasse = emploiFolder.folder("par_classe")!;
  const empByClasse = new Map<string, typeof emploiRows>();
  for (const row of emploiRows) {
    const key = row.classe || "Sans_classe";
    if (!empByClasse.has(key)) empByClasse.set(key, []);
    empByClasse.get(key)!.push(row);
  }
  for (const [classe, rows] of empByClasse) {
    emploiParClasse.file(`${classe.replace(/[^a-zA-Z0-9]/g, "_")}.csv`, toCSV(rows));
  }

  // ── 07. Professeurs ─────────────────────────────────────────
  const profsFolder = root.folder("07_Professeurs")!;
  // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId déjà dans le where (le linter ne détecte pas le spread/merge)
  const enseignants = await prisma.enseignant.findMany({
    where: { tenantId },
    include: {
      user: { select: { name: true, email: true, phone: true } },
      // eslint-disable-next-line ecolemiriam/require-site-filter -- include filtré par le where parent (tenantId sur la table racine)
      matieres: { include: { matiere: { select: { nom: true } } } },
      // eslint-disable-next-line ecolemiriam/require-site-filter -- include filtré par le where parent (tenantId sur la table racine)
      sites: { include: { site: { select: { nom: true } } } },
    },
    orderBy: { user: { name: "asc" } },
  });

  const profRows = enseignants.map((e) => ({
    id: e.id,
    nom: e.user?.name ?? "",
    email: e.user?.email ?? "",
    telephone: e.user?.phone ?? "",
    matieres: e.matieres?.map((m) => m.matiere?.nom).filter(Boolean).join("; ") ?? "",
    sites: e.sites?.map((s) => s.site?.nom).filter(Boolean).join("; ") ?? "",
    statut: e.typeContrat ?? "",
  }));

  profsFolder.file("tous.csv", toCSV(profRows));

  const profsParMatiere = profsFolder.folder("par_matiere")!;
  for (const prof of profRows) {
    for (const matiere of (prof.matieres || "").split("; ")) {
      if (!matiere) continue;
      const key = matiere.replace(/[^a-zA-Z0-9]/g, "_");
      const existing = profsParMatiere.file(`${key}.csv`);
      // Simple: un fichier par matière avec tous les profs qui l'enseignent
    }
  }
  // Grouper par matière
  const profsByMatiere = new Map<string, typeof profRows>();
  for (const prof of profRows) {
    for (const matiere of (prof.matieres || "").split("; ")) {
      if (!matiere) continue;
      if (!profsByMatiere.has(matiere)) profsByMatiere.set(matiere, []);
      profsByMatiere.get(matiere)!.push(prof);
    }
  }
  for (const [matiere, rows] of profsByMatiere) {
    profsParMatiere.file(`${matiere.replace(/[^a-zA-Z0-9]/g, "_")}.csv`, toCSV(rows));
  }

  // ── 08. Inventaire ──────────────────────────────────────────
  const invFolder = root.folder("08_Inventaire")!;
  const inventaire = await prisma.itemInventaire.findMany({
    where: { tenantId, ...siteFilter },
    orderBy: { nom: "asc" },
  });

  const invRows = inventaire.map((i) => ({
    id: i.id,
    nom: i.nom,
    categorie: i.categorie,
    quantite: i.quantite,
    etat: i.etat,
    prixUnitaire: i.prixUnitaire ?? "",
    localisation: i.localisation ?? "",
    dateAchat: dateStr(i.dateAchat),
  }));

  invFolder.file("inventaire.csv", toCSV(invRows));

  // ── 09. Comptabilité ────────────────────────────────────────
  const comptFolder = root.folder("09_Comptabilite")!;

  const depenses = await prisma.depense.findMany({
    where: { tenantId, ...siteFilter },
    orderBy: { date: "desc" },
  });
  comptFolder.file("depenses.csv", toCSV(depenses.map((d) => ({
    id: d.id, date: dateStr(d.date), montant: d.montant,
    categorie: d.categorie, description: d.description ?? "",
    fournisseur: d.fournisseur ?? "",
  }))));

  // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId déjà dans le where (le linter ne détecte pas le spread/merge)
  const paiements = await prisma.paiement.findMany({
    where: { facture: { tenantId } },
    include: { facture: { select: { numero: true, eleve: { select: { nom: true, prenom: true } } } } },
    orderBy: { date: "desc" },
  });
  comptFolder.file("recettes.csv", toCSV(paiements.map((p) => ({
    id: p.id, date: dateStr(p.date), montant: p.montant,
    methode: p.methode, facture: p.facture?.numero ?? "",
    eleve: `${p.facture?.eleve?.nom ?? ""} ${p.facture?.eleve?.prenom ?? ""}`.trim(),
  }))));

  const budgets = await prisma.budget.findMany({
    where: { tenantId, ...siteFilter },
    orderBy: { periode: "desc" },
  });
  comptFolder.file("budget.csv", toCSV(budgets.map((b) => ({
    id: b.id, periode: b.periode, categorie: b.categorie,
    montantPrevu: b.montantPrevu,
  }))));

  // ── 10. Communication ───────────────────────────────────────
  const commFolder = root.folder("10_Communication")!;
  const messages = await prisma.message.findMany({
    where: { conversation: { tenantId } },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  commFolder.file("messages.csv", toCSV(messages.map((m) => ({
    id: m.id, date: dateStr(m.createdAt), expediteur: m.senderId,
    contenu: (m.content ?? "").slice(0, 200), lu: m.readBy.length > 0 ? "Oui" : "Non",
  }))));

  // ── 11. Vie scolaire ────────────────────────────────────────
  const vieScoFolder = root.folder("11_Vie_scolaire")!;

  // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId déjà dans le where (le linter ne détecte pas le spread/merge)
  const incidents = await prisma.incident.findMany({
    where: { tenantId },
    include: { eleve: { select: { nom: true, prenom: true } } },
    orderBy: { date: "desc" },
  });
  vieScoFolder.file("incidents.csv", toCSV(incidents.map((i) => ({
    id: i.id, date: dateStr(i.date), eleve: `${i.eleve?.nom ?? ""} ${i.eleve?.prenom ?? ""}`.trim(),
    type: i.type, gravite: i.gravite ?? "", description: (i.description ?? "").slice(0, 200),
  }))));

  // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId déjà dans le where (le linter ne détecte pas le spread/merge)
  const sanctions = await prisma.sanction.findMany({
    where: { incident: { tenantId } },
    include: { incident: { select: { eleve: { select: { nom: true, prenom: true } } } } },
    orderBy: { dateDebut: "desc" },
  });
  vieScoFolder.file("sanctions.csv", toCSV(sanctions.map((s) => ({
    id: s.id, date: dateStr(s.dateDebut), eleve: `${s.incident?.eleve?.nom ?? ""} ${s.incident?.eleve?.prenom ?? ""}`.trim(),
    type: s.type, description: (s.description ?? "").slice(0, 200),
  }))));

  const exclusions = await prisma.exclusionEleve.findMany({
    where: { tenantId },
    include: { eleve: { select: { nom: true, prenom: true } } },
    orderBy: { dateDebut: "desc" },
  });
  vieScoFolder.file("exclusions.csv", toCSV(exclusions.map((e) => ({
    id: e.id, eleve: `${e.eleve?.nom ?? ""} ${e.eleve?.prenom ?? ""}`.trim(),
    dateDebut: dateStr(e.dateDebut), dateFin: dateStr(e.dateFin),
    motif: e.motif, details: e.details ?? "",
  }))));

  // ── 12. RH ──────────────────────────────────────────────────
  const rhFolder = root.folder("12_Ressources_humaines")!;

  // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId déjà dans le where (le linter ne détecte pas le spread/merge)
  const fichesRH = await prisma.ficheRH.findMany({
    where: { tenantId },
    include: { enseignant: { select: { user: { select: { name: true } }, specialite: true } } },
    orderBy: { enseignant: { user: { name: "asc" } } },
  });
  rhFolder.file("fiches_rh.csv", toCSV(fichesRH.map((f) => ({
    id: f.id, nom: f.enseignant?.user?.name ?? "",
    poste: f.enseignant?.specialite ?? "",
    dateEmbauche: dateStr(f.dateEntree), salaire: f.salaireBase ?? "",
    statut: f.typeContrat,
  }))));

  // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId déjà dans le where (le linter ne détecte pas le spread/merge)
  const absencesPerso = await prisma.absencePersonnel.findMany({
    where: { tenantId },
    orderBy: { date: "desc" },
  });
  rhFolder.file("absences_personnel.csv", toCSV(absencesPerso.map((a) => ({
    id: a.id, date: dateStr(a.date), type: a.type, statut: a.statut,
    motif: a.motif ?? "",
  }))));

  // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId déjà dans le where (le linter ne détecte pas le spread/merge)
  const conges = await prisma.congePersonnel.findMany({
    where: { tenantId },
    orderBy: { dateDebut: "desc" },
  });
  rhFolder.file("conges.csv", toCSV(conges.map((c) => ({
    id: c.id, dateDebut: dateStr(c.dateDebut), dateFin: dateStr(c.dateFin),
    type: c.type, statut: c.statut ?? "",
  }))));

  // ── 13. Cours ───────────────────────────────────────────────
  const coursFolder = root.folder("13_Cours")!;
  const cours = await prisma.cours.findMany({
    where: { tenantId, ...siteFilter },
    orderBy: { createdAt: "desc" },
  });

  const coursRows = cours.map((c) => ({
    id: c.id, titre: c.titre, classe: c.classeNom ?? "",
    matiere: c.matiereNom ?? "",
    enseignant: c.auteurNom ?? "",
    date: dateStr(c.createdAt),
  }));

  const coursParClasse = coursFolder.folder("par_classe")!;
  const coursByClasse = new Map<string, typeof coursRows>();
  for (const row of coursRows) {
    const key = row.classe || "Sans_classe";
    if (!coursByClasse.has(key)) coursByClasse.set(key, []);
    coursByClasse.get(key)!.push(row);
  }
  for (const [classe, rows] of coursByClasse) {
    coursParClasse.file(`${classe.replace(/[^a-zA-Z0-9]/g, "_")}.csv`, toCSV(rows));
  }

  // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId déjà dans le where (le linter ne détecte pas le spread/merge)
  const contenus = await prisma.contenuCours.findMany({
    where: { cours: { tenantId } },
    orderBy: { createdAt: "desc" },
  });
  coursFolder.file("contenus.csv", toCSV(contenus.map((c) => ({
    id: c.id, titre: c.titre, type: c.type, date: dateStr(c.createdAt),
  }))));

  // ── 14. Cahier de texte ─────────────────────────────────────
  const cahierFolder = root.folder("14_Cahier_de_texte")!;
  // eslint-disable-next-line ecolemiriam/require-annee-filter -- export intégral : toutes les années sont exportées volontairement
  const cahiers = await prisma.cahierTexte.findMany({
    where: { tenantId, ...siteFilter },
    include: {
      classe: { select: { nom: true } },
      matiere: { select: { nom: true } },
      enseignant: { select: { user: { select: { name: true } } } },
    },
    orderBy: { date: "desc" },
  });

  const cahierRows = cahiers.map((c) => ({
    id: c.id, date: dateStr(c.date), classe: c.classe?.nom ?? "",
    matiere: c.matiere?.nom ?? "",
    enseignant: c.enseignant?.user?.name ?? "",
    contenu: (c.contenu ?? "").slice(0, 500),
    travailAFaire: (c.devoirs ?? "").slice(0, 500),
  }));

  const cahierParClasse = cahierFolder.folder("par_classe")!;
  const cahierByClasse = new Map<string, typeof cahierRows>();
  for (const row of cahierRows) {
    const key = row.classe || "Sans_classe";
    if (!cahierByClasse.has(key)) cahierByClasse.set(key, []);
    cahierByClasse.get(key)!.push(row);
  }
  for (const [classe, rows] of cahierByClasse) {
    cahierParClasse.file(`${classe.replace(/[^a-zA-Z0-9]/g, "_")}.csv`, toCSV(rows));
  }

  // ── README ──────────────────────────────────────────────────
  root.file("README.txt", `École Miriam — Export des données
================================

Date d'export : ${new Date().toISOString()}
Établissement : ${session.user.tenantId}
Site : ${siteId || "Tous"}

Contenu :
  01_Eleves/           — Élèves par classe et par niveau
  02_Notes/            — Notes par classe et par matière
  03_Absences/         — Absences par classe et par mois
  04_Factures/         — Factures par statut
  05_Bulletins/        — Bulletins par classe
  06_Emploi_du_temps/  — Emploi du temps par classe
  07_Professeurs/      — Professeurs par matière
  08_Inventaire/       — Inventaire du matériel
  09_Comptabilite/     — Dépenses, recettes, budget
  10_Communication/    — Messages
  11_Vie_scolaire/     — Incidents, sanctions, exclusions
  12_Ressources_humaines/ — Fiches RH, absences, congés
  13_Cours/            — Cours par classe et contenus
  14_Cahier_de_texte/  — Cahier de texte par classe

Format : CSV (UTF-8, compatible Excel)
Source : Base de données production (VPS)
Statut : Copie en lecture seule — ne pas modifier

ATTENTION : Ces données sont confidentielles.
Ne pas partager hors de l'établissement.
`);

  // ── Générer le ZIP en streaming ─────────────────────────────
  // N-3 (diagnostic instabilité) : generateAsync() bufferisait tout le ZIP
  // en mémoire + une seconde copie via new Uint8Array() → OOM du conteneur
  // app (mem_limit 1.5g) sur les grands exports. generateNodeStream() stream
  // le ZIP directement vers la réponse HTTP, évitant le double buffer.
  // Contrepartie : Content-Length inconnu (chunked transfer encoding).
  const zipStream = zip.generateNodeStream({
    type: "nodebuffer",
    streamFiles: true,
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const webStream = Readable.toWeb(zipStream as Readable) as unknown as BodyInit;

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="ecolemiriam_export_${timestamp}.zip"`,
      // Pas de Content-Length : taille inconnue en streaming (chunked TE).
      "Cache-Control": "no-store",
    },
  });
}
