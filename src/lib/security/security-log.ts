/**
 * École Miriam — Logging de sécurité centralisé (OWASP A09)
 * ============================================================
 *
 * Centralise les événements de sécurité : lockouts, CSRF 403, Turnstile
 * échoués, RLS refus, blocages anti-bot, 2FA. Chaque événement est :
 *   1. Loggé en console avec un format structuré `[SECURITY] {type} …`
 *      → visible dans les logs Docker, capturable par un agrégateur.
 *   2. Écrit dans la table AuditLog via auditFire() (non-bloquant).
 *
 * Le but : permettre la détection d'attaques en production. Sans logs
 * centralisés, un attaquant qui ratisse les endpoints reste invisible.
 */

import { auditFire } from "@/lib/audit";

export type SecurityEventType =
  | "bot_block"
  | "rate_limit_block"
  | "csrf_reject"
  | "login_lockout"
  | "login_failure"
  | "turnstile_fail"
  | "turnstile_missing"
  | "rls_denied"
  | "rls_no_context"
  | "mfa_setup_required_redirect"
  | "mfa_code_invalid"
  | "csp_violation"
  | "unauthorized_access";

export interface SecurityLogParams {
  /** Type d'événement (détermine le préfixe de log). */
  type: SecurityEventType;
  /** IP du client (si connue). */
  ip?: string;
  /** ID utilisateur (si authentifié). */
  userId?: string;
  /** Pathname concerné. */
  pathname?: string;
  /** Détails supplémentaires (ne pas inclure de secrets). */
  metadata?: Record<string, unknown>;
}

/**
 * Journalise un événement de sécurité.
 *
 * Écrit en console (structuré, toujours) ET dans la table AuditLog
 * (fire-and-forget, non-bloquant). Ne lève JAMAIS d'exception.
 */
export function securityLog(params: SecurityLogParams): void {
  const { type, ip, userId, pathname, metadata } = params;

  // ── Console structuré ────────────────────────────────────────────────
  // Format compact, parsable, avec un préfixe `[SECURITY]` pour filtrage.
  const details = [
    ip && `ip=${ip}`,
    userId && `user=${userId}`,
    pathname && `path=${pathname}`,
    metadata && Object.entries(metadata)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" "),
  ]
    .filter(Boolean)
    .join(" ");

  console.warn(`[SECURITY] ${type} ${details}`);

  // ── AuditLog en base (fire-and-forget) ───────────────────────────────
  auditFire({
    userId: userId ?? null,
    action: `security:${type}`,
    verdict: "DENIED",
    resource: "security",
    reason: type,
    metadata: { ip, pathname, ...metadata },
  });
}
