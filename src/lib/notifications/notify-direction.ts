/**
 * École Miriam — Notification automatique de la direction
 * ============================================================
 * Helper pour alerter le directeur (TENANT_ADMIN) et le chef
 * d'établissement (PRINCIPAL) lors des étapes clés du workflow
 * d'admissions et de réinscription effectuées par le comptable.
 *
 * Crée une notification IN_APP (visible dans l'app) et tente
 * l'envoi email si les adresses sont disponibles.
 */

import prisma from "@/lib/prisma";
import { dispatchNotification } from "./dispatch";

export interface NotifyDirectionParams {
  tenantId: string;
  titre: string;
  contenu: string;
  envoyeParId?: string;
  siteId?: string | null;
}

/**
 * Crée et dispatche une notification IN_APP vers la direction
 * (TENANT_ADMIN + PRINCIPAL) du tenant.
 *
 * Ne lève jamais d'erreur : les notifications sont best-effort.
 * En cas d'échec, l'erreur est loggée mais le flux métier continue.
 */
export async function notifyDirection({
  tenantId,
  titre,
  contenu,
  envoyeParId,
  siteId = null,
}: NotifyDirectionParams): Promise<void> {
  try {
    const notif = await prisma.notification.create({
      data: {
        tenantId,
        siteId,
        titre,
        contenu,
        canal: "IN_APP",
        cible: "DIRECTION",
        statut: "EN_ENVOI",
        envoyeParId: envoyeParId ?? null,
      },
    });

    // Dispatcher immédiatement (IN_APP = juste marquer comme envoyée)
    await dispatchNotification(notif.id, tenantId);
  } catch (err) {
    // Best-effort : ne pas casser le flux métier si la notification échoue
    console.error("[notifyDirection] Échec de la notification:", err);
  }
}
