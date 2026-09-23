/**
 * Patch P1 — pose `guardPage(session, "<permission>")` sur les pages du
 * dashboard qui n'en avaient aucune (`docs/AUDIT_RBAC_ROLES.md` § 4 → P1).
 *
 * Idempotent : une page qui porte déjà `guardPage(` est ignorée.
 *
 * Usage :
 *   npx tsx scripts/patch-guard-page.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DASHBOARD = join("src", "app", "(dashboard)");

/**
 * Permission de lecture du module servi par la page. Les écrans d'écriture
 * (inscription, modification, génération de comptes, transfert, création de
 * facture) exigent la permission d'**écriture** : mieux vaut rediriger que
 * laisser remplir un formulaire dont l'action serveur répondra 403.
 */
const PAGES: Record<string, string> = {
  "eleves/page.tsx": "eleves:read",
  "eleves/[id]/page.tsx": "eleves:read",
  "eleves/attestations/page.tsx": "eleves:read",
  "eleves/cartes/page.tsx": "eleves:read",
  "eleves/nouveau/page.tsx": "eleves:write",
  "eleves/[id]/modifier/page.tsx": "eleves:write",
  "eleves/comptes/page.tsx": "eleves:write",
  "eleves/transfert/page.tsx": "eleves:write",
  "parents/page.tsx": "parents:read",
  "notes/page.tsx": "notes:read",
  // Page de bulletins : `bulletins:read` (et non `notes:read`) — le
  // secrétariat a `bulletins:read` sans accès au module `notes`.
  "notes/bulletins/page.tsx": "bulletins:read",
  "cours/page.tsx": "cours:read",
  "emploi-du-temps/page.tsx": "emploi-du-temps:read",
  "absences/page.tsx": "absences:read",
  "absences/appel/page.tsx": "absences:read",
  "evaluations/page.tsx": "evaluations:read",
  "evaluations/[id]/page.tsx": "evaluations:read",
  "examens/page.tsx": "examens:read",
  "examens/rapport-classe/page.tsx": "examens:read",
  "orientation/page.tsx": "orientation:read",
  "alumni/page.tsx": "alumni:read",
  "messages/page.tsx": "messages:read",
  "vie-scolaire/convocations/page.tsx": "vie-scolaire:write",
  "facturation/nouvelle/page.tsx": "finance:write",
  "facturation/[id]/page.tsx": "finance:read",
};

const IMPORT_LINE = 'import { guardPage } from "@/lib/guard-page";';
const AUTH_CHECK = 'if (!session?.user?.tenantId) redirect("/login");';

let patched = 0;
const skipped: string[] = [];

for (const [relative, permission] of Object.entries(PAGES)) {
  const file = join(DASHBOARD, relative);
  let content = readFileSync(file, "utf8");

  if (content.includes("guardPage(")) {
    skipped.push(`${relative} (déjà gardé)`);
    continue;
  }

  const lines = content.split("\n");
  const authIndex = lines.findIndex((line) => line.trim() === AUTH_CHECK);
  if (authIndex === -1) {
    skipped.push(`${relative} (motif d'authentification introuvable)`);
    continue;
  }

  const guardLine = `  guardPage(session, "${permission}");`;
  lines.splice(authIndex + 1, 0, guardLine);

  if (!content.includes(IMPORT_LINE)) {
    const firstImport = lines.findIndex((line) => line.startsWith("import "));
    lines.splice(firstImport, 0, IMPORT_LINE);
  }

  content = lines.join("\n");
  writeFileSync(file, content);
  patched += 1;
  console.log(`✔ ${relative} → ${permission}`);
}

for (const entry of skipped) console.log(`⏭️  ${entry}`);
console.log(`\n${patched} page(s) gardée(s), ${skipped.length} ignorée(s).`);
