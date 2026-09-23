/**
 * EcolPro / LEARNOS — Handler des événements de bulletins
 * ========================================================
 * Déclenché à la publication d'un bulletin. Placeholder idempotent :
 * l'analyse de période (tendances, insights) sera branchée ici.
 */

import { registerHandler } from "./index";
import type { LearnosEventRecord } from "../events";

async function handleBulletin(event: LearnosEventRecord): Promise<void> {
  if (event.aggregateType !== "bulletin") return;
  // TODO(A2 — Insights) : générer un LearnosInsight de synthèse trimestrielle.
  console.info(
    `[LEARNOS/bulletin-handler] ${event.eventType} ${event.aggregateId} (tenant=${event.tenantId})`
  );
}

registerHandler("bulletin.published", handleBulletin);
