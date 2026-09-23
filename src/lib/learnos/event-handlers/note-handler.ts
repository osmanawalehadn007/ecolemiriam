/**
 * EcolPro / LEARNOS — Handler des événements de notes
 * ====================================================
 * Transforme une note créée/mise à jour en `LearnosEvidence` (preuve
 * d'apprentissage). Idempotent : une evidence par note (`noteId` unique
 * logique — un update de note met à jour l'evidence existante).
 */

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { registerHandler } from "./index";
import type { LearnosEventRecord } from "../events";

async function handleNote(event: LearnosEventRecord): Promise<void> {
  if (event.aggregateType !== "note") return;

  if (event.eventType === "note.deleted") {
    await prisma.learnosEvidence.deleteMany({
      where: { tenantId: event.tenantId, noteId: event.aggregateId },
    });
    return;
  }

  // note.created / note.updated — le payload porte les champs métier minimaux.
  const payload = event.payload as {
    eleveId?: string;
    matiereId?: string;
    valeur?: number;
    noteSur?: number;
    type?: string;
  };
  if (!payload.eleveId || !payload.matiereId) return;

  const existing = await prisma.learnosEvidence.findFirst({
    where: { tenantId: event.tenantId, noteId: event.aggregateId },
    select: { id: true },
  });

  const data = {
    siteId: event.siteId ?? null,
    eleveId: payload.eleveId,
    matiereId: payload.matiereId,
    rawData: payload as Prisma.InputJsonValue,
    confidence: 1,
    processedAt: new Date(),
  };

  if (existing) {
    await prisma.learnosEvidence.update({ where: { id: existing.id }, data });
  } else {
    await prisma.learnosEvidence.create({
      data: {
        tenantId: event.tenantId,
        ...data,
        type: "DEVOIR",
        source: "SYNC",
        noteId: event.aggregateId,
      },
    });
  }
}

registerHandler("note.created", handleNote);
registerHandler("note.updated", handleNote);
registerHandler("note.deleted", handleNote);
