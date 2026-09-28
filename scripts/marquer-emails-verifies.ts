#!/usr/bin/env node
/**
 * Rattrapage : marquer comme vérifiés les emails non vérifiés.
 * ============================================================
 * Le chemin NOMINAL reste le bouton **Paramètres → Utilisateurs →
 * « Marquer l'email comme vérifié »** (`marquerEmailsVerifies`), qui est
 * permissionné et tracé (voir AGENTS.md §22). Ce CLI existe pour les cas où le
 * bouton n'est pas praticable :
 *   - rattrapage après un import massif (centaines de comptes) ;
 *   - base sans session d'administrateur disponible.
 *
 * Il applique EXACTEMENT la même règle que l'action serveur :
 *   - seuls les comptes dont `emailVerified` est nul sont touchés ;
 *   - périmètre : tous les établissements (ou un seul avec `--tenant=`) ;
 *   - une entrée d'audit `user:email:verify` est écrite par établissement,
 *     avec le nombre et la liste des adresses (traçabilité identique).
 *
 * Usage (LECTURE SEULE par défaut) :
 *   export DIRECT_URL="$(grep '^DIRECT_URL=' .env | cut -d= -f2- | tr -d '"')"
 *   npx tsx scripts/marquer-emails-verifies.ts                    # aperçu
 *   npx tsx scripts/marquer-emails-verifies.ts --apply            # applique
 *   npx tsx scripts/marquer-emails-verifies.ts --tenant=<id> --apply
 */
import { PrismaClient } from "@prisma/client";

const url = process.env.DIRECT_URL;
if (!url) {
  console.error("DIRECT_URL manquant (rôle direct/owner, hors pooler).");
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url } } });

const appliquer = process.argv.includes("--apply");
const tenantArg = process.argv.find((a) => a.startsWith("--tenant="))?.split("=")[1];

function cible(url: string): string {
  const m = url.replace(/:[^:@/]+@/, ":***@").match(/@([^/]+)\/([^?]+)/);
  return m ? `${m[1]}/${m[2]}` : "?";
}

async function main() {
  console.log(`Base visée : ${cible(url as string)}`);
  console.log(appliquer ? "Mode : APPLICATION (écriture)\n" : "Mode : aperçu (lecture seule)\n");

  const comptes = await prisma.user.findMany({
    where: {
      emailVerified: null,
      ...(tenantArg ? { tenantId: tenantArg } : {}),
    },
    select: { id: true, email: true, tenantId: true, role: true, isActive: true },
    orderBy: { createdAt: "asc" },
  });

  if (comptes.length === 0) {
    console.log("Aucun compte à vérifier.");
    return;
  }

  const parTenant = new Map<string, typeof comptes>();
  for (const c of comptes) {
    const liste = parTenant.get(c.tenantId);
    if (liste) liste.push(c);
    else parTenant.set(c.tenantId, [c]);
  }

  console.log(`${comptes.length} compte(s) non vérifié(s) sur ${parTenant.size} établissement(s) :`);
  for (const [tenantId, liste] of parTenant) {
    console.log(`\n  tenant ${tenantId} (${liste.length})`);
    liste.slice(0, 30).forEach((c) => console.log(`   - ${c.email} (${c.role}${c.isActive ? "" : ", inactif"})`));
    if (liste.length > 30) console.log(`   … (+${liste.length - 30})`);
  }

  if (!appliquer) {
    console.log("\nAucune écriture. Relancer avec --apply pour appliquer.");
    return;
  }

  const marque = new Date();
  for (const [tenantId, liste] of parTenant) {
    await prisma.user.updateMany({
      where: { id: { in: liste.map((c) => c.id) }, tenantId, emailVerified: null },
      data: { emailVerified: marque },
    });
    // Trace identique à celle du bouton (AGENTS.md §22).
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId: null,
        action: "user:email:verify",
        verdict: "ALLOWED",
        resource: "user",
        reason: `${liste.length} email(s) marqué(s) vérifié(s) — rattrapage opérationnel (CLI)`,
        metadata: { total: liste.length, emails: liste.map((c) => c.email).slice(0, 50), source: "scripts/marquer-emails-verifies.ts" },
      },
    });
    console.log(`\n✔ ${liste.length} compte(s) vérifié(s) — tenant ${tenantId} (audit écrit)`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
