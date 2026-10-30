/**
 * Lien de partage d'un bulletin (e-mail, WhatsApp).
 *
 * Le jeton est signé (HMAC-SHA256) et porte l'élève, la période, le tenant et
 * une date d'expiration : il ouvre une page publique en lecture seule, sans
 * compte, pour ce seul bulletin. Aucune donnée n'est lisible sans la signature.
 */
import { createHmac, timingSafeEqual } from "crypto";

export type PartageBulletin = { eleveId: string; periodeId: string; tenantId: string };

const DUREE_PAR_DEFAUT_JOURS = 60;

function secret(): string {
  const s = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET/NEXTAUTH_SECRET est requis pour signer un lien de bulletin");
  return s;
}

function signature(corps: string): Buffer {
  return createHmac("sha256", secret()).update(`bulletin-partage:${corps}`).digest();
}

export function signerLienBulletin(
  p: PartageBulletin,
  jours = DUREE_PAR_DEFAUT_JOURS,
  now = Date.now()
): string {
  const exp = Math.floor(now / 1000) + jours * 86400;
  const corps = Buffer.from(JSON.stringify({ e: p.eleveId, p: p.periodeId, t: p.tenantId, x: exp })).toString("base64url");
  return `${corps}.${signature(corps).toString("base64url")}`;
}

export function verifierLienBulletin(token: string, now = Date.now()): PartageBulletin | null {
  const [corps, sig] = token.split(".");
  if (!corps || !sig) return null;
  const attendu = signature(corps);
  let recu: Buffer;
  try {
    recu = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (recu.length !== attendu.length || !timingSafeEqual(recu, attendu)) return null;
  try {
    const d = JSON.parse(Buffer.from(corps, "base64url").toString("utf8"));
    if (typeof d.e !== "string" || typeof d.p !== "string" || typeof d.t !== "string" || typeof d.x !== "number") return null;
    if (d.x < Math.floor(now / 1000)) return null;
    return { eleveId: d.e, periodeId: d.p, tenantId: d.t };
  } catch {
    return null;
  }
}

export function urlLienBulletin(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? "http://localhost:3000";
  return `${base.replace(/\/+$/, "")}/bulletin-partage/${token}`;
}
