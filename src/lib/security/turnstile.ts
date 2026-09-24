/**
 * École Miriam — Cloudflare Turnstile (server-side siteverify)
 * ============================================================
 * Vérification canonique du token Turnstile côté serveur.
 *
 * Le widget Turnstile est intégré côté client sur les formulaires publics
 * (login, register, forgot-password). Le token `cf-turnstile-response` est
 * envoyé au serveur et vérifié ici via l'API siteverify de Cloudflare.
 *
 * Si `TURNSTILE_SECRET` n'est pas configuré, la vérification est ignorée
 * (mode dégradé) — utile en développement local. En production, le secret
 * DOIT être défini.
 *
 * @see https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */

import { getClientIP } from "@/lib/security/rateLimit";

export interface TurnstileVerifyResult {
  success: boolean;
  /** Code d'erreur retourné par Cloudflare en cas d'échec. */
  errorCodes?: string[];
  /** Action associée au widget (ex: "login", "register"). */
  action?: string;
  /** Nom du service (ex: "login"). */
  challengeTs?: string;
  /** Hostname du client qui a résolu le challenge. */
  hostname?: string;
  /** Si la vérification est désactivée (mode dégradé). */
  skipped?: boolean;
}

/**
 * Vérifie un token Turnstile côté serveur.
 *
 * @param token - Le token `cf-turnstile-response` envoyé par le widget client.
 * @param req - La requête entrante (pour extraire l'IP du client).
 * @returns Résultat de la vérification.
 */
export async function verifyTurnstileToken(
  token: string | null | undefined,
  req: Request
): Promise<TurnstileVerifyResult> {
  const secret = process.env.TURNSTILE_SECRET;

  // Mode dégradé : si le secret n'est pas configuré, on skip la vérification.
  // Utile en dev local. En production, TURNSTILE_SECRET DOIT être défini.
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[Turnstile] TURNSTILE_SECRET manquant en production — " +
          "la vérification est désactivée. Configurez le secret pour activer la protection anti-bot."
      );
    }
    return { success: true, skipped: true };
  }

  // Si pas de token, c'est que le widget n'a pas été résolu
  if (!token) {
    return { success: false, errorCodes: ["missing-input-response"] };
  }

  const clientIp = getClientIP(req as unknown as import("next/server").NextRequest);

  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret,
          response: token,
          remoteip: clientIp === "unknown" ? "" : clientIp,
        }),
      }
    );

    if (!res.ok) {
      console.error("[Turnstile] siteverify HTTP error:", res.status, res.statusText);
      // En cas d'erreur réseau côté Cloudflare, on fail-open pour ne pas
      // bloquer tous les utilisateurs. Le rate limiting reste actif.
      return { success: true, errorCodes: ["backend-error"] };
    }

    const data = (await res.json()) as {
      success: boolean;
      "error-codes"?: string[];
      action?: string;
      challenge_ts?: string;
      hostname?: string;
    };

    return {
      success: data.success,
      errorCodes: data["error-codes"],
      action: data.action,
      challengeTs: data.challenge_ts,
      hostname: data.hostname,
    };
  } catch (err) {
    console.error("[Turnstile] siteverify fetch error:", err);
    // Fail-open en cas d'erreur réseau — le rate limiting reste actif
    return { success: true, errorCodes: ["network-error"] };
  }
}

/**
 * Vérifie le token Turnstile et lance une erreur si invalide.
 * À utiliser dans les route handlers API.
 *
 * @throws {TurnstileError} si le token est invalide
 */
export class TurnstileError extends Error {
  constructor(message: string, public errorCodes: string[] = []) {
    super(message);
    this.name = "TurnstileError";
  }
}

/**
 * Vérifie le token Turnstile et lance une TurnstileError si invalide.
 * Mode dégradé : si TURNSTILE_SECRET n'est pas défini, ne fait rien.
 */
export async function assertTurnstile(
  token: string | null | undefined,
  req: Request
): Promise<void> {
  const result = await verifyTurnstileToken(token, req);
  if (!result.success) {
    throw new TurnstileError(
      "Vérification anti-bot échouée. Veuillez réessayer.",
      result.errorCodes ?? []
    );
  }
}
