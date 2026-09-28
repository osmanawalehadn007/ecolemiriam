import { test as base, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

// ============================================================
// Comptes de test — source de vérité : `prisma/seed.ts`
// ============================================================
// La CI démarre une base PostgreSQL jetable, applique le schéma puis lance la
// seed : les tests ne peuvent donc se connecter qu'aux comptes que la seed
// crée réellement. `admin@lycee-djibouti.ecolemiriam.app` n'a jamais existé
// dans `prisma/seed.ts` (qui crée `admin@lycee-demo.ecolemiriam.app`) — d'où
// les échecs « identifiants invalides » qui maintenaient le job E2E désactivé.
//
// Règle : tout compte créé par la seed peut servir de valeur par défaut ; tout
// compte réel (personnel d'un établissement) passe par une variable
// d'environnement `TEST_*`. Aucun identifiant réel ne doit être versionné.
export const DEMO_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? "Demo@2026!";

export const SEED_ADMIN = {
  email: process.env.TEST_ADMIN_EMAIL ?? "admin@lycee-demo.ecolemiriam.app",
  password: DEMO_PASSWORD,
} as const;

export const SEED_TEACHER = {
  email: process.env.TEST_TEACHER_EMAIL ?? "enseignant@lycee-demo.ecolemiriam.app",
  password: process.env.TEST_TEACHER_PASSWORD ?? "Demo@2026!",
} as const;

/**
 * Marque un compte comme « email vérifié », exactement comme le fait
 * `/api/auth/verify-email` (src/lib/security/email-verification.ts :
 * `User.emailVerified = new Date()`).
 *
 * Indispensable en e2e : la vérification passe par un email (Resend) qui n'est
 * pas configuré dans la base jetable de la CI. Le clic réel sur le lien est
 * couvert par les tests d'intégration ; ici on applique le même changement
 * d'état pour pouvoir tester la suite du parcours.
 */
export async function markEmailVerified(email: string): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await prisma.user.updateMany({
      where: { email },
      data: { emailVerified: new Date() },
    });
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Nombre de sites déclarés dans l'établissement.
 *
 * `prisma/seed.ts` n'en crée AUCUN : les parcours qui comparent des libellés de
 * site (import d'enseignants, affectations) n'ont alors rien à confronter. Ils
 * doivent être skippés explicitement au lieu d'échouer sur la base de
 * démonstration.
 */
export async function countSites(): Promise<number> {
  const prisma = new PrismaClient();
  try {
    return await prisma.site.count();
  } finally {
    await prisma.$disconnect();
  }
}

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
      email: SEED_ADMIN.email,
      password: SEED_ADMIN.password,
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
// Map des credentials de test. Les valeurs par défaut proviennent des comptes
// créés par `prisma/seed.ts` (ADMIN, TEACHER) ; si une variable
// d'environnement est fournie, elle a priorité. Pour PARENT/STUDENT/
// ACCOUNTANT, les comptes dépendent d'un établissement réel : sans variables
// d'environnement, l'email/password restent vides et les tests qui les
// utilisent doivent être skippés (voir parent-student-isolation.spec.ts).
export type TestRole = "ADMIN" | "PARENT" | "STUDENT" | "TEACHER" | "ACCOUNTANT";

export const ROLE_CREDENTIALS: Record<TestRole, { email: string; password: string }> = {
  ADMIN: { ...SEED_ADMIN },
  PARENT: {
    email: process.env.TEST_PARENT_EMAIL ?? "",
    password: process.env.TEST_PARENT_PASSWORD ?? "",
  },
  STUDENT: {
    email: process.env.TEST_STUDENT_EMAIL ?? "",
    password: process.env.TEST_STUDENT_PASSWORD ?? "",
  },
  TEACHER: { ...SEED_TEACHER },
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
