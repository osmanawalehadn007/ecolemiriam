import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { updateEmailStatusFromWebhook } from "@/lib/notifications/email-log";
import type { StatutEmail } from "@prisma/client";

/**
 * Vérifie la signature Svix d'un webhook Resend.
 * Format: HMAC-SHA256 sur `{svix-id}.{svix-timestamp}.{raw-body}`
 * En-tête svix-signature: `v1,base64signature v1,base64signature2 ...`
 *
 * Docs: https://resend.com/docs/webhooks/verify-webhooks-requests
 */
function verifySvixSignature(
  payload: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  secret: string
): boolean {
  // Le secret Svix commence par "whsec_" — il faut le décoder en base64
  const base64Secret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const decodedSecret = Buffer.from(base64Secret, "base64");

  // Construire le message signé
  const signedContent = `${svixId}.${svixTimestamp}.${payload}`;

  // Parcourir les signatures (format: "v1,sig1 v1,sig2 ...")
  const signatures = svixSignature
    .split(" ")
    .map((s) => s.startsWith("v1,") ? s.slice(3) : s)
    .filter(Boolean);

  // Vérifier le timestamp (tolérance de 5 minutes)
  const timestampMs = parseInt(svixTimestamp, 10) * 1000;
  const now = Date.now();
  if (isNaN(timestampMs) || Math.abs(now - timestampMs) > 5 * 60 * 1000) {
    return false;
  }

  for (const sig of signatures) {
    const expected = crypto
      .createHmac("sha256", decodedSecret)
      .update(signedContent, "utf8")
      .digest("base64");

    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return true;
    }
  }

  return false;
}

/**
 * POST /api/webhooks/resend
 * ============================================================
 * Reçoit les événements webhook de Resend (délivrance, rebond, échec, etc.)
 * et met à jour le statut des EmailLog correspondants.
 *
 * Sécurité : la signature Svix est vérifiée avec RESEND_WEBHOOK_SECRET.
 * Si le secret n'est pas configuré → on laisse passer (mode dev) avec un warning.
 *
 * Événements gérés :
 *   email.delivered       → DELIVERED
 *   email.bounced         → BOUNCED
 *   email.failed          → FAILED
 *   email.complained      → COMPLAINED
 *   email.opened          → OPENED
 *   email.delivery_delayed → DELIVERY_DELAYED
 *
 * Docs: https://resend.com/docs/webhooks/event-types
 */
export async function POST(request: NextRequest) {
  try {
    const payload = await request.text();
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.warn("[Resend Webhook] RESEND_WEBHOOK_SECRET absent — signature non vérifiée (dev)");
    } else {
      const svixId = request.headers.get("svix-id") ?? "";
      const svixTimestamp = request.headers.get("svix-timestamp") ?? "";
      const svixSignature = request.headers.get("svix-signature") ?? "";

      if (!svixId || !svixTimestamp || !svixSignature) {
        console.error("[Resend Webhook] En-têtes Svix manquants");
        return NextResponse.json({ error: "En-têtes manquants" }, { status: 401 });
      }

      const isValid = verifySvixSignature(payload, svixId, svixTimestamp, svixSignature, webhookSecret);
      if (!isValid) {
        console.error("[Resend Webhook] Signature invalide");
        return NextResponse.json({ error: "Signature invalide" }, { status: 401 });
      }
    }

    const event = JSON.parse(payload);
    const eventType: string = event.type ?? "";
    const data = event.data ?? {};

    // L'ID Resend de l'email — utilisé pour corréler avec l'EmailLog
    const resendEmailId: string | undefined = data.email_id;
    const recipients: string[] = data.to ?? [];
    const subject: string = data.subject ?? "";
    const bounceReason: string | undefined = data.bounce?.reason ?? data.error?.message;

    if (!resendEmailId) {
      console.warn("[Resend Webhook] Pas d'email_id dans l'événement:", eventType);
      return NextResponse.json({ ok: true });
    }

    // Mapper le type d'événement au statut EmailLog
    let status: StatutEmail | null = null;
    let errorMessage: string | undefined;

    switch (eventType) {
      case "email.delivered":
        status = "DELIVERED";
        break;
      case "email.bounced":
        status = "BOUNCED";
        errorMessage = bounceReason ?? "Email rejeté par le serveur de messagerie";
        break;
      case "email.failed":
        status = "FAILED";
        errorMessage = bounceReason ?? data.error?.message ?? "Échec d'envoi";
        break;
      case "email.complained":
        status = "COMPLAINED";
        break;
      case "email.opened":
        status = "OPENED";
        break;
      case "email.delivery_delayed":
        status = "DELIVERY_DELAYED";
        errorMessage = "Livraison retardée (problème temporaire)";
        break;
      default:
        // Événement non géré (email.clicked, email.scheduled, etc.)
        return NextResponse.json({ ok: true });
    }

    // Mettre à jour l'EmailLog
    await updateEmailStatusFromWebhook({
      resendEmailId,
      status,
      errorMessage,
      bounceReason: eventType === "email.bounced" ? bounceReason : undefined,
    });

    // Si l'email a rebondi ou échoué, on logge pour diagnostic
    if (status === "BOUNCED" || status === "FAILED") {
      console.warn(`[Resend Webhook] ${eventType} pour ${recipients.join(", ")} — ${subject}: ${errorMessage}`);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Resend Webhook] Erreur:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

/**
 * GET /api/webhooks/resend
 * Endpoint de vérification — confirme que le webhook est actif.
 */
export async function GET() {
  return NextResponse.json({ status: "École Miriam Resend webhook actif" });
}
