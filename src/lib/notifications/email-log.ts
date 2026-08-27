/**
 * École Miriam — Journal des emails transactionnels
 * ============================================================
 * Crée et met à jour les enregistrements EmailLog pour tracer
 * le statut de chaque email envoyé (envoi, délivrance, rebond, échec).
 */

import prismaBase from "@/lib/prisma-base";
import type { TypeEmail, StatutEmail } from "@prisma/client";

/**
 * Crée un enregistrement EmailLog avant l'envoi (statut PENDING).
 */
export async function createEmailLog(params: {
  tenantId?: string | null;
  userId?: string | null;
  email: string;
  type: TypeEmail;
  subject: string;
  createdBy?: string | null;
  tags?: Record<string, string>;
}): Promise<string> {
  const log = await prismaBase.emailLog.create({
    data: {
      tenantId: params.tenantId ?? null,
      userId: params.userId ?? null,
      email: params.email,
      type: params.type,
      subject: params.subject,
      status: "PENDING",
      createdBy: params.createdBy ?? null,
      tags: params.tags ?? undefined,
    },
    select: { id: true },
  });
  return log.id;
}

/**
 * Marque un EmailLog comme envoyé avec l'ID Resend pour corrélation webhook.
 */
export async function markEmailSent(
  logId: string,
  resendEmailId: string | null
): Promise<void> {
  await prismaBase.emailLog.update({
    where: { id: logId },
    data: {
      status: "SENT",
      resendEmailId,
      sentAt: new Date(),
    },
  });
}

/**
 * Marque un EmailLog comme échoué avec le message d'erreur.
 */
export async function markEmailFailed(
  logId: string,
  errorMessage: string
): Promise<void> {
  await prismaBase.emailLog.update({
    where: { id: logId },
    data: {
      status: "FAILED",
      errorMessage,
    },
  });
}

/**
 * Met à jour le statut d'un EmailLog à partir d'un événement webhook Resend.
 * Recherche par resendEmailId (priorité) ou par logId.
 */
export async function updateEmailStatusFromWebhook(params: {
  resendEmailId?: string;
  logId?: string;
  status: StatutEmail;
  errorMessage?: string;
  bounceReason?: string;
}): Promise<void> {
  const where = params.resendEmailId
    ? { resendEmailId: params.resendEmailId }
    : params.logId
    ? { id: params.logId }
    : null;

  if (!where) return;

  const data: Record<string, unknown> = {
    status: params.status,
    ...(params.errorMessage ? { errorMessage: params.errorMessage } : {}),
    ...(params.bounceReason ? { bounceReason: params.bounceReason } : {}),
  };

  // Horodatage selon le statut
  const now = new Date();
  switch (params.status) {
    case "DELIVERED":
      data.deliveredAt = now;
      break;
    case "BOUNCED":
      data.bouncedAt = now;
      break;
    case "OPENED":
      data.openedAt = now;
      break;
    case "COMPLAINED":
      data.complainedAt = now;
      break;
  }

  try {
    await prismaBase.emailLog.updateMany({ where, data });
  } catch (err) {
    console.error("[EmailLog] Erreur mise à jour webhook:", err);
  }
}

/**
 * Récupère le dernier statut d'email pour un utilisateur donné.
 * Utile pour afficher un badge dans l'UI.
 */
export async function getLatestEmailStatusForUser(
  userId: string
): Promise<{ status: StatutEmail; type: TypeEmail; createdAt: Date } | null> {
  const log = await prismaBase.emailLog.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { status: true, type: true, createdAt: true },
  });
  return log;
}
