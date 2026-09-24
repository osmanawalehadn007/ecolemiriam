import { test, expect, loginAs, E2E_CREDENTIALS, type E2ERole } from "./fixtures";
import type { Browser, Page } from "@playwright/test";

/**
 * Isolation — périmètre enseignant et périmètre de site
 * ====================================================
 *
 * Ces tests s'adressent à l'API, PAS à l'interface : depuis le chantier 1, l'UI
 * masque les liens hors périmètre — elle serait donc verte même si l'API restait
 * ouverte. Ce qu'il faut prouver, c'est que l'API refuse.
 *
 * Les identifiants ci-dessous viennent de `prisma/seed.ts` (prérequis 5.1 → 5.4
 * du plan) :
 *  · prof A (CLASS_TEACHER, site « Campus Central ») n'a que la Terminale A1 et
 *    les mathématiques ;
 *  · la 2nde C est dans LE MÊME SITE mais hors de son périmètre — c'est la cible
 *    qui distingue « périmètre enseignant » de « filtre de site » : une
 *    implémentation qui n'applique que le filtre de site laisse passer ;
 *  · la 1ère B1 est sur l'autre site (isolation inter-sites).
 *
 * Codes attendus (plan § 6) : 403 en écriture, 404 en lecture par identifiant,
 * liste vide en lecture de liste, 200 pour les données légitimes.
 */
const SEED = {
  classeProfA: "classe-tle-a-demo",
  matiereProfA: "mat-math-demo",
  eleveProfA: "eleve-tle-a-1-demo",
  /** Même site, autre classe : hors périmètre enseignant. */
  classeHorsPerimetre: "classe-2nde-c-demo",
  matiereHorsPerimetre: "mat-hist-demo",
  eleveHorsPerimetre: "eleve-2nde-c-1-demo",
  /** Autre site : hors périmètre de site ET de classe. */
  classeSiteB: "classe-1ere-b-demo",
  eleveSiteB: "eleve-1ere-b-1-demo",
  factureSiteB: "facture-b-demo",
  siteB: "site-demo-annexe",
  periode: "per-t2-demo",
} as const;

/** Page authentifiée dans un contexte ISOLÉ : le contexte par défaut est admin. */
async function pagePour(browser: Browser, role: E2ERole): Promise<Page> {
  const page = await browser.newPage();
  await loginAs(page, role);
  return page;
}

/** Jeton mobile d'un rôle — l'app mobile s'authentifie par `Authorization: Bearer`. */
async function mobileToken(page: Page, role: E2ERole): Promise<string> {
  const { email, password } = E2E_CREDENTIALS[role];
  const res = await page.request.post("/api/auth/mobile", { data: { email, password } });
  expect(res.ok(), `connexion mobile ${role} (${res.status()})`).toBeTruthy();
  const body = (await res.json()) as { token?: string };
  expect(body.token, "jeton mobile absent de la réponse").toBeTruthy();
  return body.token as string;
}

