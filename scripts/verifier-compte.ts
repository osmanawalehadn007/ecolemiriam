#!/usr/bin/env node
/**
 * Vérification LECTURE SEULE d'un compte utilisateur.
 * ============================================================
 * Répond à « ce compte existe-t-il, et peut-on se connecter avec ? » en
 * rejouant, dans l'ordre, les mêmes conditions que `authorize()`
 * (src/lib/auth.ts) :
 *
 *   1. le compte est trouvé par email (recherche insensible à la casse) ;
 *   2. `isActive` est vrai ;
 *   3. `password` est renseigné ;
 *   4. `emailVerified` est non nul — ou le rôle est SUPER_ADMIN (exemption) ;
 *   5. si `mfaEnabled`, un code TOTP sera exigé à la connexion ;
 *   6. `deriveClaims` ne renverra pas null (compte actif + adhésion tenant) ;
 *   7. `mustChangePassword` redirige vers /change-password (pas un blocage).
 *
 * Le script NE MODIFIE RIEN : uniquement des SELECT. Le mot de passe n'est
 * jamais écrit dans la sortie ; il n'est utilisé que s'il est fourni
 * explicitement, pour rejouer le `bcrypt.compare` réel.
 *
 * Usage :
 *   export DIRECT_URL="$(grep '^DIRECT_URL=' .env | cut -d= -f2- | tr -d '\"')"
 *   npx tsx scripts/verifier-compte.ts barwakoabdirahman97@gmail.com
 *   npx tsx scripts/verifier-compte.ts <email> --password='…'   # teste le mot de passe
 *   npx tsx scripts/verifier-compte.ts <email> --password='…' --live
 *                               # + appelle /api/auth/2fa/check-required en prod
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const directUrl = process.env.DIRECT_URL;
if (!directUrl) {
  console.error("❌ DIRECT_URL manquant (rôle direct, hors pooler).");
  process.exit(1);
}

const email = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!email) {
  console.error("Usage : npx tsx scripts/verifier-compte.ts <email> [--password='…'] [--live]");
  process.exit(1);
}
const password = process.argv.find((a) => a.startsWith("--password="))?.slice("--password=".length);
const live = process.argv.includes("--live");

/** DIRECT_URL = rôle direct ; DATABASE_URL = rôle applicatif (RLS active). */
const direct = new PrismaClient({ datasources: { db: { url: directUrl } } });
const app = process.env.DATABASE_URL
  ? new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } })
  : null;

function cible(url: string): string {
  const m = url.replace(/:[^:@/]+@/, ":***@").match(/@([^/]+)\/([^?]+)/);
  return m ? `${m[1]}/${m[2]}` : "?";
}

const OK = "✔";
const KO = "✘";
const WARN = "!";
const ligne = "─".repeat(60);

