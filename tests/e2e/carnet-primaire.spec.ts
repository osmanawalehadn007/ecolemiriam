/**
 * Carnet du primaire (1ère à 5ème année) — parcours RÉEL.
 * ============================================================
 *
 * Pilote l'application telle qu'elle tourne (formulaire d'évaluation, saisie des
 * notes, éditeur de carnet, paramétrage, fenêtre d'impression) et vérifie l'état
 * final EN BASE. Comme les autres specs e2e, il ÉCRIT : base PostgreSQL jetable
 * locale uniquement (le garde-fou de playwright.config.ts refuse la production).
 *
 * Données : la seed (tenant `lycee-demo-seed`, année 2025-2026) complétée ici par
 * une classe « 1ère A » (format A / EVA / NA) et une classe « 4ème B » (format
 * points), leurs élèves et leurs matières.
 */

import { PrismaClient } from "@prisma/client";
import { test, expect } from "./fixtures";

const prisma = new PrismaClient();
const ANNEE = "2025-2026";
const PREFIXE = "CARNETE2E";

interface Contexte {
  tenantId: string;
  periodeId: string;
  classe1: string;
  classe4: string;
  eleves1: { id: string; nom: string }[];
  eleve4: string;
  matieres: Record<string, string>;
  enseignantNom: string;
}

let ctx: Contexte;

test.describe.configure({ mode: "serial" });