test.describe("Isolation — périmètre enseignant (web)", () => {
  test("5.5 un prof ne peut pas faire l'appel sur une classe hors de son périmètre", async ({ browser }) => {
    const page = await pagePour(browser, "teacher");
    const res = await page.request.post("/api/absences/appel", {
      data: {
        classeId: SEED.classeHorsPerimetre,
        date: new Date().toISOString(),
        presences: { [SEED.eleveHorsPerimetre]: "absent" },
      },
    });
    // 403 : c'est une ÉCRITURE (absences + notifications SMS/WhatsApp/e-mail).
    expect(res.status()).toBe(403);
    await page.close();
  });

  test("5.6 un prof ne peut pas créer une évaluation hors de ses classes/matières", async ({ browser }) => {
    const page = await pagePour(browser, "teacher");
    const res = await page.request.post("/api/evaluations", {
      data: {
        titre: "Évaluation non autorisée (test d'isolation)",
        type: "CONTROLE",
        classeId: SEED.classeHorsPerimetre,
        matiereId: SEED.matiereHorsPerimetre,
        periodeId: SEED.periode,
        date: "2026-02-20T08:00:00.000Z",
        duree: 60,
        coefficient: 1,
      },
    });
    expect(res.status()).toBe(403);
    await page.close();
  });

  test("5.7 un prof ne programme pas de session d'examen hors périmètre", async ({ browser }) => {
    const page = await pagePour(browser, "teacher");
    // `examens:write` n'est pas accordé aux rôles enseignant (plan § 4.9) : le
    // refus vient donc du RBAC. Le test verrouille ce contrôle négatif — s'il
    // devenait accordé, la garde de périmètre devrait refuser tout autant.
    const res = await page.request.post("/api/examens/examen-b-demo/sessions", {
      data: {
        matiereNom: "Français",
        date: "2026-03-03T08:00:00.000Z",
        heureDebut: "08:00",
        heureFin: "10:00",
      },
    });
    expect(res.status()).toBe(403);
    await page.close();
  });

  test("5.8 un prof ne lit pas les notes d'un élève hors périmètre (liste vide)", async ({ browser }) => {
    const page = await pagePour(browser, "teacher");
    const res = await page.request.get(`/api/notes?eleveId=${SEED.eleveHorsPerimetre}`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { notes?: unknown[] };
    // 200 avec une liste vide — pas d'erreur : un périmètre restreint est normal.
    expect(body.notes ?? []).toHaveLength(0);
    await page.close();
  });

  test("5.9 un prof ne peut pas écrire une note sur un élève hors périmètre", async ({ browser }) => {
    const page = await pagePour(browser, "teacher");
    const res = await page.request.post("/api/notes", {
      data: {
        notes: [
          {
            eleveId: SEED.eleveHorsPerimetre,
            classeId: SEED.classeHorsPerimetre,
            matiereId: SEED.matiereHorsPerimetre,
            periodeId: SEED.periode,
            type: "CONTROLE",
            valeur: 3,
            noteMax: 20,
            coefficient: 1,
            date: "2026-02-20T08:00:00.000Z",
          },
        ],
      },
    });
    expect(res.status()).toBe(403);
    await page.close();
  });

  test("5.10 un prof ouvre un élève hors périmètre — 404, jamais la fiche", async ({ browser }) => {
    const page = await pagePour(browser, "teacher");
    // `maxRedirects: 0` : une redirection suivie masquerait le code réel
    // (302/307 vers /login ou /dashboard se termineraient en 200).
    const res = await page.request.get(`/eleves/${SEED.eleveHorsPerimetre}`, {
      maxRedirects: 0,
    });
    const status = res.status();
    const body = await res.text();
    if (status >= 300 && status < 400) {
      // Session éjectée : la seule redirection tolérée est /login.
      expect(res.headers()["location"] ?? "").toContain("/login");
    } else if (status === 200) {
      // Next.js : le `loading.tsx` du layout (dashboard) crée une frontière
      // Suspense — le shell part en 200 PUIS `notFound()` arrive dans le flux
      // (payload `NEXT_HTTP_ERROR_FALLBACK;404` visible dans le corps). Le
      // critère de sécurité n'est donc pas le code HTTP mais l'ABSENCE des
      // données personnelles de l'élève — nom COMPLET et matricule, des
      // chaînes assez longues pour éviter tout faux positif de sous-chaîne.
      expect(body).not.toContain("Abdoulaye Sy");
      expect(body).not.toContain("2026-0101");
    } else {
      // Cas nominal (pas de frontière de streaming) : 404 net.
      expect(status).toBe(404);
    }
    await page.close();
  });

  test("5.11 témoins positifs : le prof voit SES données, l'admin conserve les siennes", async ({ browser, authedPage }) => {
    // Prof : ses élèves existent bien (le filtre ne vide pas tout par excès).
    const profPage = await pagePour(browser, "teacher");
    const resProf = await profPage.request.get("/api/eleves?export=true");
    expect(resProf.status()).toBe(200);
    const profBody = (await resProf.json()) as { eleves?: Array<{ id: string }> };
    const profIds = (profBody.eleves ?? []).map((e) => e.id);
    expect(profIds).toContain(SEED.eleveProfA);
    expect(profIds).not.toContain(SEED.eleveHorsPerimetre);
    await profPage.close();

    // Admin du site A : aucune régression — il voit aussi la 2nde C.
    const resAdmin = await authedPage.request.get("/api/eleves?export=true");
    expect(resAdmin.status()).toBe(200);
    const adminBody = (await resAdmin.json()) as { eleves?: Array<{ id: string }> };
    const adminIds = (adminBody.eleves ?? []).map((e) => e.id);
    expect(adminIds).toContain(SEED.eleveHorsPerimetre);
  });
});
test.describe("Isolation — périmètre de site (admin du site A)", () => {
  test("5.12 l'admin du site A ne lit pas une facture du site B", async ({ authedPage }) => {
    const res = await authedPage.request.get(`/api/factures/${SEED.factureSiteB}/pdf`);
    expect([403, 404]).toContain(res.status());
  });

  test("5.13 l'admin du site A n'importe pas d'élève dans le site B", async ({ authedPage }) => {
    const res = await authedPage.request.post("/api/import/eleves", {
      multipart: {
        siteId: SEED.siteB,
        file: {
          name: "test.csv",
          mimeType: "text/csv",
          buffer: Buffer.from("nom,prenom\nTest,Import\n"),
        },
      },
    });
    expect([403, 404]).toContain(res.status());
  });

  test("5.14 l'admin du site A ne demande pas d'attestation pour un élève du site B", async ({ authedPage }) => {
    const res = await authedPage.request.post("/api/eleves/attestation", {
      data: {
        eleveId: SEED.eleveSiteB,
        honorifique: "Pour valoir ce que de droit",
        titre: "Attestation de scolarité",
      },
    });
    expect(res.status()).toBe(404);
  });
});
test.describe("Isolation — application mobile (jeton Bearer)", () => {
  test("5.15 un prof mobile ne fait pas l'appel hors de son périmètre et ne voit que son planning", async ({ browser }) => {
    const page = await pagePour(browser, "teacher");
    const token = await mobileToken(page, "teacher");
    const headers = { Authorization: `Bearer ${token}` };

    // Annuaire mobile : uniquement les élèves de son périmètre.
    const elevesRes = await page.request.get("/api/mobile/eleves", { headers });
    expect(elevesRes.status()).toBe(200);
    const eleves = (await elevesRes.json()) as { eleves?: Array<{ id: string }> };
    const ids = (eleves.eleves ?? []).map((e) => e.id);
    expect(ids).toContain(SEED.eleveProfA);
    expect(ids).not.toContain(SEED.eleveHorsPerimetre);
    expect(ids).not.toContain(SEED.eleveSiteB);

    // Écriture hors périmètre : refusée (c'est la route mobile qui notifie les familles).
    const appelRes = await page.request.post("/api/mobile/appel", {
      headers,
      data: {
        classeId: SEED.classeHorsPerimetre,
        date: new Date().toISOString(),
        presences: { [SEED.eleveHorsPerimetre]: "absent" },
      },
    });
    expect(appelRes.status()).toBe(403);

    // Notes : il ne voit que les siennes (classe ET matière bornées).
    const notesRes = await page.request.get(`/api/mobile/notes?matiereId=${SEED.matiereProfA}`, { headers });
    expect(notesRes.status()).toBe(200);

    // Planning : uniquement ses propres créneaux (`teacherEmploiTempsFilter`).
    const emploiRes = await page.request.get("/api/mobile/emploi-du-temps", { headers });
    expect(emploiRes.status()).toBe(200);
    const emploi = (await emploiRes.json()) as { emploi?: Array<{ classe: { id: string } }> };
    const classesVues = new Set((emploi.emploi ?? []).map((c) => c.classe.id));
    expect(classesVues.has(SEED.classeHorsPerimetre)).toBe(false);
    expect(classesVues.has(SEED.classeSiteB)).toBe(false);
    expect(classesVues.has(SEED.classeProfA)).toBe(true);

    await page.close();
  });
});
