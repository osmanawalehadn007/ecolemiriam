/**
 * EcolPro / LEARNOS — Registre de handlers d'événements
 * =====================================================
 * Les handlers sont invoqués pour chaque événement du bus. Ils doivent être
 * idempotents et rapides ; les traitements lourds sont délégués à des workers
 * ou à des crons.
 */

import type { LearnosEventRecord } from "../events";

export type LearnosEventHandler = (event: LearnosEventRecord) => Promise<void>;

const handlers = new Map<string, LearnosEventHandler>();

export function registerHandler(eventType: string, handler: LearnosEventHandler): void {
  handlers.set(eventType, handler);
}

export function getHandler(eventType: string): LearnosEventHandler | undefined {
  return handlers.get(eventType);
}

export function getAllHandlers(): Array<[string, LearnosEventHandler]> {
  return Array.from(handlers.entries());
}

/**
 * Point d'entrée unique pour traiter un événement.
 * Appelle le handler correspondant s'il est enregistré.
 */
export async function dispatchEvent(event: LearnosEventRecord): Promise<void> {
  const handler = getHandler(event.eventType);
  if (!handler) return;
  await handler(event);
}

// Enregistrement des handlers par défaut.
import "./note-handler";
import "./absence-handler";
import "./bulletin-handler";
