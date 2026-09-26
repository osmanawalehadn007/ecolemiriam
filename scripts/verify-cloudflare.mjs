#!/usr/bin/env node
/**
 * Vérifie la connexion à l'API Cloudflare (production : ecolemiriam.com).
 * ============================================================
 * Le domaine de production est servi par Cloudflare (Tunnel → conteneur GCP) :
 * un identifiant Cloudflare erroné ne se voit donc qu'au moment du
 * déploiement, en production. Ce script transforme ce risque en diagnostic
 * local, exécutable avant toute mise en ligne.
 *
 * Contrôles, dans l'ordre :
 *   1. le jeton API est actif            — GET /user/tokens/verify
 *   2. le compte visé est accessible     — GET /accounts
 *   3. la zone de production est visible — GET /zones
 *   4. les enregistrements DNS se lisent — GET /zones/{id}/dns_records
 *   5. les tunnels du compte se lisent   — GET /accounts/{id}/cfd_tunnel
 *
 * ⚠️ Piège le plus fréquent : confondre l'Account ID (32 caractères
 *    hexadécimaux) avec un jeton API. Un Account ID envoyé en
 *    `Authorization: Bearer …` est rejeté par Cloudflare avec l'erreur 6111
 *    « Invalid format for Authorization header » — message qui ne dit pas
 *    quelle valeur est fautive, seulement que le format est invalide.
 *
 * Usage  : node scripts/verify-cloudflare.mjs     (ou `npm run cf:verify`)
 * Env    : CLOUDFLARE_API_TOKEN (requis), CLOUDFLARE_ACCOUNT_ID et
 *          CLOUDFLARE_ZONE_ID (optionnels, déduits de l'API si absents).
 *
 * Deux familles de jetons, deux endpoints de validation :
 *   • jeton utilisateur (`cfut_`) → GET /user/tokens/verify
 *   • jeton de compte  (`cfat_`)  → GET /accounts/{account_id}/tokens/verify
 * Les confondre produit un faux « Invalid API Token » sur un jeton valide.
 */
import { readFileSync, existsSync } from "node:fs";

const API = "https://api.cloudflare.com/client/v4";
const PROD_DOMAIN = "ecolemiriam.com";

/** Charge `.env` sans dépendance externe — une variable déjà exportée gagne. */
function loadDotEnv(path = ".env") {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "").trim();
  }
}
loadDotEnv();

const TOKEN = (process.env.CLOUDFLARE_API_TOKEN ?? "").trim();
const ACCOUNT_ID = (process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.R2_ACCOUNT_ID ?? "").trim();
const ZONE_ID = (process.env.CLOUDFLARE_ZONE_ID ?? "").trim();

/** Aucun secret en clair dans la sortie (les logs de CI sont conservés). */
const mask = (v) => (v.length <= 12 ? "•".repeat(Math.max(v.length, 4)) : `${v.slice(0, 4)}…${v.slice(-4)}`);
/** Un Account ID Cloudflare : exactement 32 caractères hexadécimaux. */
const isAccountId = (v) => /^[0-9a-f]{32}$/i.test(v);
/** Aplatit la réponse d'erreur : Cloudflare niche les codes précis (6111…) dans `error_chain`. */
const apiError = (body) => {
  const flat = (list) =>
    (list ?? []).flatMap((e) => [`[${e.code}] ${e.message}`, ...flat(e.error_chain)]);
  const detail = body?.errors ? flat(body.errors).join(" / ") : "";
  return detail || "réponse illisible (incident réseau ou API Cloudflare ?)";
};

const problems = [];
const warnings = [];
const wrap = (s) => String(s).replace(/\n/g, "\n      ");

async function cf(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* réponse non JSON (502, page HTML d'incident…) */
  }
  return { status: res.status, body };
}

