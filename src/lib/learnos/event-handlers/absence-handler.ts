/**
 * EcolPro / LEARNOS — Handler des événements d'absences
 * ======================================================
 * Placeholder idempotent : les absences alimenteront le Student Twin
 * (assiduité). Pour l'instant, on trace la réception sans traitement lourd.
 */

import { registerHandler } from "./index";
import type { LearnosEventRecord } from "../events";

async function handleAbsence(event: LearnosEventRecord): Promise<void> {
  if (event.aggregateType !== "absence") return;
  // TODO(A2 — Student Twin) : agréger l'assiduité par élève/période.
  console.info(
    `[LEARNOS/absence-handler] ${event.eventType} ${event.aggregateId} (tenant=${event.tenantId})`
  );
}

registerHandler("absence.created", handleAbsence);
registerHandler("absence.updated", handleAbsence);
registerHandler("absence.deleted", handleAbsence);