async function main() {
  console.log(`Base interrogée : ${cible(directUrl as string)}`);
  console.log(`Compte recherché : ${email}`);
  console.log(ligne);

  // ── 1. Le compte existe-t-il ? ────────────────────────────────────────
  const user = await direct.user.findFirst({
    where: { email: { equals: email as string, mode: "insensitive" } },
    select: {
      id: true,
      email: true,
      name: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
      password: true,
      emailVerified: true,
      mfaEnabled: true,
      mfaSecret: true,
      mustChangePassword: true,
      tenantId: true,
      siteId: true,
      createdAt: true,
      lastLoginAt: true,
      tenant: { select: { id: true, name: true, slug: true, status: true } },
      userTenants: {
        select: {
          tenantId: true,
          role: true,
          isActive: true,
          isDefault: true,
          tenant: { select: { name: true } },
        },
      },
      userSites: { select: { siteId: true } },
      eleve: { select: { id: true, matricule: true } },
      enseignants: { select: { id: true } },
    },
  });

  if (!user) {
    console.log(`${KO} AUCUN compte avec cet email (recherche insensible à la casse).`);
    const [local, domaine] = (email as string).split("@");
    const proches = await direct.user.findMany({
      where: {
        OR: [
          { email: { contains: local, mode: "insensitive" } },
          { email: { contains: `@${domaine}`, mode: "insensitive" } },
        ],
      },
      select: { email: true },
      take: 10,
    });
    if (proches.length) {
      console.log("   Emails proches en base :");
      proches.forEach((p) => console.log(`   - ${p.email}`));
    } else {
      console.log("   Aucun email proche non plus (compte jamais créé sur cette base ?).");
    }
    return;
  }

  console.log(`${OK} Compte trouvé`);
  console.log(`   id                : ${user.id}`);
  console.log(
    `   email en base     : ${user.email}${user.email === email ? "" : "   ← casse différente (le login la tolère)"}`,
  );
  console.log(`   nom               : ${user.name}`);
  console.log(`   rôle              : ${user.role}`);
  console.log(`   actif             : ${user.isActive ? "oui" : "NON (désactivé)"}`);
  console.log(
    `   email vérifié     : ${user.emailVerified ? `oui (${user.emailVerified.toISOString().slice(0, 10)})` : "NON (null)"}`,
  );
  console.log(
    `   mot de passe      : ${user.password ? `défini (${user.password.slice(0, 4)}…, ${user.password.length} car.)` : "AUCUN"}`,
  );
  console.log(`   changement mdp    : ${user.mustChangePassword ? "obligatoire à la 1re connexion" : "non requis"}`);
  console.log(
    `   2FA               : ${user.mfaEnabled ? `activée${user.mfaSecret ? " (secret présent)" : " ⚠ sans secret"}` : "désactivée"}`,
  );
  console.log(
    `   tenant            : ${user.tenantId ? `${user.tenant?.name ?? "?"} (${user.tenant?.slug ?? "?"}, statut ${user.tenant?.status ?? "?"})` : "aucun"}`,
  );
  console.log(`   site              : ${user.siteId ?? "tous / aucun"}`);
  console.log(
    `   adhésions tenant  : ${
      user.userTenants.length === 0
        ? "AUCUNE"
        : user.userTenants
            .map((t) => `${t.tenant.name}/${t.role}${t.isActive ? "" : " (inactive)"}${t.isDefault ? " [défaut]" : ""}`)
            .join(", ")
    }`,
  );
  console.log(`   sites rattachés   : ${user.userSites.length}`);
  console.log(`   création          : ${user.createdAt.toISOString().slice(0, 10)}`);
  console.log(`   dernier login     : ${user.lastLoginAt ? user.lastLoginAt.toISOString() : "JAMAIS"}`);
  // ── 2. Les conditions de connexion, une par une ───────────────────────
  console.log(`\n${ligne}\nConditions de connexion (authorize, src/lib/auth.ts)\n${ligne}`);
  const blocages: string[] = [];

  const c1 = user.isActive;
  console.log(
    `${c1 ? OK : KO} 1. Compte actif — ${user.isActive ? "oui" : "NON → authorize() renvoie null (« identifiants incorrects »)"}`,
  );
  if (!c1) blocages.push("compte désactivé (isActive = false)");

  const c2 = !!user.password;
  console.log(`${c2 ? OK : KO} 2. Mot de passe défini — ${c2 ? "oui" : "NON → connexion par mot de passe impossible"}`);
  if (!c2) blocages.push("aucun mot de passe (compte OAuth / invitation non finalisée)");

  const c3 = !!user.emailVerified || user.role === "SUPER_ADMIN";
  console.log(
    `${c3 ? OK : KO} 3. Email vérifié — ${
      user.emailVerified
        ? "oui"
        : user.role === "SUPER_ADMIN"
          ? "non, mais SUPER_ADMIN est exempté"
          : "NON → blocage dur, message « Email non vérifié »"
    }`,
  );
  if (!c3) blocages.push("email non vérifié (emailVerified = null)");

  console.log(
    `${WARN} 4. 2FA — ${
      user.mfaEnabled
        ? "activée : un code TOTP à 6 chiffres sera demandé"
        : user.role === "SUPER_ADMIN"
          ? "désactivée sur un SUPER_ADMIN → redirection forcée vers /parametres/securite"
          : "désactivée : rien à fournir"
    }`,
  );

  const c5 = user.isActive && (user.userTenants.some((t) => t.isActive) || user.role === "SUPER_ADMIN");
  console.log(
    `${c5 ? OK : KO} 5. Revendications (deriveClaims) — ${c5 ? "dérivables" : "NON → la connexion échouerait après le mot de passe"}`,
  );
  if (!c5) blocages.push("deriveClaims retournerait null (aucune adhésion tenant active)");

  // ── 3. Le mot de passe, si fourni ─────────────────────────────────────
  if (password) {
    console.log(`\n${ligne}\nTest du mot de passe fourni\n${ligne}`);
    if (!user.password) {
      console.log(`${KO} Impossible : le compte n'a aucun hash de mot de passe.`);
    } else {
      const match = await bcrypt.compare(password, user.password);
      console.log(`${match ? OK : KO} bcrypt.compare → ${match ? "mot de passe CORRECT" : "mot de passe INCORRECT"}`);
      if (!match) blocages.push("mot de passe incorrect");
    }
  } else {
    console.log(`\n${WARN} Aucun mot de passe fourni : relancer avec --password='…' pour le tester réellement.`);
  }

  // ── 4. Le rôle applicatif (RLS) voit-il le compte ? ───────────────────
  if (app) {
    console.log(`\n${ligne}\nAccès via DATABASE_URL (rôle applicatif, RLS active)\n${ligne}`);
    try {
      const viaApp = await app.user.findFirst({
        where: { email: { equals: email as string, mode: "insensitive" } },
        select: { id: true },
      });
      console.log(
        viaApp
          ? `${OK} Visible via ${cible(process.env.DATABASE_URL as string)}`
          : `${WARN} INVISIBLE via ${cible(process.env.DATABASE_URL as string)} (0 ligne) — lookup pré-session sous RLS : le login passe par DIRECT_URL, ce n'est donc pas bloquant.`,
      );
    } catch (e) {
      console.log(
        `${WARN} Requête impossible via DATABASE_URL : ${String((e as Error).message).split("\n")[0].slice(0, 100)}`,
      );
    }
  }

  // ── 5. Traces des tentatives de connexion ─────────────────────────────
  try {
    const logs = await direct.auditLog.findMany({
      where: { action: "auth:login" },
      select: { createdAt: true, verdict: true, reason: true, metadata: true, resourceId: true, userId: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const miens = logs.filter((l) => {
      const m = l.metadata as { email?: string } | null;
      return typeof m?.email === "string" && m.email.toLowerCase() === (email as string).toLowerCase();
    });
    console.log(`\n${ligne}\nTentatives de connexion pour cet email : ${miens.length}\n${ligne}`);
    if (miens.length === 0) {
      console.log("   Aucune dans les 500 derniers logs auth:login.");
      console.log("   (Les connexions RÉUSSIES ne sont journalisées qu'avec un code 2FA ou pour un SUPER_ADMIN ;");
      console.log("    un succès se lit donc via « dernier login » ci-dessus.)");
    } else {
      miens.slice(0, 12).forEach((l) => {
        const m = l.metadata as { ip?: string } | null;
        console.log(
          `   ${l.createdAt.toISOString()}  ${l.verdict === "ALLOWED" ? OK : KO} ${l.reason ?? ""}  [ip ${m?.ip ?? "?"} — ${
            l.resourceId || l.userId ? `compte identifié (${l.resourceId ?? l.userId}) → mot de passe faux` : "compte NON identifié par le lookup"
          }]`,
        );
      });
    }
  } catch (e) {
    console.log(`\n${WARN} Lecture des logs d'audit impossible : ${String((e as Error).message).split("\n")[0].slice(0, 100)}`);
  }

  // ── 6. Jetons de réinitialisation / vérification en attente ───────────
  // La table `verification_tokens` est partagée : préfixes `reset-password:`
  // (mot de passe oublié) et `verify-email:`/`set-password:` (invitation).
  try {
    const jetons = await direct.verificationToken.findMany({
      where: { identifier: { contains: (email as string).toLowerCase() } },
      select: { identifier: true, expires: true },
      orderBy: { expires: "desc" },
      take: 10,
    });
    console.log(`\n${ligne}\nJetons en attente pour cet email : ${jetons.length}\n${ligne}`);
    if (jetons.length === 0) {
      console.log("   Aucun reset / invitation en cours.");
    } else {
      jetons.forEach((j) => {
        const expire = j.expires.getTime() < Date.now();
        console.log(
          `   ${j.identifier}  →  expire le ${j.expires.toISOString()}${expire ? "  (EXPIRÉ)" : "  (encore valide)"}`,
        );
      });
    }
  } catch (e) {
    console.log(`\n${WARN} Lecture des jetons impossible : ${String((e as Error).message).split("\n")[0].slice(0, 100)}`);
  }
  // ── 7. Emails transactionnels (Resend) liés à ce compte ───────────────
  // L'email de création de compte contient le mot de passe temporaire en
  // clair : si `resendEmailId` est présent, on peut relire le message chez
  // Resend (`GET https://api.resend.com/emails/<id>`) pour le retrouver.
  try {
    const mails = await direct.emailLog.findMany({
      where: { email: { equals: email as string, mode: "insensitive" } },
      select: { type: true, subject: true, status: true, resendEmailId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    console.log(`\n${ligne}\nEmails transactionnels envoyés à cet email : ${mails.length}\n${ligne}`);
    if (mails.length === 0) {
      console.log("   Aucun (l'email de création de compte n'est pas tracé ici).");
    } else {
      mails.forEach((m) =>
        console.log(
          `   ${m.createdAt.toISOString()}  ${m.type}  ${m.status}  « ${m.subject} »  resendId=${m.resendEmailId ?? "(aucun)"}`,
        ),
      );
    }
  } catch (e) {
    console.log(`\n${WARN} Lecture des email_logs impossible : ${String((e as Error).message).split("\n")[0].slice(0, 100)}`);
  }

  // ── 9. Historique d'audit du compte ───────────────────────────────────
  // Répond à « le mot de passe a-t-il été changé depuis la création ? » :
  // `auth:change-password` / `auth:set-password` en ALLOWED = le mot de passe
  // temporaire envoyé par email ne fonctionne plus.
  try {
    const hist = await direct.auditLog.findMany({
      where: { OR: [{ userId: user.id }, { resourceId: user.id }] },
      select: { createdAt: true, action: true, verdict: true, reason: true, metadata: true },
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    console.log(`\n${ligne}\nHistorique d'audit de ce compte : ${hist.length} entrée(s)\n${ligne}`);
    if (hist.length === 0) {
      console.log("   Aucune entrée d'audit liée à ce userId.");
    } else {
      hist.forEach((h) => {
        const m = h.metadata as Record<string, unknown> | null;
        const extra = m && Object.keys(m).length ? ` ${JSON.stringify(m).slice(0, 90)}` : "";
        console.log(
          `   ${h.createdAt.toISOString()}  ${h.action}  ${h.verdict}${h.reason ? `  (${h.reason})` : ""}${extra}`,
        );
      });
    }
  } catch (e) {
    console.log(`\n${WARN} Lecture de l'historique d'audit impossible : ${String((e as Error).message).split("\n")[0].slice(0, 100)}`);
  }

  // ── 10. Test en direct de l'API de production (option --live) ─────────
  // `/api/auth/2fa/check-required` est l'oracle que le front appelle AVANT
  // signIn() : si elle répond « mot de passe bon, compte actif, email vérifié »,
  // alors authorize() passera les mêmes contrôles.
  if (live) {
    console.log(`\n${ligne}\nAppel réel /api/auth/2fa/check-required (production)\n${ligne}`);
    if (!password) {
      console.log(`${WARN} --live exige --password='…' (la route compare le mot de passe).`);
    } else {
      // Base de l'appel : par défaut la production. `NEXT_PUBLIC_APP_URL` est
      // la seule variable d'environnement admise ici — le garde-fou
      // `check-env-docs.mjs` refuse toute variable non documentée dans
      // `.env.example`.
      const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://ecolemiriam.com";
      try {
        const res = await fetch(`${base}/api/auth/2fa/check-required`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        console.log(`   POST ${base}/api/auth/2fa/check-required → ${res.status} ${JSON.stringify(body)}`);
        // ATTENTION : la réponse NEUTRE (mot de passe faux ou email inconnu) est
        // `{ requires2FA: false, emailVerified: true }` — indiscernable d'un
        // succès si l'on ne regarde que ces deux champs. Le discriminant est la
        // présence EXPLICITE de `accountDisabled` (route l.107-115) : elle n'est
        // renvoyée qu'APRÈS un bcrypt.compare réussi.
        const accepte = res.status === 200 && body.accountDisabled === false;
        if (accepte) {
          console.log(
            `${OK} Mot de passe accepté, compte actif et vérifié${body.requires2FA ? " — un code 2FA sera demandé" : ""} → la connexion aboutira.`,
          );
        } else if (res.status === 429) {
          console.log(`${WARN} Rate limit atteint sur cet email (5 / 15 min) — réessayer plus tard.`);
        } else {
          console.log(
            `${KO} Réponse neutre (pas de champ accountDisabled) : mot de passe refusé, OU compte absent de la base de production.`,
          );
        }
      } catch (e) {
        console.log(`${WARN} Appel impossible : ${String((e as Error).message).split("\n")[0].slice(0, 120)}`);
      }
    }
  }

  // ── Verdict ───────────────────────────────────────────────────────────
  console.log(`\n${ligne}\nVERDICT\n${ligne}`);
  if (blocages.length === 0) {
    console.log(
      `${OK} Le compte peut se connecter${password ? "" : " (mot de passe non testé — fournir --password pour confirmer)"}.`,
    );
    if (user.mustChangePassword) console.log(`   ${WARN} À la 1re connexion, redirection vers /change-password.`);
  } else {
    console.log(`${KO} Connexion BLOQUÉE :`);
    blocages.forEach((b) => console.log(`   - ${b}`));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await direct.$disconnect();
    await app?.$disconnect();
  });
