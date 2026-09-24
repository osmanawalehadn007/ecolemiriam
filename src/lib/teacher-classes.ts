import { runWithRlsBatch } from "@/lib/prisma";
import { cached, cacheDel, cacheKey } from "@/lib/redis";
import type { Role } from "@prisma/client";

const TEACHER_ROLES: Role[] = ["TEACHER", "CLASS_TEACHER"];

/**
 * Détermine si un rôle est un rôle d'enseignant restreint à ses classes.
 */
export function isTeacherRole(role: Role): boolean {
  return TEACHER_ROLES.includes(role);
}

/**
 * Valeur impossible : un enseignant sans périmètre résolu ne doit RIEN voir.
 * (Fail-closed — jamais de repli sur « tout le tenant ».)
 */
const NO_TEACHER_SCOPE_ID = "__ecolpro_no_teacher_scope__";

/**
 * Revendications minimales nécessaires à la résolution du périmètre.
 * Accepte indifféremment `session.user` (champ `id`) ou des claims construits
 * à la main (champ `userId`).
 */
export interface TeacherScopeClaims {
  tenantId?: string | null;
  role?: string | null;
  id?: string;
  userId?: string;
}

/**
 * Résout le périmètre enseignant depuis des revendications de session.
 *
 * Contrairement à `getTeacherScope`, ne lève jamais : si l'identité est
 * incomplète, renvoie un périmètre NON restreint (comportement des rôles
 * administratifs) — la restriction de site reste appliquée par l'appelant.
 */
export async function resolveTeacherScope(claims: TeacherScopeClaims): Promise<{
  classeIds: string[];
  matiereIds: string[];
  isRestricted: boolean;
}> {
  const userId = claims.userId ?? claims.id;
  if (!claims.tenantId || !userId || !claims.role) {
    return { classeIds: [], matiereIds: [], isRestricted: false };
  }
  const role = claims.role as Role;
  if (!isTeacherRole(role)) {
    return { classeIds: [], matiereIds: [], isRestricted: false };
  }
  return getTeacherScope(claims.tenantId, userId, role);
}

/**
 * Récupère les IDs des classes attribuées à un enseignant
 * (via l'emploi du temps et/ou le rôle de prof principal).
 *
 * Retourne également les IDs des matières qu'il enseigne.
 *
 * CACHE: Redis (2 minutes, partagé entre instances blue/green).
 */
export async function getTeacherScope(
  tenantId: string,
  userId: string,
  role: Role
): Promise<{
  classeIds: string[];
  matiereIds: string[];
  isRestricted: boolean;
}> {
  if (!isTeacherRole(role)) {
    return { classeIds: [], matiereIds: [], isRestricted: false };
  }

  return cached(
    cacheKey(tenantId, "teacher-scope", userId),
    () => runWithRlsBatch(tenantId, null, async (tx) => {
       
      const enseignant = await tx.enseignant.findFirst({
        where: { userId, tenantId },
        select: { id: true },
      });

      if (!enseignant) {
        return { classeIds: [], matiereIds: [], isRestricted: true };
      }

       
      const [emploiEntries, principalClasses, affectations, matieres] = await Promise.all([
        tx.emploiTemps.findMany({
          where: { enseignantId: enseignant.id, tenantId },
          select: { classeId: true, matiereId: true },
          distinct: ["classeId", "matiereId"],
        }),
        tx.classe.findMany({
          where: { profPrincipalId: enseignant.id, tenantId },
          select: { id: true },
        }),
        // Nouveau : affectations explicites via EnseignantAffectation
        tx.enseignantAffectation.findMany({
          where: { enseignantId: enseignant.id, tenantId },
          select: { classeId: true, matiereId: true },
        }),
        // Nouveau : matières liées via EnseignantMatiere
        tx.enseignantMatiere.findMany({
          where: { enseignantId: enseignant.id, tenantId },
          select: { matiereId: true },
        }),
      ]);
       

      const classeIds = Array.from(
        new Set([
          ...emploiEntries.map((e) => e.classeId),
          ...principalClasses.map((c) => c.id),
          ...affectations.map((a) => a.classeId),
        ])
      );

      const matiereIds = Array.from(
        new Set([
          ...emploiEntries.map((e) => e.matiereId).filter(Boolean) as string[],
          ...affectations.map((a) => a.matiereId).filter(Boolean) as string[],
          ...matieres.map((m) => m.matiereId),
        ])
      );

      return { classeIds, matiereIds, isRestricted: true };
    }),
    120 // 2 minutes
  );
}

/**
 * Invalide le cache du scope enseignant pour un utilisateur.
 */
export async function invalidateTeacherScope(
  tenantId: string,
  userId: string
): Promise<void> {
  await cacheDel(cacheKey(tenantId, "teacher-scope", userId));
}

