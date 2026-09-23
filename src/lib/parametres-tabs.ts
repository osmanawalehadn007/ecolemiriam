import { roleHasPermission, type Permission } from "@/lib/rbac";
import type { Role } from "@prisma/client";

/**
 * Onglets de l'écran Paramètres et permission qu'ils exigent.
 * ============================================================
 * Source unique de vérité : la page ne rend que les onglets autorisés par la
 * matrice RBAC, et les actions serveur refusent de toute façon une écriture
 * hors périmètre. `/parametres` n'est donc pas réservé « en bloc » à la
 * direction : chaque rôle voit les onglets de ses modules — le secrétariat
 * garde parents / classes / matières, un parent n'en voit aucun.
 *
 * Corollaire : ajouter un onglet côté `ParametresTabs` sans l'ajouter ici le
 * rend invisible à tous les rôles (la compilation le signale, le type étant
 * exhaustif).
 */
export type ParametresTab =
  | "etablissement"
  | "annees"
  | "utilisateurs"
  | "parents"
  | "classes"
  | "matieres"
  | "appreciations"
  | "periodes"
  | "signature"
  | "sites"
  | "tarifs"
  | "doublons";

export const PARAMETRES_TAB_PERMISSIONS: Record<ParametresTab, Permission> = {
  // Mentions officielles, identité, sites et années : le propriétaire.
  etablissement: "etablissement:write",
  annees: "etablissement:write",
  sites: "etablissement:write",
  signature: "etablissement:write",
  // Comptes utilisateurs : direction / chef d'établissement.
  utilisateurs: "enseignants:write",
  // Annuaires et données de référence : lecture suffisante, l'écriture est
  // refusée par les actions serveur si le rôle n'a pas le droit.
  parents: "parents:read",
  classes: "classes:read",
  matieres: "matieres:read",
  // Détection de doublons : écriture sur les élèves (fusion/archivage).
  doublons: "eleves:write",
  // Pilotage pédagogique : direction (voir décision `notes:manage`).
  appreciations: "notes:manage",
  periodes: "notes:manage",
  // Grille tarifaire : lecture finance.
  tarifs: "finance:read",
};

/** Onglets accessibles à un rôle, dans l'ordre d'affichage. */
export function allowedParametresTabs(role: Role): ParametresTab[] {
  return (
    Object.keys(PARAMETRES_TAB_PERMISSIONS) as ParametresTab[]
  ).filter((tab) => roleHasPermission(role, PARAMETRES_TAB_PERMISSIONS[tab]));
}