// Les appels directs à l'API passent la protection CSRF comme ceux d'un navigateur :
// avec un en-tête Origin identique à l'origine de l'application.
test.use({ extraHTTPHeaders: { Origin: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001" } });

async function nettoyer(tenantId: string) {
  await prisma.carnetPrimaire.deleteMany({ where: { eleve: { matricule: { startsWith: PREFIXE } } } });
  await prisma.note.deleteMany({ where: { matiere: { code: { startsWith: PREFIXE } } } });
  await prisma.evaluation.deleteMany({ where: { matiere: { code: { startsWith: PREFIXE } } } });
  await prisma.eleve.deleteMany({ where: { matricule: { startsWith: PREFIXE } } });
  await prisma.classe.deleteMany({ where: { tenantId, nom: { in: ["1ère A", "4ème B"] } } });
  await prisma.matiere.deleteMany({ where: { tenantId, code: { startsWith: PREFIXE } } });
  await prisma.carnetConfiguration.deleteMany({ where: { tenantId } });
}

test.beforeAll(async () => {
  const tenant = await prisma.tenant.findFirstOrThrow({ where: { slug: "lycee-demo-seed" } });
  const tenantId = tenant.id;
  const periode = await prisma.periode.findFirstOrThrow({ where: { annee: { tenantId }, isCurrent: true } });
  const enseignant = await prisma.enseignant.findFirstOrThrow({ where: { tenantId }, include: { user: true } });

  // Repart d'un état propre : les données de ce spec portent toutes le préfixe.
  await nettoyer(tenantId);
  await prisma.tenant.update({ where: { id: tenantId }, data: { chefEtablissement: "Mme Directrice Test" } });

  const classe1 = await prisma.classe.create({
    data: { tenantId, nom: "1ère A", niveau: "1ère", annee: ANNEE, profPrincipalId: enseignant.id },
  });
  const classe4 = await prisma.classe.create({ data: { tenantId, nom: "4ème B", niveau: "4ème", annee: ANNEE } });

  const eleve = (n: number, nom: string, classeId: string) =>
    prisma.eleve.create({
      data: {
        tenantId,
        matricule: `${PREFIXE}${n}`,
        nom,
        prenom: "Test",
        dateNaissance: new Date("2018-03-09T00:00:00.000Z"),
        lieuNaissance: "Djibouti",
        sexe: "F",
        classeId,
        anneeInscription: ANNEE,
      },
    });
  const eleves1 = [await eleve(1, "ALPHA", classe1.id), await eleve(2, "BRAVO", classe1.id)];
  const eleve4 = await eleve(3, "CHARLIE", classe4.id);

  const matiere = (code: string, nom: string, niveau: string) =>
    prisma.matiere.create({ data: { tenantId, nom, code: `${PREFIXE}${code}`, niveau } });
  const matieres = {
    lecture1: (await matiere("L1", "Lecture", "1")).id,
    maths1: (await matiere("M1", "Maths", "1")).id,
    natation1: (await matiere("N1", "Natation", "1")).id,
    histoire4: (await matiere("H4", "Histoire", "4")).id,
    francais4: (await matiere("F4", "Français", "4")).id,
  };

  ctx = {
    tenantId,
    periodeId: periode.id,
    classe1: classe1.id,
    classe4: classe4.id,
    eleves1: eleves1.map((e) => ({ id: e.id, nom: e.nom })),
    eleve4: eleve4.id,
    matieres,
    enseignantNom: enseignant.user.name ?? "",
  };
});

test.afterAll(async () => {
  // Les autres specs partagent la base : on ne laisse ni classe, ni élève, ni note derrière nous.
  if (ctx) await nettoyer(ctx.tenantId);
  await prisma.$disconnect();
});

/** Crée une évaluation par l'API (comme le formulaire) et renvoie son identifiant. */
async function creerEvaluation(
  page: import("@playwright/test").Page,
  corps: Record<string, unknown>
): Promise<{ id: string; status: number }> {
  const res = await page.request.post("/api/evaluations", {
    data: {
      titre: "Devoir test",
      type: "DEVOIR",
      periodeId: ctx.periodeId,
      date: "2025-11-20T09:00",
      duree: 30,
      coefficient: 1,
      ...corps,
    },
  });
  const json = await res.json().catch(() => ({}));
  return { id: json.id, status: res.status() };
}

async function saisirNotes(page: import("@playwright/test").Page, evaluationId: string, notes: Record<string, number>) {
  const res = await page.request.put(`/api/evaluations/${evaluationId}/notes`, {
    data: { notes: Object.entries(notes).map(([eleveId, valeur]) => ({ eleveId, valeur })) },
  });
  expect(res.status()).toBe(200);
}

test("le formulaire d'évaluation propose module et compétence pour une classe du primaire seulement", async ({ authedPage: page }) => {
  await page.goto("/evaluations");
  await page.getByRole("button", { name: /Ajouter un examen/ }).click();
  const dialog = page.getByRole("dialog");

  // Classe du secondaire : aucune section carnet.
  await dialog.getByRole("combobox").nth(1).click();
  await page.getByRole("option", { name: "Terminale A1" }).click();
  await expect(dialog.getByText("Carnet du primaire")).toHaveCount(0);

  // Classe du primaire : la section apparaît, le module est obligatoire.
  await dialog.getByRole("combobox").nth(1).click();
  await page.getByRole("option", { name: "1ère A" }).click();
  await expect(dialog.getByText("Carnet du primaire")).toBeVisible();
  await expect(dialog.locator("#moduleCarnet")).toHaveAttribute("required", "");

  // Matière sans domaine : avertissement ; matière reliée (Lecture → Français) : choix de la compétence.
  await dialog.getByRole("combobox").nth(2).click();
  await page.getByRole("option", { name: "Natation" }).click();
  await dialog.locator("#moduleCarnet").selectOption("1");
  await expect(dialog.getByText(/n'est reliée à aucun domaine du carnet/)).toBeVisible();

  await dialog.getByRole("combobox").nth(2).click();
  await page.getByRole("option", { name: "Lecture" }).click();
  await expect(dialog.getByText(/n'est reliée à aucun domaine/)).toHaveCount(0);
  await expect(dialog.locator("#ligneCarnet")).toBeVisible();
  await expect(dialog.locator("#ligneCarnet option")).toHaveCount(4); // « tout le domaine » + 3 lignes de Français (1ère)

  // Création réelle : module 1, compétence C2 → enregistré en base.
  await dialog.locator("#titre").fill(`${PREFIXE} formulaire`);
  await dialog.getByRole("combobox").nth(3).click();
  await page.getByRole("option").first().click();
  await dialog.locator("#date").fill("2025-11-20T09:00");
  await dialog.locator("#ligneCarnet").selectOption("1");
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Évaluation planifiée avec succès")).toBeVisible();

  const creee = await prisma.evaluation.findFirstOrThrow({ where: { titre: `${PREFIXE} formulaire` } });
  expect(creee).toMatchObject({ moduleCarnet: 1, ligneCarnet: 1, classeId: ctx.classe1, matiereId: ctx.matieres.lecture1 });
});

test("l'API refuse une compétence sans module, et accepte « hors carnet »", async ({ authedPage: page }) => {
  const sansModule = await creerEvaluation(page, { classeId: ctx.classe1, matiereId: ctx.matieres.lecture1, ligneCarnet: 0 });
  expect(sansModule.status).toBe(400);

  const hors = await creerEvaluation(page, { classeId: ctx.classe1, matiereId: ctx.matieres.lecture1, moduleCarnet: null });
  expect(hors.status).toBe(200);
  expect(await prisma.evaluation.findUniqueOrThrow({ where: { id: hors.id } })).toMatchObject({ moduleCarnet: null, ligneCarnet: null });

  const horsBornes = await creerEvaluation(page, { classeId: ctx.classe1, matiereId: ctx.matieres.lecture1, moduleCarnet: 5 });
  expect(horsBornes.status).toBe(400);
});

test("rattacher une évaluation existante à un module (PATCH) depuis la liste", async ({ authedPage: page }) => {
  const ev = await creerEvaluation(page, { titre: `${PREFIXE} patch`, classeId: ctx.classe1, matiereId: ctx.matieres.maths1 });
  await page.goto("/evaluations");
  const ligne = page.locator("tr", { hasText: `${PREFIXE} patch` });
  await ligne.getByLabel("Module du carnet").selectOption("3");
  await expect(page.getByText("Rattachée au module 3 du carnet")).toBeVisible();
  expect(await prisma.evaluation.findUniqueOrThrow({ where: { id: ev.id } })).toMatchObject({ moduleCarnet: 3 });

  const retire = await page.request.patch(`/api/evaluations/${ev.id}`, { data: { moduleCarnet: null } });
  expect(retire.status()).toBe(200);
  expect(await prisma.evaluation.findUniqueOrThrow({ where: { id: ev.id } })).toMatchObject({ moduleCarnet: null, ligneCarnet: null });

  const absente = await page.request.patch("/api/evaluations/inexistante", { data: { moduleCarnet: 1 } });
  expect(absente.status()).toBe(404);
});

test("les notes saisies alimentent le carnet : 1ère année (A / EVA / NA)", async ({ authedPage: page }) => {
  const [alpha, bravo] = ctx.eleves1;
  // Lecture (→ Français) 15/20 puis Maths 12/20, module 1, coefficient 1.
  const lecture = await creerEvaluation(page, { titre: `${PREFIXE} lecture`, classeId: ctx.classe1, matiereId: ctx.matieres.lecture1, moduleCarnet: 1 });
  const maths = await creerEvaluation(page, { titre: `${PREFIXE} maths`, classeId: ctx.classe1, matiereId: ctx.matieres.maths1, moduleCarnet: 1 });
  await saisirNotes(page, lecture.id, { [alpha.id]: 15, [bravo.id]: 4 });
  await saisirNotes(page, maths.id, { [alpha.id]: 12, [bravo.id]: 4 });

  const res = await page.request.get(`/api/carnets-primaires?eleveId=${alpha.id}&annee=${ANNEE}`);
  expect(res.status()).toBe(200);
  const carnet = await res.json();
  expect(carnet.niveau).toBe("1ère");
  expect(carnet.definition.format).toBe("competences");

  // Français : 75 % → A sur les 3 lignes ; Maths : 60 % → EVA sur les 4 lignes.
  expect(carnet.auto["1"].competences).toMatchObject({ "FRANCAIS.0": "A", "FRANCAIS.1": "A", "FRANCAIS.2": "A", "MATHS.0": "EVA", "MATHS.3": "EVA" });
  // Note du module = moyenne des domaines notés : (0,75 + 0,60) / 2 × 10 = 6,75.
  expect(carnet.auto["1"].note).toBe(6.75);
  expect(carnet.saisie).toEqual({}); // rien saisi à la main

  // L'élève BRAVO (4/20 = 20 %) → NA ; aucun mélange entre élèves.
  const bravoCarnet = await (await page.request.get(`/api/carnets-primaires?eleveId=${bravo.id}&annee=${ANNEE}`)).json();
  expect(bravoCarnet.auto["1"].competences["FRANCAIS.0"]).toBe("NA");
  expect(bravoCarnet.auto["1"].note).toBe(2);

  // Une autre année ne reçoit rien.
  const autreAnnee = await (await page.request.get(`/api/carnets-primaires?eleveId=${alpha.id}&annee=2024-2025`)).json();
  expect(autreAnnee.auto).toEqual({});
});

test("la saisie manuelle remplace le calcul, et le carnet reste récupérable", async ({ authedPage: page }) => {
  const alpha = ctx.eleves1[0];
  const put = await page.request.put("/api/carnets-primaires", {
    data: {
      eleveId: alpha.id,
      annee: ANNEE,
      saisie: { "1": { competences: { "FRANCAIS.0": "NA" }, note: 9 } },
      appreciations: "Élève sérieuse.",
      decision: "Passe en classe supérieure",
    },
  });
  expect(put.status()).toBe(200);

  const ligne = await prisma.carnetPrimaire.findFirstOrThrow({ where: { eleveId: alpha.id, annee: ANNEE } });
  expect(ligne).toMatchObject({ niveau: "1ère", tenantId: ctx.tenantId, decision: "Passe en classe supérieure" });
  expect(ligne.saisie).toEqual({ "1": { competences: { "FRANCAIS.0": "NA" }, note: 9 } });

  // L'impression fusionne : FRANCAIS.0 manuel (NA), FRANCAIS.1 auto (A), note manuelle 9.
  const html = (await (await page.request.get(`/api/carnets-primaires?eleveId=${alpha.id}&annee=${ANNEE}&format=html`)).json()).html as string;
  expect(html).toContain("Élève sérieuse.");
  expect(html).toContain("Passe en classe supérieure");

  // Un barème dépassé est refusé (format points).
  const e4 = await page.request.put("/api/carnets-primaires", {
    data: { eleveId: ctx.eleve4, annee: ANNEE, saisie: { "1": { domaines: { HISTOIRE: 11 } } } },
  });
  expect(e4.status()).toBe(400);
});

test("les notes alimentent le carnet : 4ème année (points sur barème)", async ({ authedPage: page }) => {
  const hist = await creerEvaluation(page, { titre: `${PREFIXE} histoire`, classeId: ctx.classe4, matiereId: ctx.matieres.histoire4, moduleCarnet: 2 });
  const fr = await creerEvaluation(page, { titre: `${PREFIXE} français`, classeId: ctx.classe4, matiereId: ctx.matieres.francais4, moduleCarnet: 2 });
  await saisirNotes(page, hist.id, { [ctx.eleve4]: 16 }); // 80 % × 10 = 8 points
  await saisirNotes(page, fr.id, { [ctx.eleve4]: 15 }); // 75 % × 40 = 30 points

  const carnet = await (await page.request.get(`/api/carnets-primaires?eleveId=${ctx.eleve4}&annee=${ANNEE}`)).json();
  expect(carnet.definition.format).toBe("points");
  expect(carnet.auto["2"].domaines).toEqual({ HISTOIRE: 8, FRANCAIS: 30 });
  expect(carnet.auto["1"]).toBeUndefined(); // les modules sont séparés
});

test("un élève hors primaire est refusé ; un élève inconnu est introuvable", async ({ authedPage: page }) => {
  const terminale = await prisma.eleve.findFirstOrThrow({ where: { tenantId: ctx.tenantId, classe: { niveau: "Terminale" } } });
  expect((await page.request.get(`/api/carnets-primaires?eleveId=${terminale.id}&annee=${ANNEE}`)).status()).toBe(422);
  expect((await page.request.get(`/api/carnets-primaires?eleveId=inconnu&annee=${ANNEE}`)).status()).toBe(404);
  expect((await page.request.get(`/api/carnets-primaires?eleveId=${terminale.id}&annee=2026`)).status()).toBe(400);
});

test("paramétrage : relier une matière à un domaine, modifier un barème, puis rétablir", async ({ authedPage: page }) => {
  // Lecture rattachée à Arabe à la main (au lieu de Français par le nom).
  const get = await (await page.request.get("/api/carnets-primaires/configuration")).json();
  expect(get.niveaux).toHaveLength(5);
  expect(get.niveaux.every((n: { personnalise: boolean }) => !n.personnalise)).toBe(true);
  const defaut1 = get.niveaux.find((n: { niveau: string }) => n.niveau === "1ère").domaines as { code: string; matieres?: string[] }[];

  const domaines = defaut1.map((d) => (d.code === "ARABE" ? { ...d, matieres: [ctx.matieres.lecture1] } : d));
  const put = await page.request.put("/api/carnets-primaires/configuration", { data: { niveau: "1ère", domaines } });
  expect(put.status()).toBe(200);

  const alpha = ctx.eleves1[0];
  const carnet = await (await page.request.get(`/api/carnets-primaires?eleveId=${alpha.id}&annee=${ANNEE}`)).json();
  // Lecture (75 %) alimente désormais ARABE, et plus FRANCAIS ; Maths reste sur MATHS.
  expect(carnet.auto["1"].competences["ARABE.0"]).toBe("A");
  expect(carnet.auto["1"].competences["FRANCAIS.0"]).toBeUndefined();
  expect(carnet.auto["1"].competences["MATHS.0"]).toBe("EVA");

  // Configuration invalide refusée (code en double) ; niveau hors primaire refusé.
  expect((await page.request.put("/api/carnets-primaires/configuration", { data: { niveau: "1ère", domaines: [domaines[0], domaines[0]] } })).status()).toBe(400);
  expect((await page.request.put("/api/carnets-primaires/configuration", { data: { niveau: "6ème", domaines } })).status()).toBe(400);

  // Barème modifié en 4ème : Histoire passe de /10 à /20 → 80 % = 16 points, et le total devient /210.
  const defaut4 = (get.niveaux.find((n: { niveau: string }) => n.niveau === "4ème").domaines as { code: string; bareme?: number }[]);
  const nouveau4 = defaut4.map((d) => (d.code === "HISTOIRE" ? { ...d, bareme: 20 } : d));
  expect((await page.request.put("/api/carnets-primaires/configuration", { data: { niveau: "4ème", domaines: nouveau4 } })).status()).toBe(200);
  const carnet4 = await (await page.request.get(`/api/carnets-primaires?eleveId=${ctx.eleve4}&annee=${ANNEE}`)).json();
  expect(carnet4.auto["2"].domaines.HISTOIRE).toBe(16);

  // Rétablir le modèle : retour au calcul par défaut.
  expect((await page.request.delete("/api/carnets-primaires/configuration?niveau=1%C3%A8re")).status()).toBe(200);
  expect((await page.request.delete("/api/carnets-primaires/configuration?niveau=4%C3%A8me")).status()).toBe(200);
  expect(await prisma.carnetConfiguration.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
  const retour = await (await page.request.get(`/api/carnets-primaires?eleveId=${alpha.id}&annee=${ANNEE}`)).json();
  expect(retour.auto["1"].competences["FRANCAIS.0"]).toBe("A");
});

test("éditeur de carnet : valeurs automatiques affichées, remplacées à la main, enregistrées", async ({ authedPage: page }) => {
  await page.goto("/notes/bulletins");
  await page.getByRole("button", { name: /1ère A/ }).click();
  await expect(page.getByRole("heading", { name: /Carnet 1ère année — 1ère A/ })).toBeVisible();

  await page.getByLabel("Élève", { exact: true }).selectOption({ label: `Test ALPHA (${PREFIXE}1)` });
  const bouton = (ev: string, ligne: number) =>
    page.getByRole("button", { name: `${ev}, module 1, compétence ${ligne} — Compétences de langue : français`, exact: true });

  // État enregistré par le test précédent : FRANCAIS.0 saisi à la main (NA), note du module 1 saisie (9).
  await expect(bouton("NA", 1)).toHaveAttribute("aria-pressed", "true");
  // Ligne 2 : aucune saisie manuelle, la valeur calculée (A, 15/20) est proposée.
  await expect(bouton("A", 2)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/Valeurs proposées d'après les évaluations et devoirs/)).toBeVisible();
  await expect(page.locator(".cf-valeur")).toHaveText("9");

  // Le calcul automatique est restitué par le bouton du module : Français.0 → A, moyenne → 6,75.
  await page.getByRole("button", { name: "Module 1 : revenir au calcul automatique" }).click();
  await expect(bouton("A", 1)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".cf-valeur")).toHaveText("6.75");

  // Remplacement manuel puis enregistrement : visible en base.
  await bouton("EVA", 1).click();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Carnet enregistré")).toBeVisible();
  const ligne = await prisma.carnetPrimaire.findFirstOrThrow({ where: { eleveId: ctx.eleves1[0].id, annee: ANNEE } });
  expect((ligne.saisie as Record<string, { competences?: Record<string, string> }>)["1"].competences?.["FRANCAIS.0"]).toBe("EVA");
});

test("impression : en-tête dynamique et une seule page par feuille", async ({ authedPage: page, context }) => {
  // window.print() bloquerait le test : on le remplace et on note qu'il a été appelé.
  await context.addInitScript(() => {
    (window as unknown as { print: () => void }).print = () => {
      (window as unknown as { __imprime: boolean }).__imprime = true;
    };
  });

  await page.goto("/notes/bulletins");
  await page.getByRole("button", { name: /1ère A/ }).click();
  await expect(page.getByRole("heading", { name: /Carnet 1ère année/ })).toBeVisible();
  await page.getByLabel("Élève", { exact: true }).selectOption({ label: `Test ALPHA (${PREFIXE}1)` });

  const [popup] = await Promise.all([page.waitForEvent("popup"), page.getByRole("button", { name: "Imprimer" }).click()]);
  await popup.waitForLoadState("domcontentloaded");
  await expect(popup.locator(".carte")).toBeVisible();

  // En-tête : tout vient de la base.
  const carte = (await popup.locator(".carte").innerText()).replace(/\s+/g, " ");
  expect(carte).toContain("ALPHA Test");
  expect(carte).toContain(`${PREFIXE}1`);
  expect(carte).toContain("09/03/2018 à Djibouti");
  expect(carte).toContain("1ère ANNEE/A");
  expect(carte).toContain(ctx.enseignantNom);
  expect(carte).toContain("Mme Directrice Test");
  expect(carte).not.toContain("……"); // plus aucun pointillé de remplissage manuel, sauf le site (aucun site créé)
  expect(await popup.locator(".bandeau-enseignement").innerText()).toContain("2025 /2026");

  // La boîte d'impression a bien été appelée, après l'ajustement à une page.
  await expect.poll(() => popup.evaluate(() => (window as unknown as { __imprime?: boolean }).__imprime === true)).toBe(true);

  // Une feuille = une page : 3 feuilles A4 paysage, et le contenu de la dernière ne déborde pas.
  const mesures = await popup.evaluate(() => {
    const page = document.querySelector<HTMLElement>(".interieur")!;
    const contenu = page.querySelector<HTMLElement>(".interieur-contenu")!;
    const rp = page.getBoundingClientRect();
    const rc = contenu.getBoundingClientRect();
    return {
      feuilles: document.querySelectorAll(".feuille").length,
      interieurs: document.querySelectorAll(".interieur").length,
      largeurMm: Math.round(page.offsetWidth / 3.7795),
      hauteurMm: Math.round(page.offsetHeight / 3.7795),
      debordeBas: rc.bottom - rp.bottom,
      debordeDroite: rc.right - rp.right,
    };
  });
  expect(mesures).toMatchObject({ feuilles: 2, interieurs: 1, largeurMm: 297, hauteurMm: 210 });
  expect(mesures.debordeBas).toBeLessThanOrEqual(1);
  expect(mesures.debordeDroite).toBeLessThanOrEqual(1);
});