// ------------------------------------------------------------
// Fragments `where` prêts à l'emploi (gardes serveur)
// ------------------------------------------------------------
//
// Tous renvoient un fragment dont la clé racine est `AND` : combiné via
// `mergeFilters`, il ne peut jamais écraser un `OR` de premier niveau placé
// par l'appelant (règle n° 2 de `site-scope.ts`). À brancher SYSTÉMATIQUEMENT
// en plus du filtre de site — jamais à la place.
//
// Pour un rôle non enseignant, le fragment est vide : la restriction de site
// (et le cas échéant le périmètre personnel parent/élève) reste seule juge.

/** Pour une requête sur `Eleve` : borné aux classes de l'enseignant. */
export async function teacherEleveFilter(
  claims: TeacherScopeClaims
): Promise<Record<string, unknown>> {
  const scope = await resolveTeacherScope(claims);
  if (!scope.isRestricted) return {};
  return {
    AND: [
      {
        classeId: {
          in: scope.classeIds.length > 0 ? scope.classeIds : [NO_TEACHER_SCOPE_ID],
        },
      },
    ],
  };
}

/** Pour une requête sur `Classe` : borné aux classes de l'enseignant. */
export async function teacherClasseFilter(
  claims: TeacherScopeClaims
): Promise<Record<string, unknown>> {
  const scope = await resolveTeacherScope(claims);
  if (!scope.isRestricted) return {};
  return {
    AND: [
      { id: { in: scope.classeIds.length > 0 ? scope.classeIds : [NO_TEACHER_SCOPE_ID] } },
    ],
  };
}

/** Pour une requête sur `Matiere` : borné aux matières de l'enseignant. */
export async function teacherMatiereFilter(
  claims: TeacherScopeClaims
): Promise<Record<string, unknown>> {
  const scope = await resolveTeacherScope(claims);
  if (!scope.isRestricted) return {};
  return {
    AND: [
      { id: { in: scope.matiereIds.length > 0 ? scope.matiereIds : [NO_TEACHER_SCOPE_ID] } },
    ],
  };
}

/**
 * Pour un modèle rattaché à `Eleve` par la relation `eleve` (Absence, Incident,
 * Bulletin…) : borné aux élèves des classes de l'enseignant.
 */
export async function teacherEleveRelationFilter(
  claims: TeacherScopeClaims,
  relation = "eleve"
): Promise<Record<string, unknown>> {
  const scope = await resolveTeacherScope(claims);
  if (!scope.isRestricted) return {};
  return {
    AND: [
      {
        [relation]: {
          classeId: {
            in: scope.classeIds.length > 0 ? scope.classeIds : [NO_TEACHER_SCOPE_ID],
          },
        },
      },
    ],
  };
}

/** Pour une requête sur `Note` (porte `classeId` ET `matiereId`). */
export async function teacherNoteFilter(
  claims: TeacherScopeClaims
): Promise<Record<string, unknown>> {
  const scope = await resolveTeacherScope(claims);
  if (!scope.isRestricted) return {};
  return {
    AND: [
      {
        classeId: {
          in: scope.classeIds.length > 0 ? scope.classeIds : [NO_TEACHER_SCOPE_ID],
        },
      },
      {
        matiereId: {
          in: scope.matiereIds.length > 0 ? scope.matiereIds : [NO_TEACHER_SCOPE_ID],
        },
      },
    ],
  };
}

/** Pour une requête sur `Evaluation` (porte `classeId` ET `matiereId`). */
export async function teacherEvaluationFilter(
  claims: TeacherScopeClaims
): Promise<Record<string, unknown>> {
  const scope = await resolveTeacherScope(claims);
  if (!scope.isRestricted) return {};
  return {
    AND: [
      {
        classeId: {
          in: scope.classeIds.length > 0 ? scope.classeIds : [NO_TEACHER_SCOPE_ID],
        },
      },
      {
        matiereId: {
          in: scope.matiereIds.length > 0 ? scope.matiereIds : [NO_TEACHER_SCOPE_ID],
        },
      },
    ],
  };
}

/** Pour une requête sur `Parent` : familles dont un enfant est dans une de ses classes. */
export async function teacherParentFilter(
  claims: TeacherScopeClaims
): Promise<Record<string, unknown>> {
  const scope = await resolveTeacherScope(claims);
  if (!scope.isRestricted) return {};
  return {
    AND: [
      {
        enfants: {
          some: {
            eleve: {
              classeId: {
                in: scope.classeIds.length > 0 ? scope.classeIds : [NO_TEACHER_SCOPE_ID],
              },
            },
          },
        },
      },
    ],
  };
}

/**
 * Résout l'identifiant de la fiche `Enseignant` associée aux revendications.
 * Renvoie `null` si l'utilisateur n'a pas de fiche enseignant.
 */
