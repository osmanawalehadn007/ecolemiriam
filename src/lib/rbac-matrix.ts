/**
 * EcolPro — Cœur PUR du RBAC (matrice + résolution de permission)
 * ==============================================================
 * Extrait de `rbac.ts` pour être importable depuis le bundle CLIENT
 * (`Sidebar` → `menu.ts`) : AUCUN import runtime (auth, audit, Prisma).
 * `rbac.ts` ré-exporte tout ce fichier : les imports existants vers
 * `@/lib/rbac` continuent de fonctionner sans modification.
 */

import type { Role } from "@prisma/client";

export type Permission = string;

// ------------------------------------------------------------
// Matrice des permissions par rôle
// ------------------------------------------------------------
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  // Plateforme EcolPro — accès total (y compris super-admin)
  SUPER_ADMIN: ["*"],

  // Directeur / Propriétaire de l'établissement — tout sauf l'administration plateforme
  TENANT_ADMIN: [
    "eleves:*", "parents:*", "enseignants:*", "classes:*", "matieres:*",
    "notes:*", "evaluations:*", "bulletins:*", "absences:*", "examens:*",
    "emploi-du-temps:*", "communication:*", "messages:*", "vie-scolaire:*",
    "admissions:*", "rh:*", "finance:*", "inventaire:*", "alumni:*",
    "orientation:*", "cours:*", "analytics:*", "rapports:*", "documents:*",
    // Mentions officielles de l'établissement (signature, cachet, nom du chef
    // d'établissement) : permission dédiée, réservée au propriétaire.
    "etablissement:write",
    "ai:*", "audit:read",
  ],

  // Chef d'établissement — pédagogie & vie scolaire complètes, pas la finance/RH en écriture
  PRINCIPAL: [
    "eleves:*", "parents:*", "enseignants:*", "classes:*", "matieres:*",
    "notes:*", "evaluations:*", "bulletins:*", "absences:*", "examens:*",
    "emploi-du-temps:*", "communication:*", "messages:*", "vie-scolaire:*",
    "admissions:*", "rh:read", "finance:read", "inventaire:*", "alumni:*",
    "orientation:*", "cours:*", "analytics:*", "rapports:*", "documents:*",
    "ai:*",
  ],

  // Secrétariat — gestion administrative
  SECRETARY: [
    "eleves:*", "parents:*", "classes:read", "matieres:read",
    "absences:*", "emploi-du-temps:*", "communication:read", "communication:send",
    "messages:*", "admissions:*", "examens:read", "inventaire:read",
    "documents:*", "alumni:read", "bulletins:read", "rapports:read",
    // Décision D1 (23/09/2026) : le guichet convoque les familles — la
    // `Sidebar` lui montrait déjà `/vie-scolaire`, mais sans permission le
    // `guardPage` le redirigeait et la création de convocation répondait 403.
    "vie-scolaire:read", "vie-scolaire:write",
    // Alignement menu ↔ matrice (audit § 8 P2) : la `Sidebar` affichait
    // `/evaluations` (onglet « examens ») et `/cours` à tous les rôles ; le
    // secrétariat était donc redirigé faute de permission de lecture.
    "evaluations:read", "cours:read",
  ],

  // Enseignant — sa pédagogie
  TEACHER: [
    "eleves:read", "classes:read", "matieres:read",
    // `notes:manage` — ouverture/clôture des périodes et règles d'appréciation —
    // n'est PAS accordé aux enseignants : ils saisissent des notes
    // (`notes:read` / `notes:write`), la direction pilote le calendrier
    // (`notes:*` porte implicitement `notes:manage`).
    "notes:read", "notes:write", "evaluations:*", "absences:read", "absences:write",
    "bulletins:read", "emploi-du-temps:read", "messages:*",
    "cours:*", "analytics:read", "examens:read", "ai:teacher",
    // Annuaires des familles de SES élèves : la page `/parents` applique
    // `teacherParentFilter` (les familles de ses classes). La `Sidebar`
    // affichait l'entrée aux enseignants sans accorder la permission.
    "parents:read",
  ],

  // Professeur principal — enseignant + bulletins/conseil + vie scolaire
  CLASS_TEACHER: [
    "eleves:read", "classes:read", "matieres:read",
    // Comme `TEACHER` : saisie des notes, pas le pilotage des périodes
    // (`notes:manage`) ni des règles d'appréciation.
    "notes:read", "notes:write", "evaluations:*", "absences:*",
    // Décision A1 (23/09/2026) : `bulletins:publish` est retiré du professeur
    // principal. Publier rend le bulletin visible des familles et fige les
    // résultats : c'est l'acte final de la période, réservé à la direction.
    // Le PP garde la saisie, l'édition et le conseil de classe (`bulletins:write`).
    "bulletins:read", "bulletins:write",
    "emploi-du-temps:read", "messages:*", "cours:*",
    "vie-scolaire:*", "orientation:read", "orientation:write",
    "analytics:read", "examens:read", "parents:read", "ai:teacher",
  ],

  // Conseiller / CPE — vie scolaire & orientation
  COUNSELOR: [
    "eleves:read", "absences:read", "vie-scolaire:*", "orientation:*",
    "messages:*", "parents:read", "communication:read", "analytics:read",
    // Alignement menu ↔ matrice : la `Sidebar` affichait `/cours` et
    // `/emploi-du-temps` à tous les rôles.
    "cours:read", "emploi-du-temps:read",
  ],

  // Infirmier(e) — consultation santé/élèves
  NURSE: [
    "eleves:read", "absences:read", "messages:read", "messages:write",
    // Alignement menu ↔ matrice : consultable (lecture seule), non sensible.
    "cours:read", "emploi-du-temps:read",
  ],

  // Comptable — finance, lecture RH et génération des bulletins de paie.
  // Décision B1 (23/09/2026) : `rh:*` donnait l'écriture sur les fiches RH
  // (salaire, tarif horaire, RIB, contrat), les absences et les congés. Un rôle
  // qui modifie le RIB du bénéficiaire **et** génère le paiement concentre les
  // deux moitiés du contrôle : il ne garde que `rh:read` + `paie:write`, la
  // génération du bulletin étant couverte par `POST /api/rh/[id]`.
  ACCOUNTANT: [
    "finance:*", "rh:read", "paie:write", "eleves:read", "parents:read",
    "inventaire:*", "analytics:read", "messages:*", "rapports:read",
    // Alignement menu ↔ matrice : consultable (lecture seule), non sensible.
    "cours:read", "emploi-du-temps:read",
  ],

  // Parent — consultation de son périmètre (lecture seule + messagerie)
  PARENT: [
    "bulletins:read", "absences:read", "notes:read", "messages:*",
    "communication:read", "cours:read", "orientation:read",
    "emploi-du-temps:read", "ai:parent",
  ],

  // Élève — consultation de son périmètre (lecture seule + messagerie limitée)
  // Un élève peut lire et répondre dans une conversation où il est déjà participant,
  // mais ne peut pas initier de nouvelle conversation (règle École360).
  STUDENT: [
    "bulletins:read", "absences:read", "notes:read",
    "messages:read", "messages:reply",
    "communication:read", "cours:read", "emploi-du-temps:read",
  ],
};

// ------------------------------------------------------------
// Vérification de permission
// ------------------------------------------------------------
export function roleHasPermission(role: Role, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role] ?? [];
  if (perms.includes("*")) return true;
  if (perms.includes(permission)) return true;
  const moduleName = permission.split(":")[0];
  if (perms.includes(`${moduleName}:*`)) return true;
  return false;
}