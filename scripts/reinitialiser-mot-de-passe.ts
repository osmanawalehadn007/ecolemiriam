#!/usr/bin/env node
/**
 * Réinitialisation ciblée du mot de passe d'un compte (opération d'exploitation).
 * ============================================================
 * POURQUOI CE CLI EXISTE
 * Aucun écran d'administration ne permet de fixer un mot de passe : Paramètres →
 * Utilisateurs n'offre que « Renvoyer l'email de vérification » et « Marquer
 * l'email comme vérifié ». Quand l'utilisateur n'a plus accès à sa boîte mail —
 * ou que le lien « Mot de passe oublié » n'est pas praticable — il n'existait
 * aucune voie : c'est ce trou que comble ce script, sans jamais passer par un
 * `UPDATE` SQL manuel non tracé.
 *
 * CE QU'IL FAIT, EXACTEMENT
 *   • génère un mot de passe fort de 16 caractères avec `generateSecurePassword`
 *     (le générateur de la création de compte), et vérifie qu'il satisfait
 *     `validatePasswordStrength` — l'invariant est testé, pas supposé ;
 *   • le hache en bcrypt **coût 12**, comme `parametres.ts` et `auth.ts` ;
 *   • pose `mustChangePassword = true` : l'utilisateur DEVRA le changer à sa
 *     première connexion, le mot de passe transmis n'est pas durable ;
 *   • écrit une entrée d'audit `user:password:reset` (email, source) : aussi
 *     traçable que l'aurait été le bouton manquant ;
 *   • option `--corriger-nom` : retire d'un `name` le fragment « Email:… »
 *     collé lors d'une saisie manuelle ou d'un import, tracé par
 *     `user:name:cleanup` (avant / après dans les métadonnées).
 *
 * CE QU'IL NE FAIT PAS
 *   • il n'envoie AUCUN email (le mot de passe est affiché une seule fois à
 *     l'opérateur, qui le transmet par un canal sûr) ;
 *   • il n'invalide PAS les sessions JWT en cours (30 jours par défaut) —
 *     cf. docs/COMPTES-EXPOSES-ROTATION.md.
 *
 * Usage (APERÇU par défaut, aucune écriture) :
 *   export DIRECT_URL="$(grep '^DIRECT_URL=' .env | cut -d= -f2- | tr -d '\"')"
 *   npx tsx scripts/reinitialiser-mot-de-passe.ts <email>                          # aperçu
 *   npx tsx scripts/reinitialiser-mot-de-passe.ts <email> --apply                   # applique
 *   npx tsx scripts/reinitialiser-mot-de-passe.ts <email> --corriger-nom --apply    # + nom
 *   npx tsx scripts/reinitialiser-mot-de-passe.ts <email> --corriger-nom --sans-reset --apply
 *
 * La table `users` est sous RLS : lancer avec DIRECT_URL (rôle direct), sinon
 * le compte est invisible et le script s'arrête avant toute écriture.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { generateSecurePassword, validatePasswordStrength } from "@/lib/security/password";

const directUrl = process.env.DIRECT_URL;
if (!directUrl) {
  console.error("❌ DIRECT_URL manquant (rôle direct, hors pooler). Voir AGENTS.md § Connexions DB.");
  process.exit(1);
}

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"));
const appliquer = args.includes("--apply");
const corrigerNom = args.includes("--corriger-nom");
const sansReset = args.includes("--sans-reset");
const ouiSuperAdmin = args.includes("--oui-super-admin");

if (!email) {
  console.error("Usage : npx tsx scripts/reinitialiser-mot-de-passe.ts <email> [--apply] [--corriger-nom] [--sans-reset]");
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: directUrl } } });
const SOURCE = "scripts/reinitialiser-mot-de-passe.ts";
const ligne = "─".repeat(62);

/** Retire un fragment e-mail collé dans le nom (« … Email:dupont@x.dj »). */
export function nettoyerNom(nom: string): string {
  return nom
    .replace(/\s*\bemail\b\s*:?\s*\S+@\S+\.\S+\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cible(url: string): string {
  const m = url.replace(/:[^:@/]+@/, ":***@").match(/@([^/]+)\/([^?]+)/);
  return m ? `${m[1]}/${m[2]}` : "?";
}

async function main() {
  console.log(`Base visée : ${cible(directUrl as string)}`);
  console.log(appliquer ? "Mode : APPLICATION (écriture)\n" : "Mode : aperçu (aucune écriture)\n");

  const user = await prisma.user.findFirst({
    where: { email: { equals: email as string, mode: "insensitive" } },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      emailVerified: true,
      mustChangePassword: true,
      tenantId: true,
      lastLoginAt: true,
    },
  });

  if (!user) {
    console.error(`❌ Aucun compte avec l'email ${email} sur cette base.`);
    const [local, domaine] = (email as string).split("@");
    const proches = await prisma.user.findMany({
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
      console.log("   Emails proches :");
      proches.forEach((p) => console.log(`   - ${p.email}`));
    }
    process.exitCode = 1;
    return;
  }

  console.log(`${ligne}\nCompte ciblé\n${ligne}`);
  console.log(`   id           : ${user.id}`);
  console.log(`   email        : ${user.email}`);
  console.log(`   nom actuel   : ${user.name}`);
  console.log(`   rôle         : ${user.role}`);
  console.log(`   actif        : ${user.isActive ? "oui" : "NON (désactivé)"}`);
  console.log(`   email vérifié: ${user.emailVerified ? "oui" : "NON"}`);
  console.log(`   mdp à changer: ${user.mustChangePassword ? "oui" : "non"}`);
  console.log(`   dernier login: ${user.lastLoginAt ? user.lastLoginAt.toISOString() : "JAMAIS"}`);

  if (!user.isActive) {
    console.log(`\n⚠️  Compte désactivé : le mot de passe sera posé, mais la connexion restera refusée (isActive=false).`);
  }
  if (user.role === "SUPER_ADMIN" && !ouiSuperAdmin) {
    // Garde-fou : se tromper de compte sur un SUPER_ADMIN peut fermer la
    // plateforme à son administrateur. On exige un drapeau explicite.
    console.log(
      `\n❌ Ce compte est SUPER_ADMIN. Par sécurité, ajouter --oui-super-admin pour confirmer explicitement l'intention.`,
    );
    process.exitCode = 1;
    return;
  }

  if (sansReset && !corrigerNom) {
    console.log(`\n⚠️  --sans-reset sans --corriger-nom : il n'y a rien à faire.`);
    return;
  }

  let motDePasse: string | null = null;

  // ── 1. Réinitialisation du mot de passe ───────────────────────────────
  if (!sansReset) {
    console.log(`\n${ligne}\n1. Mot de passe\n${ligne}`);
    if (!appliquer) {
      console.log("   Un mot de passe fort de 16 caractères sera généré, haché en bcrypt (coût 12)");
      console.log("   et `mustChangePassword` passera à true. Rien n'est écrit tant que --apply est absent.");
    } else {
      motDePasse = generateSecurePassword(16);
      const faiblesse = validatePasswordStrength(motDePasse);
      if (faiblesse) {
        // Invariant du projet : le générateur doit toujours produire un mot de
        // passe acceptable. Si ce n'est plus vrai, on échoue ici plutôt que
        // d'écrire un mot de passe que l'application refuserait de créer.
        console.error(`❌ Le générateur a produit un mot de passe invalide (${faiblesse}) — abandon.`);
        process.exitCode = 1;
        return;
      }
      const hash = await bcrypt.hash(motDePasse, 12);
      await prisma.user.update({
        where: { id: user.id },
        data: { password: hash, mustChangePassword: true },
      });
      await prisma.auditLog.create({
        data: {
          tenantId: user.tenantId,
          userId: null,
          action: "user:password:reset",
          verdict: "ALLOWED",
          resource: "user",
          resourceId: user.id,
          reason: "Mot de passe réinitialisé par CLI — changement obligatoire à la prochaine connexion",
          metadata: { email: user.email, mustChangePassword: true, source: SOURCE },
        },
      });
      console.log(`   ✔ Mot de passe remplacé (bcrypt coût 12) et mustChangePassword = true.`);
      console.log(`   ✔ Audit écrit : user:password:reset (ALLOWED).`);
    }
  }

  // ── 2. Nettoyage du nom (fragment e-mail collé) ───────────────────────
  if (corrigerNom) {
    console.log(`\n${ligne}\n2. Nom du compte\n${ligne}`);
    const propre = nettoyerNom(user.name);
    if (propre === user.name) {
      console.log("   Aucun fragment « Email:… » à retirer — rien à faire.");
    } else if (propre.length < 3) {
      // Ne jamais remplacer un nom par une chaîne vide ou quasi vide : perdre
      // l'identité de la fiche serait pire que garder un fragment disgracieux.
      console.log(`   ❌ Le nettoyage produirait « ${propre} » (trop court) — refusé. Corriger à la main.`);
      process.exitCode = 1;
      return;
    } else {
      console.log(`   avant : ${user.name}`);
      console.log(`   après : ${propre}`);
      if (!appliquer) {
        console.log("   (aperçu — rien n'est écrit)");
      } else {
        await prisma.user.update({ where: { id: user.id }, data: { name: propre } });
        await prisma.auditLog.create({
          data: {
            tenantId: user.tenantId,
            userId: null,
            action: "user:name:cleanup",
            verdict: "ALLOWED",
            resource: "user",
            resourceId: user.id,
            reason: "Fragment « Email:… » retiré du nom (saisie manuelle ou import)",
            metadata: { email: user.email, avant: user.name, apres: propre, source: SOURCE },
          },
        });
        console.log(`   ✔ Nom corrigé. Audit écrit : user:name:cleanup (ALLOWED).`);
      }
    }
  }

  // ── Récapitulatif ─────────────────────────────────────────────────────
  console.log(`\n${ligne}\nRÉCAPITULATIF\n${ligne}`);
  if (!appliquer) {
    console.log("Aucune écriture. Relancer avec --apply pour appliquer.");
    return;
  }
  if (motDePasse) {
    console.log("Mot de passe temporaire à transmettre à l'utilisateur :\n");
    console.log(`        ${motDePasse}\n`);
    console.log("⚠️  Affiché UNE SEULE FOIS (il n'est stocké qu'en hash bcrypt).");
    console.log("⚠️  L'utilisateur devra le changer dès sa première connexion.");
    console.log("⚠️  Les sessions JWT déjà ouvertes ne sont pas révoquées.");
  }
  console.log(`Connexion : ${process.env.NEXT_PUBLIC_APP_URL ?? "https://ecolemiriam.com"}/login`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