async function resolveEnseignantId(
  claims: TeacherScopeClaims
): Promise<string | null> {
  const userId = claims.userId ?? claims.id;
  if (!claims.tenantId || !userId) return null;
  // eslint-disable-next-line ecolpro/require-site-filter -- fiche de l'utilisateur CONNECTÉ lui-même (userId = soi) ; la portée est ensuite bornée par son propre `enseignantId`
  const enseignant = await prisma.enseignant.findFirst({
    where: { userId, tenantId: claims.tenantId },
    select: { id: true },
  });
  return enseignant?.id ?? null;
}

/**
 * Pour une requête sur `EmploiTemps` : borné aux créneaux de l'enseignant
 * LUI-MÊME.
 *
 * `teacherClasseFilter` ne suffit pas ici : il bornerait bien la requête sur ses
 * classes, mais montrerait les créneaux de ses COLLÈGUES pour ces mêmes classes —
 * donc les noms, salles et horaires de tout le planning qui le concerne
 * indirectement.
 *
 * Fail-closed : fiche enseignant introuvable ⇒ aucun créneau.
 */
export async function teacherEmploiTempsFilter(
  claims: TeacherScopeClaims
): Promise<Record<string, unknown>> {
  const scope = await resolveTeacherScope(claims);
  if (!scope.isRestricted) return {};
  const enseignantId = await resolveEnseignantId(claims);
  return {
    AND: [{ enseignantId: { in: [enseignantId ?? NO_TEACHER_SCOPE_ID] } }],
  };
}

// ------------------------------------------------------------
// Prédicats de garde (identifiant reçu de la requête HTTP)
// ------------------------------------------------------------
//
// Ces deux prédicats répondent à un cas que les fragments `where` ci-dessus ne
// couvrent pas : quand l'identifiant arrive de l'URL / du corps de requête et
// qu'il faut décider AVANT d'exécuter la suite (`classeId`, `eleveId`).
//
// Ils renvoient `true` pour tout rôle non enseignant : les gardes
// administratives restent régies par le RBAC et le filtre de site, jamais
// affaiblies par ces helpers.

/** La classe appartient-elle au périmètre de l'enseignant ? (true si non restreint) */
export async function isClasseInTeacherScope(
  claims: TeacherScopeClaims,
  classeId: string | null | undefined
): Promise<boolean> {
  const scope = await resolveTeacherScope(claims);
  if (!scope.isRestricted) return true;
  if (!classeId) return false;
  return scope.classeIds.includes(classeId);
}

/** La matière est-elle enseignée par l'enseignant ? (true si non restreint) */
export async function isMatiereInTeacherScope(
  claims: TeacherScopeClaims,
  matiereId: string | null | undefined
): Promise<boolean> {
  const scope = await resolveTeacherScope(claims);
  if (!scope.isRestricted) return true;
  if (!matiereId) return false;
  return scope.matiereIds.includes(matiereId);
}

/**
 * L'élève est-il dans une classe de l'enseignant ? (true si non restreint)
 *
 * Consulte la base : `eleveId` arrive de la requête HTTP et n'est rattachable
 * à aucune autre information avant la lecture de la fiche élève.
 */
export async function isEleveInTeacherScope(
  claims: TeacherScopeClaims & { tenantId?: string | null },
  eleveId: string | null | undefined
): Promise<boolean> {
  const scope = await resolveTeacherScope(claims);
  if (!scope.isRestricted) return true;
  if (!eleveId || !claims.tenantId) return false;
  if (scope.classeIds.length === 0) return false;
  // eslint-disable-next-line ecolpro/require-site-filter -- périmètre enseignant vérifié ci-dessus (classeId borné), site déjà validé par l'appelant
  const eleve = await prisma.eleve.findFirst({
    where: { id: eleveId, tenantId: claims.tenantId, classeId: { in: scope.classeIds } },
    select: { id: true },
  });
  return Boolean(eleve);
}

/**
 * Tous les élèves fournis appartiennent-ils au périmètre de l'enseignant ?
 * (true si non restreint) — un seul identifiant hors périmètre suffit à refuser.
 */
export async function areElevesInTeacherScope(
  claims: TeacherScopeClaims & { tenantId?: string | null },
  eleveIds: string[]
): Promise<boolean> {
  const scope = await resolveTeacherScope(claims);
  if (!scope.isRestricted) return true;
  if (eleveIds.length === 0) return true;
  if (scope.classeIds.length === 0) return false;
  // eslint-disable-next-line ecolpro/require-site-filter -- classeId borné au périmètre enseignant, site déjà validé par l'appelant
  const count = await prisma.eleve.count({
    where: { id: { in: eleveIds }, tenantId: claims.tenantId!, classeId: { in: scope.classeIds } },
  });
  return count === new Set(eleveIds).size;
}
