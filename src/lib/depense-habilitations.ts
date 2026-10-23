/**
 * Habilitations sur une dépense : qui AUTORISE, qui PAIE
 * =====================================================
 *
 * Source UNIQUE, volontairement sans dépendance serveur : le même référentiel
 * alimente les menus déroulants de l'écran Finances (« Autorisé par » et
 * « Payé par », composant client) et la server action `createDepense`. Deux
 * listes séparées finiraient par diverger — le menu proposerait des personnes
 * que le serveur refuse, ou l'inverse.
 *
 * Correspondance avec les libellés de l'interface (src/i18n/fr.json → roles) :
 *   TENANT_ADMIN = « Directeur »            → responsable d'établissement
 *   PRINCIPAL    = « Chef d'établissement » → principal
 *   ACCOUNTANT   = « Comptable »            → comptable / caissier
 *
 * Le référentiel des PAYEURS se limite à ACCOUNTANT : dans cette application,
 * c'est le seul rôle qui porte `finance:*` en dehors de la direction (le
 * secrétariat n'a aucune permission finance — cf. ROLE_PERMISSIONS dans rbac).
 * Il n'existe pas de rôle `CAISSIER` : « caissier » et « comptable » désignent
 * donc le même rôle. Pour y ajouter le directeur, compléter la liste ci-dessous.
 *
 * SUPER_ADMIN est volontairement absent : l'équipe plateforme n'engage ni ne
 * paie les dépenses d'un établissement.
 *
 * Ne pas confondre avec `finance:write` (rbac) : ce droit permet de SAISIR une
 * dépense ; les présentes listes désignent qui peut FIGURER comme auteur de son
 * autorisation et comme auteur de son paiement.
 *
 * Les mêmes règles sont posées EN BASE par
 * `prisma/migration_habilitations_depenses.sql` (triggers sur
 * `depenses."autoriseParId"` et `depenses."payeParId"`), pour qu'un client SQL
 * direct ne les contourne pas.
 */

export const ROLES_AUTORISATEURS_DEPENSE = ["TENANT_ADMIN", "PRINCIPAL"] as const;

export const ROLES_PAYEURS_DEPENSE = ["ACCOUNTANT"] as const;

/**
 * `true` si ce rôle peut être désigné comme auteur d'une autorisation de
 * dépense. Accepte une valeur brute (`string`) : les rôles viennent tantôt du
 * type `Role` de Prisma, tantôt de la session ou d'un formulaire sérialisé.
 */
export function peutAutoriserDepense(role: string | null | undefined): boolean {
  return ROLES_AUTORISATEURS_DEPENSE.some((r) => r === role);
}

/** `true` si ce rôle peut être désigné comme auteur du paiement d'une dépense. */
export function peutPayerDepense(role: string | null | undefined): boolean {
  return ROLES_PAYEURS_DEPENSE.some((r) => r === role);
}

/** Messages d'erreur uniques, partagés par la server action et les tests. */
export const MESSAGE_AUTORISATEUR_REFUSE =
  "Ce compte ne peut pas autoriser une dépense. Seuls le responsable d'établissement " +
  "(TENANT_ADMIN) et le chef d'établissement (PRINCIPAL) sont habilités.";

export const MESSAGE_PAYEUR_REFUSE =
  "Ce compte ne peut pas payer une dépense. Seul le comptable (ACCOUNTANT) est habilité.";
