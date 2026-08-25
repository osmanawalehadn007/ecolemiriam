import { test as base, expect, type Page } from "@playwright/test";

// Shared auth fixture — logs in via l'API NextAuth directement (contourne
// le problème d'hydratation React du serveur dev où le formulaire se soumet
// en HTML GET avant que onSubmit ne soit attaché).
async function login(page: Page) {
  // 1. Récupérer le CSRF token.
  //    En dev, la première requête peut tomber sur une route en cours de
  //    compilation et retourner du HTML au lieu de JSON. On retry jusqu'à 3x.
  let csrfToken: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const csrfRes = await page.request.get("/api/auth/csrf");
    const contentType = csrfRes.headers()["content-type"] ?? "";
    if (contentType.includes("application/json")) {
      const body = await csrfRes.json();
      csrfToken = body.csrfToken;
      break;
    }
    // Pas du JSON → attendre et réessayer (le serveur dev compile)
    await page.waitForTimeout(2000);
  }
  if (!csrfToken) throw new Error("Impossible d'obtenir le CSRF token après 3 tentatives");

  // 2. Soumettre les credentials via l'API NextAuth
  await page.request.post("/api/auth/callback/credentials", {
    form: {
      email: "admin@lycee-djibouti.ecolemiriam.app",
      password: "Demo@2026!",
      csrfToken,
      callbackUrl: "/dashboard",
      json: "true",
    },
    maxRedirects: 0,
  });

  // 3. Les cookies de session sont automatiquement stockés dans le
  //    BrowserContext par page.request. Naviguer vers /dashboard pour
  //    vérifier que la session est active.
  await page.goto("/dashboard");
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
}

// ============================================================
// Login paramétré par rôle
// ============================================================
//
// Map des credentials de test. Les valeurs par défaut proviennent des
// variables d'environnement ; si une variable est absente, on retombe sur
// une valeur codée en dur (uniquement pour ADMIN/TEACHER qui ont des
// comptes connus). Pour PARENT/STUDENT/ACCOUNTANT, si les variables
// d'environnement ne sont pas définies, l'email/password restent vides et
// les tests qui les utilisent doivent être skippés (voir
// parent-student-isolation.spec.ts).
export type TestRole = "ADMIN" | "PARENT" | "STUDENT" | "TEACHER" | "ACCOUNTANT";

export const ROLE_CREDENTIALS: Record<TestRole, { email: string; password: string }> = {
  ADMIN: {
    email: process.env.TEST_ADMIN_EMAIL ?? "admin@lycee-djibouti.ecolemiriam.app",
    password: process.env.TEST_ADMIN_PASSWORD ?? "Demo@2026!",
  },
  PARENT: {
    email: process.env.TEST_PARENT_EMAIL ?? "",
    password: process.env.TEST_PARENT_PASSWORD ?? "",
  },
  STUDENT: {
    email: process.env.TEST_STUDENT_EMAIL ?? "",
    password: process.env.TEST_STUDENT_PASSWORD ?? "",
  },
  TEACHER: {
    email: process.env.TEST_TEACHER_EMAIL ?? "awaleh.osman.adn@gmail.com",
    password: process.env.TEST_TEACHER_PASSWORD ?? "Ttestt@@",
  },
  ACCOUNTANT: {
    email: process.env.TEST_ACCOUNTANT_EMAIL ?? "",
    password: process.env.TEST_ACCOUNTANT_PASSWORD ?? "",
  },
};

/**
 * Indique si des credentials de test non vides existent pour un rôle donné.
 * Utilisé pour `test.skip` quand les comptes PARENT/STUDENT ne sont pas
 * provisionnés en DB (le CI ne doit pas échouer pour autant).
 */
export function hasRoleCredentials(role: TestRole): boolean {
  const c = ROLE_CREDENTIALS[role];
  return Boolean(c.email && c.password);
}

/**
 * Connecte la page en tant que rôle donné via l'API NextAuth (même
    contournement d'hydratation que `login`). La page est ensuite naviguée
 * vers `destPath` (défaut: /dashboard) et l'on attend que l'URL corresponde.
 *
 * Contrairement au fixture `authedPage` (réservé ADMIN), cette fonction ne
 * force pas /dashboard : pour PARENT/STUDENT, /dashboard redirige vers
 * /absences ou /notes, donc on attend l'une des destinations valides.
 */
export async function loginAsRole(
  page: Page,
  role: TestRole,
  destPath: string = "/dashboard"
): Promise<void> {
  const { email, password } = ROLE_CREDENTIALS[role];
  if (!email || !password) {
    throw new Error(
      `Credentials de test manquants pour le rôle ${role} ` +
        `(définir TEST_${role}_EMAIL / TEST_${role}_PASSWORD).`
    );
  }

  // 1. CSRF token (retry x3 — le serveur dev peut compiler à la demande).
  let csrfToken: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const csrfRes = await page.request.get("/api/auth/csrf");
    const contentType = csrfRes.headers()["content-type"] ?? "";
    if (contentType.includes("application/json")) {
      const body = await csrfRes.json();
      csrfToken = body.csrfToken;
      break;
    }
    await page.waitForTimeout(2000);
  }
  if (!csrfToken) throw new Error("Impossible d'obtenir le CSRF token après 3 tentatives");

  // 2. NextAuth credentials callback
  await page.request.post("/api/auth/callback/credentials", {
    form: {
      email,
      password,
      csrfToken,
      callbackUrl: destPath,
      json: "true",
    },
    maxRedirects: 0,
  });

  // 3. Naviguer vers la destination. Pour PARENT/STUDENT, /dashboard
  //    redirige côté serveur ; on attend donc une URL finale parmi les
  //    destinations valides plutôt que /dashboard strictement.
  await page.goto(destPath);
  if (role === "PARENT" || role === "STUDENT") {
    // /dashboard redirige PARENT → /absences, STUDENT → /notes.
    // On accepte aussi la destination explicite si elle n'est pas /dashboard.
    await page.waitForURL(
      (url) =>
        !url.pathname.endsWith("/login") &&
        !url.pathname.endsWith("/select-tenant"),
      { timeout: 60_000 }
    );
  } else {
    await page.waitForURL(`**${destPath}`, { timeout: 60_000 });
  }
}

/**
 * Déconnecte la page (best-effort — ignore les erreurs réseau).
 */
export async function logout(page: Page): Promise<void> {
  try {
    const csrfRes = await page.request.get("/api/auth/csrf");
    const ct = csrfRes.headers()["content-type"] ?? "";
    if (ct.includes("application/json")) {
      const { csrfToken } = await csrfRes.json();
      await page.request.post("/api/auth/signout", {
        form: { csrfToken },
        maxRedirects: 0,
      });
    }
  } catch {
    // best-effort
  }
}

export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use) => {
    await login(page);
    await use(page);
  },
});

export { expect };
