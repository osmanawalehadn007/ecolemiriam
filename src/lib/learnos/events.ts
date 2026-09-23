/**
 * EcolPro / LEARNOS — Event Bus
 * ==============================
 * Double écriture :
 *   1. Table `LearnosEvent` (persistance, audit, rejeu)
 *   2. Redis/Upstash stream `learnos:events` (temps réel, workers)
 *
 * Les événements sont immutables et tracent les changements métier qui
 * alimentent les moteurs LEARNOS.
 */

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { Redis } from "@upstash/redis";

const STREAM_KEY = "learnos:events";

export type LearnosEventType =
  | "note.created"
  | "note.updated"
  | "note.deleted"
  | "absence.created"
  | "absence.updated"
  | "absence.deleted"
  | "evaluation.created"
  | "evaluation.updated"
  | "evaluation.deleted"
  | "examen.created"
  | "examen.updated"
  | "examen.deleted"
  | "bulletin.published"
  | "ocr.completed"
  | "evidence.processed"
  | "twin.updated"
  | "diagnostic.generated"
  | "intervention.proposed"
  | "intervention.approved"
  | "intervention.completed";

export interface LearnosEventPayload {
  [key: string]: unknown;
}

export interface LearnosEventInput {
  tenantId: string;
  siteId?: string | null;
  aggregateType: string;
  aggregateId: string;
  eventType: LearnosEventType;
  payload: LearnosEventPayload;
}

export interface LearnosEventRecord extends LearnosEventInput {
  id: string;
  occurredAt: Date;
}

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/**
 * Émet un événement métier dans le bus.
 * Écrit dans la table et, si Redis est disponible, dans le stream.
 */
export async function emitLearnosEvent(input: LearnosEventInput): Promise<LearnosEventRecord> {
  const record = await prisma.learnosEvent.create({
    data: {
      tenantId: input.tenantId,
      siteId: input.siteId ?? null,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      payload: input.payload as Prisma.InputJsonValue,
    },
  });

  const redis = getRedis();
  if (redis) {
    try {
      await redis.xadd(STREAM_KEY, "*", {
        id: record.id,
        tenantId: record.tenantId,
        siteId: record.siteId ?? "",
        aggregateType: record.aggregateType,
        aggregateId: record.aggregateId,
        eventType: record.eventType,
        payload: JSON.stringify(record.payload),
        occurredAt: record.occurredAt.toISOString(),
      });
    } catch (error) {
      // Ne pas faire échouer l'opération métier si Redis est indisponible.
      console.error("[LEARNOS/EventBus] Redis publish failed", error);
    }
  }

  return {
    ...record,
    eventType: record.eventType as LearnosEventType,
    payload: (record.payload ?? {}) as LearnosEventPayload,
  };
}

/**
 * Émet un événement depuis un objet Prisma typé.
 * Utilisé par les middlewares Prisma pour un mode zero-change.
 */
export async function emitFromPrismaChange(
  aggregateType: string,
  aggregateId: string,
  tenantId: string,
  siteId: string | null | undefined,
  eventType: LearnosEventType,
  payload: LearnosEventPayload = {}
): Promise<void> {
  await emitLearnosEvent({
    tenantId,
    siteId: siteId ?? null,
    aggregateType,
    aggregateId,
    eventType,
    payload,
  });
}
