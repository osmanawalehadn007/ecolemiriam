#!/usr/bin/env node
/**
 * Rotation des mots de passe PUBLIÉS dans l'historique git.
 * ============================================================
 * Six comptes réels de production ont eu leur mot de passe versionné (voir
 * docs/COMPTES-EXPOSES-ROTATION.md). Le code a été nettoyé et la CI refuse
 * désormais ce motif, mais un mot de passe publié reste valide tant qu'il n'a
 * pas été changé.
 *
 * DIAGNOSTIC PAR DÉFAUT : sans `--apply`, le script ne fait que LIRE et
 * afficher ce qu'il ferait. Aucun mot de passe n'est modifié.
 *
 * Usage :
 *   npx tsx scripts/rotater-mots-de-passe-exposes.ts            # lecture seule
 *   npx tsx scripts/rotater-mots-de-passe-exposes.ts --apply    # rotation réelle
 *
 * ⚠️  `--apply` écrit dans la base visée par DIRECT_URL (production par défaut)
 *     et invalide immédiatement les mots de passe actuels : les utilisateurs
 *     devront utiliser le mot de passe temporaire affiché, puis le changer.
 *
 * Effets de bord à connaître :
 *   - `mustChangePassword = true` : un changement est exigé à la reconnexion ;
 *   - les SESSIONS EN COURS ne sont PAS invalidées (jeton JWT, durée par défaut
 *     de 30 jours chez Auth.js) — pour couper tout de suite, il faut aussi
 *     régénérer AUTH_SECRET (voir docker/scripts/secrets-rotate.sh).
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

/** Comptes dont le mot de passe figure dans l'historique du dépôt. */
const COMPTES_EXPOSES = [
  "ilyasadendjama@gmail.com",
  "ahdimounomar@gmail.com",
  "awaleh.osman.adn@gmail.com",
  "mohamed.abdi.pk12@gmail.com",
  "dya.adine@miriam.dj",
  "zdouce.zz@gmail.com",
];

const APPLIQUER = process.argv.includes("--apply");

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL } },
});

/** Un mot de passe temporaire lisible mais non devinable. */
function motDePasseTemporaire(): string {
  return `Tmp-${randomBytes(9).toString("base64url")}!`;
}

function cible(url: string | undefined): string {
  if (!url) return "INCONNUE (DIRECT_URL absent)";
  const m = url.replace(/:[^:@/]+@/, ":***@").match(/@([^/]+)\/([^?]+)/);
  return m ? `${m[1]}/${m[2]}` : "?";
}

async function main() {
  console.log(`Base visée : ${cible(process.env.DIRECT_URL)}`);
  console.log(APPLIQUER ? "Mode : ROTATION (écriture)\n" : "Mode : diagnostic (lecture seule)\n");

  const comptes = await prisma.user.findMany({
    where: { email: { in: COMPTES_EXPOSES, mode: "insensitive" } },
    select: { id: true, email: true, role: true, isActive: true, mustChangePassword: true },
    orderBy: { email: "asc" },
  });

  if (comptes.length === 0) {
    console.log("Aucun des comptes listés n'existe dans cette base.");
    return;
  }

  const manquants = COMPTES_EXPOSES.filter(
    (e) => !comptes.some((c) => c.email.toLowerCase() === e.toLowerCase()),
  );

  console.log(`${comptes.length} compte(s) trouvé(s) :`);
  for (const c of comptes) {
    console.log(
      `  - ${c.email} (${c.role}${c.isActive ? "" : ", inactif"}${
        c.mustChangePassword ? ", changement déjà exigé" : ""
      })`,
    );
  }
  if (manquants.length) console.log(`\nNon trouvé(s) dans cette base : ${manquants.join(", ")}`);

  if (!APPLIQUER) {
    console.log(
      "\nRien n'a été modifié. Pour appliquer la rotation :\n" +
        "  npx tsx scripts/rotater-mots-de-passe-exposes.ts --apply\n" +
        "Pensez à transmettre chacun des mots de passe temporaires aux personnes concernées.",
    );
    return;
  }

  console.log("");
  const resultats: Array<{ email: string; motDePasse: string }> = [];
  for (const c of comptes) {
    const motDePasse = motDePasseTemporaire();
    const hash = await bcrypt.hash(motDePasse, 12);
    await prisma.user.update({
      where: { id: c.id },
      data: { password: hash, mustChangePassword: true },
    });
    resultats.push({ email: c.email, motDePasse });
    console.log(`✅ ${c.email} — mot de passe remplacé`);
  }

  console.log("\n=== Mots de passe temporaires (à transmettre, puis à supprimer) ===");
  for (const r of resultats) console.log(`  ${r.email}  :  ${r.motDePasse}`);
  console.log(
    "\n⚠️  Les sessions déjà ouvertes restent valides jusqu'à l'expiration du JWT\n" +
      "    (30 jours par défaut). Pour les couper immédiatement : régénérer\n" +
      "    AUTH_SECRET (docker/scripts/secrets-rotate.sh) — cela déconnecte tout le monde.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
