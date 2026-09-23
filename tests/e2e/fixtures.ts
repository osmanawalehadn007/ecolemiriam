import { test as base, expect, type Page } from "@playwright/test";

/**
 * Identifiants E2E — configurables par variables d'environnement.
 *
 * Les valeurs par défaut pointent sur le tenant de démonstration réellement
 * utilisé en développement. Les figer dans le code empêchait de faire tourner
 * la suite contre un autre environnement (CI, base seedée à neuf).
 *
 * Rôles :
 *  - `admin`       : direction — voit tout le site, sert de témoin positif.
 *  - `teacher`     : enseignant du site A — sert aux tests d'isolation.
 *  - `teacherOther`: enseignant du site B — la cible qui NE DOIT PAS être vue.
 */
export const E2E_CREDENTIALS = {
  admin: {
    email: process.env.E2E_ADMIN_EMAIL ?? "admin@lycee-demo.ecolpro.app",
    password: process.env.E2E_ADMIN_PASSWORD ?? "Demo@2026!",
  },
  teacher: {
    email: process.env.E2E_TEACHER_EMAIL ?? "enseignant@lycee-demo.ecolpro.app",
    password: process.env.E2E_TEACHER_PASSWORD ?? "Demo@2026!",
  },
  teacherOther: {
    email: process.env.E2E_TEACHER_OTHER_EMAIL ?? "enseignant2@lycee-demo.ecolpro.app",
    password: process.env.E2E_TEACHER_OTHER_PASSWORD ?? "Demo@2026!",
  },
  parent: {
    email: process.env.E2E_PARENT_EMAIL ?? "parent@lycee-demo.ecolpro.app",
    password: process.env.E2E_PARENT_PASSWORD ?? "Demo@2026!",
  },
} as const;

export type E2ERole = keyof typeof E2E_CREDENTIALS;

/**
 * Connexion générique réutilisable — y compris depuis un test, pour ouvrir une
 * seconde session (par exemple : se connecter en prof A, vérifier une donnée,
 * puis se reconnecter en prof B et vérifier qu'elle a disparu).
 */
export async function loginAs(
  page: Page,
  role: E2ERole = "admin"
): Promise<void> {
  const { email, password } = E2E_CREDENTIALS[role];
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  // Après connexion, l'application redirige vers `/select-tenant` ; cette page
  // renvoie elle-même vers `/dashboard` quand l'utilisateur n'a qu'un
  // établissement. On accepte les deux : les scénarios d'isolation raisonnent
  // ensuite au niveau API, les cookies de session étant déjà posés.
  await page.waitForURL(/\/(dashboard|select-tenant)/);
}

// Shared auth fixture — logs in once per test file and reuses the session
async function login(page: Page) {
  await loginAs(page, "admin");
}

export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use) => {
    await login(page);
    await use(page);
  },
});

export { expect };