async function main() {
  console.log(`☁️  Cloudflare — vérification de la connexion à ${PROD_DOMAIN}`);
  console.log(`   jeton  : ${TOKEN ? mask(TOKEN) : "(absent)"}`);
  console.log(`   compte : ${ACCOUNT_ID || "(déduit depuis l'API)"}`);

  // --- 0. Un jeton est-il configuré ? --------------------------------------
  if (!TOKEN) {
    console.log("\n1. Validité du jeton — non testée (CLOUDFLARE_API_TOKEN vide)");
    problems.push(
      "Aucun jeton : renseigner CLOUDFLARE_API_TOKEN dans .env (40 caractères, ou préfixe\n" +
        "« cfut_ ») — dashboard Cloudflare > My Profile > API Tokens > Create Token."
    );
    return;
  }

  // --- 1. Le jeton est-il valide ? -----------------------------------------
  // L'endpoint dépend de la famille du jeton (cfut_ / cfat_). On essaie les
  // candidats dans l'ordre plutôt que de conclure trop vite à un jeton révoqué.
  const isAccountToken = /^cfat_/i.test(TOKEN);
  const candidates = [
    ...(isAccountToken && ACCOUNT_ID ? [`/accounts/${ACCOUNT_ID}/tokens/verify`] : ["/user/tokens/verify"]),
    ...(!isAccountToken && ACCOUNT_ID ? [`/accounts/${ACCOUNT_ID}/tokens/verify`] : []),
  ];

  let verifiedAt = "";
  let verified = null;
  let detail = "";
  for (const path of candidates) {
    const res = await cf(path);
    if (res.body?.success && res.body.result?.status === "active") {
      verifiedAt = path;
      verified = res.body.result;
      break;
    }
    detail = apiError(res.body);
  }

  if (verified) {
    const family = verifiedAt.startsWith("/accounts/") ? "jeton de compte" : "jeton utilisateur";
    console.log(`\n1. Validité du jeton — GET ${verifiedAt}`);
    console.log(`   ✅ ${family} actif — id ${verified.id}`);
    if (verified.expires_on) {
      const days = Math.ceil((new Date(verified.expires_on).getTime() - Date.now()) / 86_400_000);
      console.log(`      expire le ${String(verified.expires_on).slice(0, 10)} — dans ${days} jour(s)`);
      if (days <= 30) {
        warnings.push(
          `Le jeton expire dans ${days} jour(s) (le ${String(verified.expires_on).slice(0, 10)}) : le renouveler ` +
            "avant cette date, sinon le déploiement et les outils Cloudflare cesseront de fonctionner sans prévenir."
        );
      }
    }
  } else {
    console.log(`\n1. Validité du jeton — GET ${candidates[0]}`);
    console.log(`   ❌ jeton refusé — ${detail}`);
    if (isAccountId(TOKEN)) {
      problems.push(
        "CLOUDFLARE_API_TOKEN contient un Account ID (32 caractères hexadécimaux), pas un jeton.\n" +
          "Déplacer cette valeur vers CLOUDFLARE_ACCOUNT_ID, puis créer un jeton :\n" +
          "dashboard Cloudflare > My Profile > API Tokens > Create Token."
      );
    } else if (/6111|Invalid format/i.test(detail)) {
      problems.push(
        "Le jeton est tronqué ou mal copié : un jeton Cloudflare fait 40 caractères\n" +
          "ou commence par « cfut_ » (utilisateur) / « cfat_ » (compte). Le régénérer\n" +
          "et coller la valeur entière."
      );
    } else if (isAccountToken && !ACCOUNT_ID) {
      problems.push(
        "Jeton de compte (« cfat_ ») sans CLOUDFLARE_ACCOUNT_ID : renseigner l'Account ID\n" +
          "pour que le jeton puisse être validé et utilisé."
      );
    } else {
      problems.push(`Jeton invalide, expiré ou révoqué (${detail}).`);
    }
    return; // inutile d'interroger les autres endpoints
  }

  // --- 2. Le compte est-il accessible ? ------------------------------------
  // Un jeton de compte est déjà lié à un seul compte : on l'interroge
  // directement. Un jeton utilisateur, lui, peut couvrir plusieurs comptes.
  if (isAccountToken) {
    console.log(`\n2. Compte — GET /accounts/{id}`);
    if (!ACCOUNT_ID) {
      warnings.push("CLOUDFLARE_ACCOUNT_ID absent : un jeton de compte (« cfat_ ») ne peut pas être ciblé.");
    } else {
      const acc = await cf(`/accounts/${ACCOUNT_ID}`);
      if (acc.body?.success) {
        console.log(`   ✅ ${acc.body.result.name} — ${acc.body.result.id}`);
      } else {
        console.log(`   ❌ ${apiError(acc.body)}`);
        problems.push(`Compte ${mask(ACCOUNT_ID)} inaccessible avec ce jeton (${apiError(acc.body)}).`);
      }
    }
  } else {
    console.log("\n2. Comptes accessibles — GET /accounts");
    const accounts = await cf("/accounts?per_page=50");
    const accountList = accounts.body?.result ?? [];
    if (!accounts.body?.success) {
      warnings.push(
        `Liste des comptes illisible (${apiError(accounts.body)}) : le jeton n'a pas « Account → Account Settings → Read ». ` +
          "Renseigner CLOUDFLARE_ACCOUNT_ID à la main contourne ce point."
      );
    } else if (!accountList.length) {
      warnings.push(
        "Aucun compte rattaché au jeton : normal pour un jeton limité à une zone (« Edit zone DNS »)."
      );
    } else {
      for (const a of accountList) {
        console.log(`   • ${a.name} — ${a.id}${a.id === ACCOUNT_ID ? "   ← CLOUDFLARE_ACCOUNT_ID" : ""}`);
      }
      if (ACCOUNT_ID && !accountList.some((a) => a.id === ACCOUNT_ID)) {
        problems.push(
          `CLOUDFLARE_ACCOUNT_ID (${mask(ACCOUNT_ID)}) n'appartient pas aux comptes de ce jeton : ` +
            "vérifier la valeur ou élargir la portée du jeton."
        );
      }
    }
  }

  // --- 3. La zone de production est-elle visible ? -------------------------
  console.log(`\n3. Zone ${PROD_DOMAIN} — GET /zones`);
  const zoneRes = ZONE_ID ? await cf(`/zones/${ZONE_ID}`) : await cf(`/zones?name=${PROD_DOMAIN}`);
  const zone = Array.isArray(zoneRes.body?.result) ? zoneRes.body.result[0] : zoneRes.body?.result;
  const zoneId = zone?.id ?? "";

  if (!zoneRes.body?.success || !zone) {
    console.log(`   ❌ zone introuvable — ${apiError(zoneRes.body)}`);
    problems.push(
      `Zone ${PROD_DOMAIN} invisible : accorder « Zone → Zone → Read » sur cette zone, ` +
        "ou renseigner CLOUDFLARE_ZONE_ID si le jeton ne porte que des droits DNS."
    );
  } else {
    console.log(`   ✅ ${zone.name} — id ${zoneId}`);
    console.log(`      statut ${zone.status} | plan ${zone.plan?.name ?? "?"}`);
    console.log(`      NS     ${(zone.name_servers ?? []).join(", ") || "?"}`);
    if (zone.status !== "active") {
      warnings.push(`Zone ${zone.name} en statut « ${zone.status} » alors que la production est en ligne (attendu : active).`);
    }
    if (!(zone.name_servers ?? []).some((ns) => ns.endsWith(".ns.cloudflare.com"))) {
      warnings.push("Serveurs de noms non Cloudflare : le domaine n'est pas proxifié par Cloudflare.");
    }
  }

  // --- 4. Les enregistrements DNS sont-ils lisibles ? ----------------------
  console.log("\n4. DNS — GET /zones/{id}/dns_records");
  if (!zoneId) {
    warnings.push("DNS non vérifié : zone inconnue (voir le point 3).");
  } else {
    const dns = await cf(`/zones/${zoneId}/dns_records?per_page=5`);
    if (!dns.body?.success) {
      console.log(`   ⚠️  illisible — ${apiError(dns.body)}`);
      warnings.push(
        "DNS illisible : ajouter « Zone → DNS → Edit » (ou Read) au jeton pour gérer les enregistrements."
      );
    } else {
      const records = dns.body.result ?? [];
      console.log(`   ✅ ${records.length} enregistrement(s) lu(s) (aperçu) :`);
      for (const r of records) {
        const target = String(r.content).slice(0, 44);
        console.log(`      ${String(r.type).padEnd(6)} ${r.name} → ${target}${r.proxied ? "  (proxifié)" : ""}`);
      }
    }
  }

  // --- 5. Le tunnel Cloudflare (Cloudflare → GCP) est-il lisible ? ---------
  console.log("\n5. Tunnels Cloudflare — GET /accounts/{id}/cfd_tunnel");
  if (!ACCOUNT_ID) {
    warnings.push(
      "Tunnels non vérifiés : CLOUDFLARE_ACCOUNT_ID absent. Le récupérer dans le dashboard " +
        "(vue d'ensemble du compte) pour contrôler le tunnel qui expose le conteneur GCP."
    );
  } else {
    const tun = await cf(`/accounts/${ACCOUNT_ID}/cfd_tunnel?is_deleted=false`);
    if (!tun.body?.success) {
      console.log(`   ⚠️  illisible — ${apiError(tun.body)}`);
      warnings.push(
        "Tunnels illisibles : accorder « Account → Cloudflare Tunnel → Read » au jeton — indispensable " +
          "pour diagnostiquer une coupure du site en production."
      );
    } else {
      const tunnels = tun.body.result ?? [];
      for (const t of tunnels) console.log(`   • ${t.name} — ${t.status} (id ${t.id})`);
      if (tunnels.length) console.log(`   ✅ ${tunnels.length} tunnel(s) listé(s)`);
      else warnings.push("Aucun tunnel sur ce compte : vérifier le service cloudflared du conteneur GCP.");
    }
  }
}

function report() {
  console.log(`\n${"─".repeat(66)}`);
  for (const w of warnings) console.log(`⚠️  ${wrap(w)}`);
  if (problems.length) {
    console.error(`❌ ${problems.length} problème(s) bloquant(s) :`);
    for (const p of problems) console.error(`   • ${wrap(p)}`);
    console.error(
      "\n   → Dashboard Cloudflare > My Profile > API Tokens > Create Token\n" +
        "     Droits recommandés : Zone → DNS → Edit ; Zone → Zone → Read ;\n" +
        "     Account → Cloudflare Tunnel → Read ; Account → Workers R2 Storage → Edit.\n" +
        "     Puis renseigner CLOUDFLARE_API_TOKEN dans .env et relancer npm run cf:verify."
    );
    process.exitCode = 1;
  } else {
    console.log("✅ Connexion Cloudflare opérationnelle.");
  }
}

try {
  await main();
} catch (err) {
  problems.push(
    `Appel à api.cloudflare.com impossible (${err?.message ?? err}) : vérifier la connexion réseau, ` +
      "un proxy ou un filtrage DNS."
  );
}
report();
