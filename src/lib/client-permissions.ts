"use client";

import type { Role } from "@prisma/client";

/**
 * Vérifie une permission côté client.
 *
 * IMPORTANT : Cette fonction duplique la logique de roleHasPermission de
 * src/lib/rbac.ts car rbac.ts importe prisma.ts (node:async_hooks) qui
 * n'est pas disponible côté client (edge/webpack).
 *
 * La vérification côté client est purement cosmétique — la sécurité réelle
 * reste assurée par guardPage côté serveur et checkPermission dans les
 * API routes / server actions.
 *
 * @example
 * const canWrite = hasPermission(role, "eleves:write");
 * {canWrite && <Button>Ajouter</Button>}
 */

// Duplication de ROLE_PERMISSIONS — doit rester sync avec src/lib/rbac.ts
const CLIENT_ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: ["*"],
  TENANT_ADMIN: [
    "eleves:*", "parents:*", "enseignants:*", "classes:*", "matieres:*",
    "notes:*", "evaluations:*", "bulletins:*", "absences:*", "examens:*",
    "emploi-du-temps:*", "communication:*", "messages:*", "vie-scolaire:*",
    "admissions:*", "rh:*", "finance:*", "inventaire:*", "alumni:*",
    "orientation:*", "cours:*", "analytics:*", "rapports:*", "documents:*",
    "ai:*", "audit:read", "parametres:*", "structures:*",
    "cahier-texte:*", "export:full", "fournitures:*",
  ],
  PRINCIPAL: [
    "eleves:*", "parents:*", "enseignants:*", "classes:*", "matieres:*",
    "notes:*", "evaluations:*", "bulletins:*", "absences:*", "examens:*",
    "emploi-du-temps:*", "communication:*", "messages:*", "vie-scolaire:*",
    "admissions:*", "rh:read", "finance:read", "inventaire:*", "alumni:*",
    "orientation:*", "cours:*", "analytics:*", "rapports:*", "documents:*",
    "ai:*", "parametres:read", "structures:read",
    "cahier-texte:*", "fournitures:*",
  ],
  SECRETARY: [
    "eleves:*", "parents:*", "classes:read", "matieres:read",
    "absences:*", "emploi-du-temps:*", "communication:read", "communication:send",
    "messages:*", "admissions:*", "examens:read", "inventaire:read",
    "documents:*", "alumni:read", "bulletins:read", "rapports:read",
    "parametres:read", "structures:read", "cahier-texte:read",
    "fournitures:read", "fournitures:write", "fournitures:validate", "fournitures:publish",
  ],
  TEACHER: [
    "eleves:read", "classes:read", "matieres:read",
    "notes:*", "evaluations:*", "absences:read", "absences:write",
    "bulletins:read", "emploi-du-temps:read", "messages:*",
    "cours:*", "analytics:read", "examens:read", "ai:teacher",
    "cahier-texte:*", "fournitures:read", "fournitures:write",
  ],
  CLASS_TEACHER: [
    "eleves:read", "classes:read", "matieres:read",
    "notes:*", "evaluations:*", "absences:*",
    "bulletins:read", "bulletins:write", "bulletins:publish",
    "emploi-du-temps:read", "messages:*", "cours:*",
    "vie-scolaire:*", "orientation:read", "orientation:write",
    "analytics:read", "examens:read", "parents:read", "ai:teacher",
    "cahier-texte:*", "fournitures:read", "fournitures:write",
  ],
  COUNSELOR: [
    "eleves:read", "absences:read", "vie-scolaire:*", "orientation:*",
    "messages:*", "parents:read", "communication:read", "analytics:read",
    "emploi-du-temps:read", "emploi-du-temps:write", "cahier-texte:read",
  ],
  NURSE: [
    "eleves:read", "absences:read", "messages:read", "messages:write",
  ],
  ACCOUNTANT: [
    "finance:*", "rh:*", "eleves:read", "eleves:write", "parents:read",
    "inventaire:*", "analytics:read", "messages:*", "rapports:read",
    "admissions:read", "admissions:write",
    "parametres:read", "parametres:write",
  ],
  PARENT: [
    "bulletins:read", "absences:read", "notes:read", "messages:*",
    "communication:read", "cours:read", "orientation:read",
    "emploi-du-temps:read", "ai:parent", "fournitures:read",
  ],
  STUDENT: [
    "bulletins:read", "absences:read", "notes:read",
    "messages:read", "messages:reply",
    "communication:read", "cours:*", "emploi-du-temps:read",
    "fournitures:read",
  ],
};

export function hasPermission(role: string | undefined, permission: string): boolean {
  if (!role) return false;
  const perms = CLIENT_ROLE_PERMISSIONS[role] ?? [];
  if (perms.includes("*")) return true;
  if (perms.includes(permission)) return true;
  const moduleName = permission.split(":")[0];
  if (perms.includes(`${moduleName}:*`)) return true;
  return false;
}

export function hasAnyPermission(role: string | undefined, permissions: string[]): boolean {
  if (!role) return false;
  return permissions.some((p) => hasPermission(role, p));
}
