/**
 * Qui peut figurer sur une dépense. Partagé entre le formulaire (listes
 * déroulantes) et l'action serveur (contrôle à l'enregistrement).
 */

/** « Autorisé par » : directeur d'établissement et principal. */
export const ROLES_AUTORISATION_DEPENSE = ["TENANT_ADMIN", "PRINCIPAL"] as const;

/**
 * « Émis / payé par » : le comptable. Il n'existe pas de rôle « caissier »
 * distinct : l'encaissement est assuré par le comptable (ACCOUNTANT).
 */
export const ROLES_EMISSION_DEPENSE = ["ACCOUNTANT"] as const;

export function peutAutoriserDepense(role: string): boolean {
  return (ROLES_AUTORISATION_DEPENSE as readonly string[]).includes(role);
}

export function peutEmettreDepense(role: string): boolean {
  return (ROLES_EMISSION_DEPENSE as readonly string[]).includes(role);
}
