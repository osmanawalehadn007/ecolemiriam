/**
 * Menu dérivé de la matrice RBAC
 * ============================================================
 * Chaque entrée de la `Sidebar` déclare la permission de **lecture** de son
 * module. L'entrée n'est affichée que si le rôle la détient — la même matrice
 * décide du menu et des gardes serveur, donc plus de divergence « lien visible
 * mais redirection ».
 *
 * Cas particuliers :
 *  - `/dashboard`   → tout rôle authentifié ;
 *  - `/super-admin` → filtré séparément (`isSuperAdmin`) ;
 *  - `/mes-factures` → écran famille : familles (bornées à leurs enfants) et
 *    rôles finance.
 *
 * `staffOnly` marque les écrans de personnel dont les requêtes ne peuvent pas
 * être bornées à un élève (listes nominatives, grilles de saisie) : les rôles à
 * périmètre personnel (`PARENT`, `STUDENT`) ne les voient pas, même s'ils
 * détiennent la permission de lecture du module.
 */
import { roleHasPermission, type Permission } from "@/lib/rbac-matrix";
import { isRelationScopedRole } from "@/lib/site-scope";
import type { Role } from "@prisma/client";

export interface MenuPermission {
  permission: Permission;
  /** Masque l'entrée aux rôles à périmètre personnel (PARENT / STUDENT). */
  staffOnly?: boolean;
}

export const MENU_PERMISSIONS: Record<string, MenuPermission> = {
  "/eleves": { permission: "eleves:read" },
  "/notes": { permission: "notes:read", staffOnly: true },
  "/evaluations": { permission: "evaluations:read" },
  "/cours": { permission: "cours:read" },
  "/emploi-du-temps": { permission: "emploi-du-temps:read" },
  "/absences": { permission: "absences:read", staffOnly: true },
  "/vie-scolaire": { permission: "vie-scolaire:read", staffOnly: true },
  "/parents": { permission: "parents:read", staffOnly: true },
  "/admissions": { permission: "admissions:read", staffOnly: true },
  "/facturation": { permission: "finance:read", staffOnly: true },
  "/mes-factures": { permission: "eleves:read" },
  "/rh": { permission: "rh:read", staffOnly: true },
  "/inventaire": { permission: "inventaire:read", staffOnly: true },
  "/messages": { permission: "messages:read" },
  "/communication": { permission: "communication:read", staffOnly: true },
  "/rapports": { permission: "rapports:read", staffOnly: true },
  "/analytics": { permission: "analytics:read", staffOnly: true },
  "/orientation": { permission: "orientation:read" },
  "/alumni": { permission: "alumni:read", staffOnly: true },
};

/**
 * L'entrée est-elle visible pour ce rôle ?
 * `/mes-factures` est visible des familles **et** des rôles finance.
 */
export function isMenuItemVisible(href: string, role: Role): boolean {
  if (href === "/dashboard") return true;
  const entry = MENU_PERMISSIONS[href];
  if (!entry) return false;

  if (href === "/mes-factures") {
    return isRelationScopedRole(role) || roleHasPermission(role, "finance:read");
  }

  if (entry.staffOnly && isRelationScopedRole(role)) return false;
  return roleHasPermission(role, entry.permission);
}