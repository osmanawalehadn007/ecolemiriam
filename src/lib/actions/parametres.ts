"use server";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import prismaBase from "@/lib/prisma-base";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import {
  siteFilterForModel,
  siteIdForCreate,
  siteForNewMember,
  roleRequiresSite,
  requireSiteIdForCreate,
  type SessionSiteClaims,
  mergeFilters,
} from "@/lib/site-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { decouperEnTrimestres } from "@/lib/annee-periodes";
import { anneeFilterForModel, requireAnneeForCreate } from "@/lib/annee-scope";
import { isNiveauPrimaire } from "@/lib/utils-classe";
import { NIVEAUX_CANONIQUES, normaliserNiveau } from "@/lib/niveau";
import { ELEVE_NON_ARCHIVE } from "@/lib/eleve-filters";
import { checkPermission, roleHasPermission } from "@/lib/rbac";
import { generateSecurePassword } from "@/lib/security/password";
import { sendVerificationEmail } from "@/lib/security/email-verification";
import type { Prisma, Role } from "@prisma/client";

// ============================================================
// ÉTABLISSEMENT
// ============================================================

const EtablissementSchema = z.object({
  name: z.string().min(2, "Le nom est requis"),
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().default("SN"),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  website: z.string().optional(),
  siret: z.string().optional(),
  currentYear: z.string().min(1, "L'année scolaire est requise"),
  notationMax: z.number().min(1).max(100),
  langue: z.string().default("fr"),
  timezone: z.string().default("Africa/Dakar"),
  currency: z.string().default("DJF"),
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
});

export type EtablissementFormData = z.infer<typeof EtablissementSchema>;

export async function updateEtablissement(data: EtablissementFormData) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "parametres:write");
  if (denied) throw new Error("Accès refusé");

  const parsed = EtablissementSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const v = parsed.data;
  await prisma.tenant.update({
    where: { id: session.user.tenantId },
    data: {
      name: v.name,
      address: v.address || null,
      city: v.city || null,
      country: v.country,
      phone: v.phone || null,
      email: v.email || null,
      website: v.website || null,
      siret: v.siret || null,
      currentYear: v.currentYear,
      notationMax: v.notationMax,
      langue: v.langue,
      timezone: v.timezone,
      currency: v.currency,
      primaryColor: v.primaryColor || null,
      secondaryColor: v.secondaryColor || null,
    },
  });

  revalidatePath("/parametres");
  return { success: true };
}

export async function getEtablissementData() {
  const session = await auth();
  if (!session?.user?.tenantId) return null;

  const denied = checkPermission(session.user.role, "parametres:read");
  if (denied) return null;

  return prisma.tenant.findUnique({
    where: { id: session.user.tenantId },
  });
}

// ============================================================
// UTILISATEURS
// ============================================================

const UserSchema = z.object({
  name: z.string().min(1, "Le nom est requis"),
  email: z.string().email("Email invalide"),
  role: z.enum([
    "TENANT_ADMIN",
    "PRINCIPAL",
    "SECRETARY",
    "TEACHER",
    "CLASS_TEACHER",
    "COUNSELOR",
    "NURSE",
    "ACCOUNTANT",
    "PARENT",
  ]),
  phone: z.string().optional(),
  password: z.string().min(8, "Min. 8 caractères").optional().or(z.literal("")),
  isActive: z.boolean().default(true),
  // Champs pour l'affectation immédiate des enseignants (TEACHER / CLASS_TEACHER)
  matiereIds: z.array(z.string()).optional(),
  classeIds: z.array(z.string()).optional(),
});

export type UserFormData = z.infer<typeof UserSchema>;

export async function getUsersForTenant() {
  const session = await auth();
  if (!session?.user?.tenantId) return [];

  const denied = checkPermission(session.user.role, "parametres:read");
  if (denied) return [];

  // Le périmètre était reconstruit à la main ici, et il était fail-open :
  // sans site sélectionné, `{ siteId: siteId ?? undefined }` devenait une
  // clause vide, l'`OR` était donc satisfait par tout le monde et l'annuaire
  // complet de l'établissement remontait à un compte pourtant borné à un
  // site. Le helper partagé, lui, ne renvoie rien faute de périmètre.
  return prisma.user.findMany({
    where: {
      tenantId: session.user.tenantId,
      ...siteFilterForModel("user", session.user),
    },
    select: {
      id: true,
      name: true,
      email: true,
      emailVerified: true,
      role: true,
      phone: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
      emailLogs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true, type: true, createdAt: true, errorMessage: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function createUser(data: UserFormData) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "parametres:write");
  if (denied) throw new Error("Accès refusé");

  const parsed = UserSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const v = parsed.data;
  // Le personnel est rattaché automatiquement au site sur lequel l'appelant
  // est positionné. En « tous les sites », on refuse : le compte n'aurait
  // aucun site et ne verrait rien une fois connecté.
  const rattachement = siteForNewMember(session.user, v.role);
  if (rattachement.error) throw new Error(rattachement.error);
  const siteIdCreation = rattachement.siteId;
  // `User.email` est unique au niveau de la plateforme entière, pas du tenant :
  // le contrôle d'unicité doit donc être inter-tenants et inter-sites, sinon on
  // laisserait créer un doublon qui échouerait ensuite en base. Seule
  // l'existence est utilisée, aucune donnée de l'autre tenant n'est exposée.
   
  const existing = await prismaBase.user.findFirst({ where: { email: { equals: v.email, mode: "insensitive" } } });
  if (existing) throw new Error("Un utilisateur avec cet email existe déjà");

  // Sécurité : pas de mot de passe par défaut codé en dur. Si aucun mot de
  // passe n'est fourni, on génère un mot de passe aléatoire fort.
  const password = v.password || generateSecurePassword();
  const hashed = await bcrypt.hash(password, 12);

  const [firstName, ...restName] = v.name.split(" ");
  const lastName = restName.join(" ") || firstName;

  const newUser = await prisma.user.create({
    data: {
      tenantId: session.user.tenantId,
      siteId: siteIdCreation,
      name: v.name,
      email: v.email,
      role: v.role,
      phone: v.phone || null,
      password: hashed,
      isActive: v.isActive,
      // Mot de passe défini par l'administrateur (ou temporaire) : l'utilisateur
      // devra le changer à sa première connexion.
      mustChangePassword: true,
      // Créer l'entrée UserTenant pour le multi-tenant
      userTenants: {
        create: {
          tenantId: session.user.tenantId,
          role: v.role,
          isActive: v.isActive,
          isDefault: true,
        },
      },
      // Les sites autorisés d'une session se lisent dans UserSite (et
      // EnseignantSite), pas dans `siteId` : sans cette ligne, le compte se
      // connecterait sans aucun site.
      ...(siteIdCreation && roleRequiresSite(v.role)
        ? { userSites: { create: { siteId: siteIdCreation } } }
        : {}),
    },
  });

  // Auto-create Enseignant record for teacher roles
  if (v.role === "TEACHER" || v.role === "CLASS_TEACHER") {
    const enseignant = await prisma.enseignant.create({
      data: {
        tenantId: session.user.tenantId,
        userId: newUser.id,
        dateEntree: new Date(),
        // Le périmètre d'un enseignant se lit dans EnseignantSite : sans cette
        // ligne, il n'apparaît dans aucun site (seulement en « tous les sites »).
        ...(siteIdCreation ? { sites: { create: { siteId: siteIdCreation } } } : {}),
      },
    });

    // Affectation immédiate des matières (collège/lycée)
    if (v.matiereIds && v.matiereIds.length > 0) {
      // Valider que toutes les matières appartiennent au tenant
      const validMatieres = await prisma.matiere.findMany({
        where: {
          id: { in: v.matiereIds },
          tenantId: session.user.tenantId,
          ...siteFilterForModel("matiere", session.user),
        },
        select: { id: true },
      });
      if (validMatieres.length !== v.matiereIds.length) {
        throw new Error("Une ou plusieurs matières sont invalides");
      }
      await prisma.enseignantMatiere.createMany({
        data: v.matiereIds.map((matiereId) => ({
          tenantId: session.user.tenantId!,
          enseignantId: enseignant.id,
          matiereId,
        })),
      });
    }

    // Affectation immédiate des classes
    if (v.classeIds && v.classeIds.length > 0) {
      // Valider que toutes les classes appartiennent au tenant
      const validClasses = await prisma.classe.findMany({
        where: mergeFilters(
          { id: { in: v.classeIds }, tenantId: session.user.tenantId },
          siteFilterForModel("classe", session.user),
          anneeFilterForModel(
            "classe",
            await getAnneeCouranteLibelle(session.user.tenantId),
          ),
        ),
        select: { id: true, niveau: true, siteId: true },
      });
      if (validClasses.length !== v.classeIds.length) {
        throw new Error("Une ou plusieurs classes sont invalides");
      }

      // Déduire le site de l'enseignant à partir des classes
      // (toutes les classes doivent appartenir au même site pour un enseignant mono-site)
      const siteIds = [...new Set(validClasses.map((c) => c.siteId).filter(Boolean))];
      if (siteIds.length === 1) {
        // Mettre à jour le user.siteId (le site se gère au niveau User, pas Enseignant)
        // eslint-disable-next-line ecolemiriam/require-tenant-id -- self-update : newUser.id provient du create
        await prisma.user.update({
          where: { id: newUser.id },
          data: { siteId: siteIds[0] },
        });
      }

      // Créer les affectations enseignant ↔ classe
      for (const classe of validClasses) {
        const isPrimaire = isNiveauPrimaire(classe.niveau);
        // Au primaire : 1 classe max, pas de matière
        // Au collège/lycée : matière obligatoire (on prend la 1ère matière si plusieurs)
        const matiereId = isPrimaire
          ? undefined
          : v.matiereIds && v.matiereIds.length > 0
            ? v.matiereIds[0]
            : undefined;

        // Vérifier l'unicité (unique sur [enseignantId, classeId, matiereId])
        // eslint-disable-next-line ecolemiriam/require-tenant-id -- tenantId fourni par le caller (session.user.tenantId)
        const existingAffectation = await prisma.enseignantAffectation.findFirst({
          where: { enseignantId: enseignant.id, classeId: classe.id, matiereId: matiereId ?? null },
        });
        if (!existingAffectation) {
          await prisma.enseignantAffectation.create({
            data: {
              tenantId: session.user.tenantId!,
              enseignantId: enseignant.id,
              classeId: classe.id,
              matiereId: matiereId || null,
            },
          });
        }
      }
    }
  }

  // Auto-create Parent record for parent role
  if (v.role === "PARENT") {
    await prisma.parent.create({
      data: {
        tenantId: session.user.tenantId,
        userId: newUser.id,
        nom: lastName,
        prenom: firstName,
        email: v.email,
        phone: v.phone || "",
      },
    });
  }

  // ── Envoi de l'email de vérification ──────────────────────────────
  // L'utilisateur doit vérifier son email avant de pouvoir se connecter.
  // Le mot de passe temporaire est inclus dans l'email pour que l'utilisateur
  // puisse se connecter directement, ou il peut en définir un nouveau via
  // la page /set-password après vérification.
  // Ne pas bloquer la création si l'envoi échoue, mais retourner le statut
  // pour que l'UI puisse informer l'administrateur.
  let emailSent = false;
  let emailError: string | undefined;
  try {
    const verifyResult = await sendVerificationEmail(
      v.email,
      v.name,
      undefined,
      true,
      password, // mot de passe temporaire en clair dans l'email
      { tenantId: session.user.tenantId, userId: newUser.id, createdBy: session.user.id }
    );
    if (!verifyResult.success) {
      console.warn("[createUser] Échec envoi email de vérification:", verifyResult.error);
      emailError = verifyResult.error;
    } else {
      emailSent = true;
    }
  } catch (err) {
    console.warn("[createUser] Erreur envoi email de vérification:", err);
    emailError = err instanceof Error ? err.message : "Erreur inconnue";
  }

  revalidatePath("/parametres");
  return { success: true, userId: newUser.id, emailSent, emailError };
}

export async function toggleUserActive(userId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "parametres:write");
  if (denied) throw new Error("Accès refusé");

  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      tenantId: session.user.tenantId,
      ...siteFilterForModel("user", session.user),
    },
  });
  if (!user) throw new Error("Utilisateur non trouvé");

  await prisma.user.update({
    where: { id: userId },
    data: { isActive: !user.isActive },
  });

  revalidatePath("/parametres");
  return { success: true };
}

export async function deleteUser(userId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "parametres:write");
  if (denied) throw new Error("Accès refusé");

  if (userId === session.user.id) throw new Error("Vous ne pouvez pas supprimer votre propre compte");

  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      tenantId: session.user.tenantId,
      ...siteFilterForModel("user", session.user),
    },
  });
  if (!user) throw new Error("Utilisateur non trouvé");

  // Supprimer les enregistrements liés pour éviter les violations de clés étrangères
  await prisma.enseignant.deleteMany({ where: { userId, tenantId: session.user.tenantId } }).catch(() => {});
  await prisma.parent.deleteMany({ where: { userId, tenantId: session.user.tenantId } }).catch(() => {});
  await prisma.userSite.deleteMany({ where: { userId } }).catch(() => {});
  // Le compte lui-même est supprimé juste après : ses adhésions doivent toutes
  // partir, y compris celles d'autres établissements, sinon la clé étrangère
  // bloque la suppression. L'appartenance au tenant appelant vient d'être
  // vérifiée ci-dessus.
  // LIMITE ASSUMÉE : un compte partagé entre plusieurs établissements perd
  // aussi ses accès aux autres, puisque la ligne User disparaît.
  // eslint-disable-next-line ecolemiriam/require-tenant-id
  await prisma.userTenant.deleteMany({ where: { userId } }).catch(() => {});

  await prisma.user.delete({ where: { id: userId } });

  revalidatePath("/parametres");
  return { success: true };
}

// ============================================================
// CLASSES
// ============================================================

const ClasseSchema = z.object({
  nom: z.string().min(1, "Le nom est requis"),
  // Le niveau est un RÉFÉRENTIEL FERMÉ (src/lib/niveau.ts) : la grille
  // tarifaire y est indexée. Une saisie libre (« 2 », « 2eme »,
  // « 2ème année ») créait une classe que plus aucune grille ne facturait —
  // constaté le 28/09/2026 sur 191 élèves de Campus Central.
  // Ici on NORMALISE (2 → 2ème) et on REFUSE l'inclassable, au lieu de
  // stocker un niveau que le moteur tarifaire ne saura pas résoudre.
  niveau: z
    .string()
    .min(1, "Le niveau est requis")
    .transform((valeur, ctx): string => {
      const canonique = normaliserNiveau(valeur);
      if (!canonique) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Niveau « ${valeur} » non reconnu. Valeurs autorisées : ${NIVEAUX_CANONIQUES.join(", ")}.`,
        });
        return z.NEVER;
      }
      return canonique;
    }),
  filiere: z.string().optional(),
  effectifMax: z.number().min(1).default(40),
  // Pas de littéral par défaut : « 2025-2026 » restait figé après la rentrée
  // et fabriquait des classes datées d'une année révolue, invisibles dans les
  // écrans de l'année en cours mais proposées par les anciens sélecteurs.
  // L'année est résolue côté serveur depuis `annees_scolaires`.
  annee: z.string().optional(),
  structureId: z.string().optional(),
  profPrincipalId: z.string().optional(),
  siteId: z.string().optional(),
});

export type ClasseFormData = z.infer<typeof ClasseSchema>;

export async function getClassesForSettings() {
  const session = await auth();
  if (!session?.user?.tenantId) return [];

  const denied = checkPermission(session.user.role, "classes:read");
  if (denied) return [];

  const siteId = (session.user as { siteId?: string | null }).siteId ?? null;
  const siteIds = (session.user as { siteIds?: string[] }).siteIds;

  const siteFilter = siteFilterForModel("classe", session.user);
  // eslint-disable-next-line ecolemiriam/require-annee-filter -- écran de gestion : toutes les années sont listées volontairement (l'année figure sur chaque ligne) pour permettre le nettoyage des structures périmées
  return prisma.classe.findMany({
    where: { tenantId: session.user.tenantId, ...siteFilter },
    include: {
      // Sans ce filtre, l'effectif affiché inclut les fiches archivées :
      // les classes annonçaient jusqu'à 63 élèves pour 29 réels.
      _count: { select: { eleves: ELEVE_NON_ARCHIVE } },
      profPrincipal: { select: { user: { select: { name: true } } } },
      structure: { select: { id: true, nom: true, type: true } },
    },
    orderBy: [{ niveau: "asc" }, { nom: "asc" }],
  });
}

export async function getEnseignantsForClasse() {
  const session = await auth();
  if (!session?.user?.tenantId) return [];
  const denied = checkPermission(session.user.role, "enseignants:read");
  if (denied) return [];
  const siteFilter = siteFilterForModel("enseignant", session.user);
  return prisma.enseignant.findMany({
    where: { tenantId: session.user.tenantId, ...siteFilter },
    select: { id: true, user: { select: { name: true } } },
    orderBy: { user: { name: "asc" } },
  });
}

export async function createClasse(data: ClasseFormData) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");

  const denied = checkPermission(session.user.role, "classes:write");
  if (denied) throw new Error("Accès refusé");

  const siteError = requireSiteIdForCreate(session.user);
  if (siteError) throw new Error(siteError);

  const parsed = ClasseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const v = parsed.data;

  // Vérifier que le prof principal existe et appartient au tenant
  if (v.profPrincipalId) {
    const ens = await prisma.enseignant.findFirst({
      where: {
        id: v.profPrincipalId,
        tenantId: session.user.tenantId,
        ...siteFilterForModel("enseignant", session.user),
      },
      select: { id: true },
    });
    if (!ens) throw new Error("Enseignant introuvable dans cet établissement");
  }

  // Année de la classe : celle transmise si elle est explicite (création
  // anticipée de l'année suivante), sinon l'année courante du tenant.
  const anneeClasse =
    v.annee?.trim() || (await getAnneeCouranteLibelle(session.user.tenantId));
  const anneeErreur = requireAnneeForCreate(anneeClasse);
  if (anneeErreur) throw new Error(anneeErreur);

  await prisma.classe.create({
    data: {
      tenantId: session.user.tenantId,
      siteId: v.siteId || siteIdForCreate(session.user),
      nom: v.nom,
      niveau: v.niveau,
      filiere: v.filiere || null,
      effectifMax: v.effectifMax,
      annee: anneeClasse!,
      structureId: v.structureId || null,
      profPrincipalId: v.profPrincipalId || null,
    },
  });

  revalidatePath("/parametres");
  revalidatePath("/eleves");
  revalidateTag("classes-list", "max");
  revalidateTag("dashboard-data", "max");
  revalidateTag("eleves-stats", "max");
  return { success: true };
}

export async function deleteClasse(
  classeId: string,
  options?: { strategy?: "reassign" | "unassign"; targetClasseId?: string }
) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");

  const denied = checkPermission(session.user.role, "classes:delete");
  if (denied) throw new Error("Accès refusé");

  // eslint-disable-next-line ecolemiriam/require-annee-filter -- lookup par id : on doit pouvoir supprimer une classe d'une année révolue
  const classe = await prisma.classe.findFirst({
    where: {
      id: classeId,
      tenantId: session.user.tenantId,
      ...siteFilterForModel("classe", session.user),
    },
    include: { _count: { select: { eleves: ELEVE_NON_ARCHIVE, notes: true, evaluations: true } } },
  });
  if (!classe) throw new Error("Classe non trouvée");

  if (classe._count.notes > 0 || classe._count.evaluations > 0) {
    throw new Error(
      `Impossible de supprimer cette classe : elle contient ${classe._count.evaluations} évaluation(s) et ${classe._count.notes} note(s). Déplacez les élèves avec « Changement de classe » ou conservez la classe.`
    );
  }

  const eleveWhere = { classeId, tenantId: session.user.tenantId, ...ELEVE_NON_ARCHIVE.where };
  const ops: Prisma.PrismaPromise<unknown>[] = [];

  // S'il y a des élèves actifs, exiger une stratégie explicite.
  if (classe._count.eleves > 0) {
    const strategy = options?.strategy ?? "refuse";
    if (strategy === "refuse") {
      throw new Error(
        `Impossible de supprimer une classe avec des élèves (${classe._count.eleves} élève(s) actif(s)). Choisissez une option de réaffectation.`
      );
    }

    if (strategy === "reassign") {
      if (!options?.targetClasseId) throw new Error("Classe cible requise pour la réaffectation");
      const target = await prisma.classe.findFirst({
        where: {
          id: options.targetClasseId,
          tenantId: session.user.tenantId,
          // Même année que la classe supprimée : réaffecter vers une autre
          // année déplacerait les élèves hors de leur cursus.
          annee: classe.annee,
          ...siteFilterForModel("classe", session.user),
        },
      });
      if (!target) throw new Error("Classe cible non trouvée (même année scolaire requise)");
      if (options.targetClasseId === classeId) throw new Error("La classe cible doit être différente");

      ops.push(prisma.eleve.updateMany({
        where: eleveWhere,
        data: { classeId: options.targetClasseId },
      }));
    } else if (strategy === "unassign") {
      ops.push(prisma.eleve.updateMany({
        where: eleveWhere,
        data: { classeId: null },
      }));
    }
  }

  // Déplacement et suppression dans la même transaction : si la suppression
  // échoue, les élèves ne restent pas déplacés à moitié.
  ops.push(prisma.classe.delete({ where: { id: classeId } }));
  await prisma.$transaction(ops);

  revalidatePath("/parametres");
  revalidatePath("/eleves");
  revalidateTag("classes-list", "max");
  revalidateTag("dashboard-data", "max");
  revalidateTag("eleves-stats", "max");
  return { success: true };
}

export async function transferClasse(classeId: string, targetSiteId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "classes:write");
  if (denied) throw new Error("Accès refusé");

  // eslint-disable-next-line ecolemiriam/require-site-filter, ecolemiriam/require-annee-filter -- tenantId dans le where, site filter géré par le caller ; lookup par id : la classe porte sa propre année
  const classe = await prisma.classe.findFirst({
    where: {
      id: classeId,
      tenantId: session.user.tenantId,
    },
    include: { _count: { select: { eleves: ELEVE_NON_ARCHIVE } } },
  });
  if (!classe) throw new Error("Classe non trouvée");

  if (classe.siteId === targetSiteId) throw new Error("La classe est déjà sur ce site");

  const targetSite = await prisma.site.findFirst({
    where: { id: targetSiteId, tenantId: session.user.tenantId },
  });
  if (!targetSite) throw new Error("Site cible non trouvé");

  await prisma.$transaction([
    prisma.classe.update({
      where: { id: classeId },
      data: { siteId: targetSiteId },
    }),
    prisma.eleve.updateMany({
      where: { classeId, tenantId: session.user.tenantId },
      data: { siteId: targetSiteId },
    }),
  ]);

  revalidatePath("/parametres");
  revalidatePath("/eleves");
  revalidateTag("classes-list", "max");
  revalidateTag("dashboard-data", "max");
  revalidateTag("eleves-stats", "max");
  return { success: true };
}

// ============================================================
// MATIÈRES
// ============================================================

const MatiereSchema = z.object({
  nom: z.string().min(1, "Le nom est requis"),
  code: z.string().min(1, "Le code est requis"),
  coefficient: z.number().min(0.5).default(1),
  couleur: z.string().optional(),
  niveau: z.string().optional(),
});

export type MatiereFormData = z.infer<typeof MatiereSchema>;

export async function getMatieresForSettings() {
  const session = await auth();
  if (!session?.user?.tenantId) return [];

  const denied = checkPermission(session.user.role, "matieres:read");
  if (denied) return [];

  return prisma.matiere.findMany({
    where: {
      tenantId: session.user.tenantId,
      ...siteFilterForModel("matiere", session.user),
    },
    orderBy: { nom: "asc" },
  });
}

export async function createMatiere(data: MatiereFormData) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");

  const denied = checkPermission(session.user.role, "matieres:write");
  if (denied) throw new Error("Accès refusé");

  const parsed = MatiereSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const v = parsed.data;
  await prisma.matiere.create({
    data: {
      tenantId: session.user.tenantId,
      nom: v.nom,
      code: v.code,
      coefficient: v.coefficient,
      couleur: v.couleur || null,
      niveau: v.niveau || null,
    },
  });

  revalidatePath("/parametres");
  return { success: true };
}

export async function deleteMatiere(matiereId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");

  const denied = checkPermission(session.user.role, "matieres:delete");
  if (denied) throw new Error("Accès refusé");

  const matiere = await prisma.matiere.findFirst({
    where: {
      id: matiereId,
      tenantId: session.user.tenantId,
      ...siteFilterForModel("matiere", session.user),
    },
  });
  if (!matiere) throw new Error("Matière non trouvée");

  await prisma.matiere.delete({ where: { id: matiereId } });

  revalidatePath("/parametres");
  return { success: true };
}

// ============================================================
// PARENTS & CONTACTS
// ============================================================

const ParentSchema = z.object({
  nom: z.string().min(1, "Le nom est requis"),
  prenom: z.string().min(1, "Le prénom est requis"),
  phone: z.string().min(1, "Le téléphone est requis"),
  phone2: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  telegramChatId: z.string().optional(),
  profession: z.string().optional(),
  adresse: z.string().optional(),
});

export type ParentFormData = z.infer<typeof ParentSchema>;

/**
 * Périmètre de site d'un parent.
 *
 * `Parent` ne porte pas de `siteId` et son `userId` est facultatif : passer par
 * `siteFilterForModel("parent", …)`, qui emprunte la relation `user`, ferait
 * disparaître tous les parents sans compte — c'est-à-dire la majorité. Le
 * rattachement réel d'un parent, c'est le site de ses enfants.
 *
 * Un parent sans aucun enfant reste visible : il ne porte encore aucune donnée
 * d'un autre site, et c'est l'état transitoire d'un parent qu'on vient de créer
 * avant de le rattacher (`{ some: … } OR { none: {} }`). Les enseignants, eux,
 * n'ont pas cette tolérance : leur rattachement EnseignantSite est obligatoire.
 */
function parentSiteScope(claims: SessionSiteClaims): Record<string, unknown> {
  const filtreEleve = siteFilterForModel("eleve", claims);
  if (Object.keys(filtreEleve).length === 0) return {};
  return {
    AND: [
      {
        OR: [
          { enfants: { some: { eleve: filtreEleve } } },
          { enfants: { none: {} } },
        ],
      },
    ],
  };
}

export async function getParentsForSettings() {
  const session = await auth();
  if (!session?.user?.tenantId) return [];

  const denied = checkPermission(session.user.role, "parents:read");
  if (denied) return [];

  // Isolation portée par la relation : le filtre de site est appliqué aux
  // enfants (voir `parentSiteScope`), donc imbriqué et invisible pour la règle.
  // Le modèle nommé était d'ailleurs faux ici — « parent » au lieu de
  // « eleve » — ce qui greffait un prédicat `user.siteId` sur un `Eleve`.
  // eslint-disable-next-line ecolemiriam/require-site-filter
  return prisma.parent.findMany({
    where: { tenantId: session.user.tenantId, ...parentSiteScope(session.user) },
    include: {
      enfants: {
        // Un parent peut avoir des enfants sur plusieurs sites : sans ce
        // filtre, la fiche affichait ceux des sites hors périmètre.
        where: siteFilterForModel("eleveParent", session.user),
        include: {
          eleve: {
            select: { id: true, nom: true, prenom: true, matricule: true, classe: { select: { nom: true } } },
          },
        },
      },
      user: { select: { id: true, email: true, isActive: true } },
    },
    orderBy: { nom: "asc" },
  });
}

export async function getElevesForLinking() {
  const session = await auth();
  if (!session?.user?.tenantId) return [];

  const denied = checkPermission(session.user.role, "eleves:read");
  if (denied) return [];

  const siteFilter = siteFilterForModel("eleve", session.user);

  return prisma.eleve.findMany({
    where: { tenantId: session.user.tenantId, statut: "ACTIF", ...siteFilter },
    select: {
      id: true,
      nom: true,
      prenom: true,
      matricule: true,
      classe: { select: { nom: true, niveau: true } },
    },
    orderBy: [{ classe: { nom: "asc" } }, { nom: "asc" }, { prenom: "asc" }],
  });
}

export async function createParent(data: ParentFormData & { eleveIds?: string[] }) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "parents:write");
  if (denied) throw new Error("Accès refusé");

  const parsed = ParentSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const v = parsed.data;
  const parent = await prisma.parent.create({
    data: {
      tenantId: session.user.tenantId,
      nom: v.nom,
      prenom: v.prenom,
      phone: v.phone,
      phone2: v.phone2 || null,
      email: v.email || null,
      telegramChatId: v.telegramChatId || null,
      profession: v.profession || null,
      adresse: v.adresse || null,
    },
  });

  // Link to students if provided
  if (data.eleveIds && data.eleveIds.length > 0) {
    // Les identifiants viennent du formulaire : sans ce filtrage, on pouvait
    // rattacher un parent à l'élève de n'importe quel site — voire de n'importe
    // quel établissement — en forgeant la liste.
    const elevesAutorises = await prisma.eleve.findMany({
      where: {
        id: { in: data.eleveIds },
        tenantId: session.user.tenantId,
        ...siteFilterForModel("eleve", session.user),
      },
      select: { id: true },
    });

    for (const { id: eleveId } of elevesAutorises) {
      // Identifiant déjà autorisé par la requête site-filtrée ci-dessus, et la
      // clé composite ne peut de toute façon désigner que ce parent-ci.
      // eslint-disable-next-line ecolemiriam/require-site-filter
      const existing = await prisma.eleveParent.findUnique({
        where: { eleveId_parentId: { eleveId, parentId: parent.id } },
      });
      if (!existing) {
        await prisma.eleveParent.create({
          data: { eleveId, parentId: parent.id, lien: "TUTEUR", isGardien: true },
        });
      }
    }
  }

  revalidatePath("/parametres");
  return { success: true };
}

export async function linkParentToEleves(parentId: string, eleveIds: string[], lien: string = "TUTEUR") {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "parents:write");
  if (denied) throw new Error("Accès refusé");

  // Isolation portée par la relation enfants → élève (voir `parentSiteScope`).
  // eslint-disable-next-line ecolemiriam/require-site-filter
  const parent = await prisma.parent.findFirst({
    where: {
      id: parentId,
      tenantId: session.user.tenantId,
      ...parentSiteScope(session.user),
    },
  });
  if (!parent) throw new Error("Parent non trouvé");

  // Même raison que dans `createParent` : la liste d'élèves arrive du client et
  // doit être ramenée au périmètre de l'appelant avant tout rattachement.
  const elevesAutorises = await prisma.eleve.findMany({
    where: {
      id: { in: eleveIds },
      tenantId: session.user.tenantId,
      ...siteFilterForModel("eleve", session.user),
    },
    select: { id: true },
  });

  for (const { id: eleveId } of elevesAutorises) {
    // Élève et parent tous deux validés ci-dessus ; la clé composite ne peut
    // désigner qu'un couple déjà autorisé.
    // eslint-disable-next-line ecolemiriam/require-site-filter
    const existing = await prisma.eleveParent.findUnique({
      where: { eleveId_parentId: { eleveId, parentId } },
    });
    if (!existing) {
      await prisma.eleveParent.create({
        data: { eleveId, parentId, lien: lien as any, isGardien: true },
      });
    }
  }

  revalidatePath("/parametres");
  return { success: true };
}

export async function unlinkParentFromEleve(parentId: string, eleveId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "parents:write");
  if (denied) throw new Error("Accès refusé");

  await prisma.eleveParent.delete({
    where: { eleveId_parentId: { eleveId, parentId } },
  });

  revalidatePath("/parametres");
  return { success: true };
}

export async function updateParentPhone(parentId: string, phone: string, telegramChatId?: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "parents:write");
  if (denied) throw new Error("Accès refusé");

  // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId dans le where, site filter géré par le caller
  const parent = await prisma.parent.findFirst({
    where: { id: parentId, tenantId: session.user.tenantId },
  });
  if (!parent) throw new Error("Parent non trouvé");

  await prisma.parent.update({
    where: { id: parentId },
    data: {
      phone,
      telegramChatId: telegramChatId || null,
    },
  });

  revalidatePath("/parametres");
  return { success: true };
}

export async function deleteParent(parentId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "parents:delete");
  if (denied) throw new Error("Accès refusé");

  // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId dans le where, site filter géré par le caller
  const parent = await prisma.parent.findFirst({
    where: { id: parentId, tenantId: session.user.tenantId },
  });
  if (!parent) throw new Error("Parent non trouvé");

  await prisma.parent.delete({ where: { id: parentId } });

  revalidatePath("/parametres");
  return { success: true };
}

export async function updateUserPhone(userId: string, phone: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "parametres:write");
  if (denied) throw new Error("Accès refusé");

  // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId dans le where, site filter géré par le caller
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId: session.user.tenantId },
  });
  if (!user) throw new Error("Utilisateur non trouvé");

  await prisma.user.update({
    where: { id: userId },
    data: { phone: phone || null },
  });

  // Also update parent phone if user is linked to a parent
  if (phone) {
    await prisma.parent.updateMany({
      where: { userId: userId, tenantId: session.user.tenantId },
      data: { phone },
    });
  }

  revalidatePath("/parametres");
  return { success: true };
}

// ============================================================
// RÈGLES D'APPRÉCIATION / CLÔTURE DES PÉRIODES / SIGNATURE
// ============================================================

export async function getReglesAppreciation() {
  const session = await auth();
  if (!session?.user?.tenantId) return [];

  const denied = checkPermission(session.user.role, "parametres:read");
  if (denied) return [];

  return prisma.reglesAppreciation.findMany({
    where: { tenantId: session.user.tenantId },
    orderBy: [{ contexte: "asc" }, { seuilMin: "asc" }],
  });
}

export async function getPeriodesForCloture() {
  const session = await auth();
  if (!session?.user?.tenantId) return [];

  const denied = checkPermission(session.user.role, "parametres:read");
  if (denied) return [];

  const annee = await prisma.anneesScolaires.findFirst({
    where: { tenantId: session.user.tenantId, isCurrent: true },
  });
  if (!annee) return [];

  return prisma.periode.findMany({
    where: { anneeId: annee.id },
    orderBy: { numero: "asc" },
  });
}

// ============================================================
// SITES / CAMPUSES
// ============================================================

const SiteSchema = z.object({
  nom: z.string().min(2, "Le nom du site est requis"),
  code: z.string().optional(),
  adresse: z.string().optional(),
  ville: z.string().optional(),
  telephone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  actif: z.boolean().default(true),
});

export type SiteFormData = z.infer<typeof SiteSchema>;

export async function getSitesForSettings() {
  const session = await auth();
  if (!session?.user?.tenantId) return [];

  const denied = checkPermission(session.user.role, "structures:read");
  if (denied) return [];

  const isAdmin = session.user.role === "TENANT_ADMIN" || session.user.role === "SUPER_ADMIN";

  return prisma.site.findMany({
    where: isAdmin
      ? { tenantId: session.user.tenantId, deletedAt: null }
      : {
          tenantId: session.user.tenantId,
          deletedAt: null,
          userSites: { some: { userId: session.user.id } },
        },
    include: {
      _count: {
        select: {
          classes: true,
          eleves: ELEVE_NON_ARCHIVE,
          salles: true,
          userSites: true,
          factures: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function createSite(data: SiteFormData) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "structures:write");
  if (denied) throw new Error("Accès refusé");

  const parsed = SiteSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const v = parsed.data;
  await prisma.site.create({
    data: {
      tenantId: session.user.tenantId,
      nom: v.nom,
      code: v.code || null,
      adresse: v.adresse || null,
      ville: v.ville || null,
      telephone: v.telephone || null,
      email: v.email || null,
      actif: v.actif,
    },
  });

  revalidatePath("/parametres");
  return { success: true };
}

export async function updateSite(siteId: string, data: Partial<SiteFormData>) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "structures:write");
  if (denied) throw new Error("Accès refusé");

  const site = await prisma.site.findFirst({
    where: { id: siteId, tenantId: session.user.tenantId },
  });
  if (!site) throw new Error("Site non trouvé");

  const parsed = SiteSchema.partial().safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const v = parsed.data;
  await prisma.site.update({
    where: { id: siteId },
    data: {
      nom: v.nom,
      code: v.code,
      adresse: v.adresse,
      ville: v.ville,
      telephone: v.telephone,
      email: v.email,
      actif: v.actif,
    },
  });

  revalidatePath("/parametres");
  return { success: true };
}

const PURGE_DELAY_DAYS = 90;

const DeleteSiteSchema = z.object({
  reason: z.enum(["FERMETURE", "FUSION", "ERREUR", "AUTRE"], {
    error: "Veuillez sélectionner une raison",
  }),
  customReason: z.string().optional(),
  confirmName1: z.string().min(1, "Veuillez saisir le nom du site"),
  confirmName2: z.string().min(1, "Veuillez confirmer le nom du site"),
  acknowledgeIrreversible: z.boolean().refine((v) => v === true, {
    message: "Vous devez cocher la case de confirmation",
  }),
});

export type DeleteSiteFormData = z.infer<typeof DeleteSiteSchema>;

export async function deleteSite(siteId: string, data: DeleteSiteFormData) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "structures:delete");
  if (denied) throw new Error("Accès refusé");

  const parsed = DeleteSiteSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const site = await prisma.site.findFirst({
    where: { id: siteId, tenantId: session.user.tenantId, deletedAt: null },
  });
  if (!site) throw new Error("Site non trouvé ou déjà supprimé");

  if (parsed.data.confirmName1 !== site.nom || parsed.data.confirmName2 !== site.nom) {
    throw new Error("Le nom saisi ne correspond pas au nom du site");
  }

  const reasonLabel = parsed.data.reason === "AUTRE" && parsed.data.customReason
    ? parsed.data.customReason
    : parsed.data.reason;

  const now = new Date();
  const scheduledPurgeAt = new Date(now.getTime() + PURGE_DELAY_DAYS * 24 * 60 * 60 * 1000);

  await prisma.$transaction([
    prisma.site.update({
      where: { id: siteId },
      data: {
        deletedAt: now,
        deletedBy: session.user.id,
        deletedReason: reasonLabel,
        scheduledPurgeAt,
        actif: false,
      },
    }),
    prisma.siteDeletionLog.create({
      data: {
        tenantId: session.user.tenantId,
        siteId: site.id,
        siteNom: site.nom,
        action: "SOFT_DELETE",
        reason: reasonLabel,
        performedBy: session.user.id,
        performedByName: session.user.name ?? null,
        metadata: { scheduledPurgeAt: scheduledPurgeAt.toISOString(), confirmName1: parsed.data.confirmName1, confirmName2: parsed.data.confirmName2 },
      },
    }),
  ]);

  revalidatePath("/parametres");
  return { success: true, scheduledPurgeAt: scheduledPurgeAt.toISOString() };
}

export async function restoreSite(siteId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "structures:write");
  if (denied) throw new Error("Accès refusé");

  const site = await prisma.site.findFirst({
    where: { id: siteId, tenantId: session.user.tenantId, deletedAt: { not: null } },
  });
  if (!site) throw new Error("Site supprimé non trouvé");

  await prisma.$transaction([
    prisma.site.update({
      where: { id: siteId },
      data: {
        deletedAt: null,
        deletedBy: null,
        deletedReason: null,
        scheduledPurgeAt: null,
      },
    }),
    prisma.siteDeletionLog.create({
      data: {
        tenantId: session.user.tenantId,
        siteId: site.id,
        siteNom: site.nom,
        action: "RESTORE",
        performedBy: session.user.id,
        performedByName: session.user.name ?? null,
      },
    }),
  ]);

  revalidatePath("/parametres");
  return { success: true };
}

export async function getDeletedSites() {
  const session = await auth();
  if (!session?.user?.tenantId) return [];

  const denied = checkPermission(session.user.role, "structures:read");
  if (denied) return [];

  return prisma.site.findMany({
    where: {
      tenantId: session.user.tenantId,
      deletedAt: { not: null },
    },
    select: {
      id: true,
      nom: true,
      code: true,
      deletedAt: true,
      deletedReason: true,
      scheduledPurgeAt: true,
      _count: {
        select: {
          classes: true,
          eleves: ELEVE_NON_ARCHIVE,
          salles: true,
        },
      },
    },
    orderBy: { deletedAt: "desc" },
  });
}

export async function assignUserSites(userId: string, sites: { siteId: string; role?: string | null }[]) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "parametres:write");
  if (denied) throw new Error("Accès refusé");

  // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId dans le where, site filter géré par le caller
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId: session.user.tenantId },
  });
  if (!user) throw new Error("Utilisateur non trouvé");

  const siteIds = sites.map((s) => s.siteId);

  // Vérifier que tous les sites appartiennent au tenant
  if (siteIds.length > 0) {
    const validSites = await prisma.site.findMany({
      where: { id: { in: siteIds }, tenantId: session.user.tenantId },
      select: { id: true },
    });
    if (validSites.length !== siteIds.length) {
      throw new Error("Un ou plusieurs sites sont invalides");
    }
  }

  // eslint-disable-next-line ecolemiriam/require-site-filter -- fiche du compte déjà validé ci-dessus (tenantId), on en réécrit justement les sites
  const enseignant = await prisma.enseignant.findFirst({
    where: { userId, tenantId: session.user.tenantId },
    select: { id: true },
  });
  if (enseignant && siteIds.length === 0) {
    throw new Error("Un enseignant doit être rattaché à au moins un site.");
  }

  // Supprimer les anciennes associations
  await prisma.userSite.deleteMany({
    where: { userId },
  });

  // Si aucun site sélectionné → siteId = null (accès tous sites)
  if (siteIds.length === 0) {
    await prisma.user.update({
      where: { id: userId },
      data: { siteId: null },
    });
  } else {
    // Si un seul site, on garde aussi siteId pour compatibilité
    if (siteIds.length === 1) {
      await prisma.user.update({
        where: { id: userId },
        data: { siteId: siteIds[0] },
      });
    } else {
      // Multi-sites: siteId principal = null (le filtrage se fera via UserSite)
      await prisma.user.update({
        where: { id: userId },
        data: { siteId: null },
      });
    }

    // Créer les nouvelles associations avec rôle optionnel par site
    for (const s of sites) {
      await prisma.userSite.create({
        data: {
          userId,
          siteId: s.siteId,
          role: (s.role && s.role !== "INHERIT") ? s.role as Role : null,
        },
      });
    }
  }

  // Un enseignant est rattaché à ses sites par EnseignantSite (c'est ce que lit
  // le filtre de site) : on l'aligne sur les accès du compte.
  if (enseignant) {
    await prisma.$transaction([
      prisma.enseignantSite.deleteMany({ where: { enseignantId: enseignant.id } }),
      prisma.enseignantSite.createMany({
        data: siteIds.map((siteId) => ({ enseignantId: enseignant.id, siteId })),
      }),
    ]);
  }

  revalidatePath("/parametres");
  return { success: true };
}

export async function getUserSites(userId: string): Promise<{ siteId: string; role: string | null }[]> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");

  const denied = checkPermission(session.user.role, "parametres:read");
  if (denied) throw new Error("Accès refusé");

  // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId dans le where, site filter géré par le caller
  const userSites = await prisma.userSite.findMany({
    where: { userId },
    select: { siteId: true, role: true },
  });

  return userSites.map((us) => ({ siteId: us.siteId, role: us.role }));
}

// ============================================================
// ANNÉES SCOLAIRES
// ============================================================

const AnneeScolaireSchema = z.object({
  libelle: z.string().min(1, "Le libellé est requis"),
  dateDebut: z.string().min(1, "La date de début est requise"),
  dateFin: z.string().min(1, "La date de fin est requise"),
});

export async function getAnneesScolaires() {
  const session = await auth();
  if (!session?.user?.tenantId) return [];

  const denied = checkPermission(session.user.role, "parametres:read");
  if (denied) return [];

  return prisma.anneesScolaires.findMany({
    where: { tenantId: session.user.tenantId },
    orderBy: { dateDebut: "desc" },
  });
}

export async function createAnneeScolaire(data: z.infer<typeof AnneeScolaireSchema>) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "parametres:write");
  if (denied) throw new Error("Accès refusé");

  const parsed = AnneeScolaireSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const v = parsed.data;
  const dateDebut = new Date(v.dateDebut);
  const dateFin = new Date(v.dateFin);

  if (dateFin <= dateDebut) {
    throw new Error("La date de fin doit être postérieure à la date de début");
  }

  const existing = await prisma.anneesScolaires.findFirst({
    where: { tenantId: session.user.tenantId, libelle: v.libelle },
  });
  if (existing) {
    throw new Error("Une année scolaire avec ce libellé existe déjà");
  }

  await prisma.anneesScolaires.create({
    data: {
      tenantId: session.user.tenantId,
      libelle: v.libelle,
      dateDebut,
      dateFin,
      isCurrent: false,
      // Sans période, aucun bulletin ne peut être généré : trois trimestres par défaut.
      periodes: { create: decouperEnTrimestres(dateDebut, dateFin) },
    },
  });

  revalidatePath("/parametres");
  return { success: true };
}

/**
 * Crée les trois trimestres de l'année courante quand elle n'en a aucune
 * (années créées avant que la création n'en génère).
 */
export async function creerPeriodesAnneeCourante() {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  // Les périodes conditionnent les bulletins : le chef d'établissement (bulletins:write)
  // peut les créer sans disposer de l'écriture sur le reste des paramètres.
  const peutCreer =
    roleHasPermission(session.user.role, "parametres:write") ||
    roleHasPermission(session.user.role, "bulletins:write");
  if (!peutCreer) throw new Error("Accès refusé");

  const annee = await prisma.anneesScolaires.findFirst({
    where: { tenantId: session.user.tenantId, isCurrent: true },
    include: { periodes: { select: { id: true } } },
  });
  if (!annee) throw new Error("Aucune année scolaire courante : activez d'abord une année.");
  if (annee.periodes.length > 0) throw new Error("Cette année a déjà des périodes.");

  await prisma.periode.createMany({
    data: decouperEnTrimestres(annee.dateDebut, annee.dateFin).map((p, i) => ({
      ...p,
      anneeId: annee.id,
      isCurrent: i === 0,
    })),
  });

  revalidatePath("/parametres");
  revalidatePath("/notes/bulletins");
  return { success: true };
}

export async function activateAnneeScolaire(anneeId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "parametres:write");
  if (denied) throw new Error("Accès refusé");

  const annee = await prisma.anneesScolaires.findFirst({
    where: { id: anneeId, tenantId: session.user.tenantId },
  });
  if (!annee) throw new Error("Année scolaire introuvable");

  await prisma.$transaction([
    prisma.anneesScolaires.updateMany({
      where: { tenantId: session.user.tenantId, isCurrent: true },
      data: { isCurrent: false },
    }),
    prisma.anneesScolaires.update({
      where: { id: anneeId },
      data: { isCurrent: true },
    }),
    prisma.tenant.update({
      where: { id: session.user.tenantId },
      data: { currentYear: annee.libelle },
    }),
  ]);

  revalidatePath("/parametres");
  return { success: true };
}

export async function deleteAnneeScolaire(anneeId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "parametres:write");
  if (denied) throw new Error("Accès refusé");

  const annee = await prisma.anneesScolaires.findFirst({
    where: { id: anneeId, tenantId: session.user.tenantId },
  });
  if (!annee) throw new Error("Année scolaire introuvable");
  if (annee.isCurrent) throw new Error("Impossible de supprimer l'année scolaire active");

  const hasPeriodes = await prisma.periode.count({
    where: { anneeId },
  });
  if (hasPeriodes > 0) {
    throw new Error("Impossible de supprimer une année scolaire liée à des périodes");
  }

  await prisma.anneesScolaires.delete({
    where: { id: anneeId },
  });

  revalidatePath("/parametres");
  return { success: true };
}

// ============================================================
// AFFECTATION DES ENSEIGNANTS — matières & classes
// ============================================================

/**
 * Récupère tous les enseignants du tenant avec leurs matières et affectations.
 * Utilisé par l'onglet d'affectation dans les paramètres.
 */
export async function getEnseignantsWithAffectations() {
  const session = await auth();
  if (!session?.user?.tenantId) return [];
  const denied = checkPermission(session.user.role, "enseignants:read");
  if (denied) return [];
  const siteFilter = siteFilterForModel("enseignant", session.user);
  return prisma.enseignant.findMany({
    where: { tenantId: session.user.tenantId, ...siteFilter },
    include: {
      user: { select: { id: true, name: true, email: true } },
      // eslint-disable-next-line ecolemiriam/require-site-filter -- affichage de TOUS les sites d'un enseignant déjà filtré par le where parent
      sites: { select: { site: { select: { id: true, nom: true } } } },
      matieres: { include: { matiere: { select: { id: true, nom: true, code: true } } } },
      // `classe` est une relation obligatoire : sous RLS, une classe d'un autre
      // site revient `null` et fait échouer toute la requête. On ne garde que
      // les affectations dont la classe est visible dans le contexte courant.
      affectations: {
        where: { classe: { tenantId: session.user.tenantId } },
        include: {
          classe: { select: { id: true, nom: true, niveau: true, structureId: true, structure: { select: { type: true } }, site: { select: { id: true, nom: true } } } },
          matiere: { select: { id: true, nom: true, code: true } },
        },
      },
    },
    orderBy: { user: { name: "asc" } },
  });
}

/**
 * Récupère les matières disponibles pour affectation.
 */
export async function getMatieresForAffectation() {
  const session = await auth();
  if (!session?.user?.tenantId) return [];
  const denied = checkPermission(session.user.role, "matieres:read");
  if (denied) return [];
  const siteFilter = siteFilterForModel("matiere", session.user);
  return prisma.matiere.findMany({
    where: { tenantId: session.user.tenantId, ...siteFilter },
    select: { id: true, nom: true, code: true, couleur: true },
    orderBy: { nom: "asc" },
  });
}

/**
 * Récupère les classes disponibles pour affectation.
 */
export async function getClassesForAffectation() {
  const session = await auth();
  if (!session?.user?.tenantId) return [];
  const denied = checkPermission(session.user.role, "classes:read");
  if (denied) return [];
  const siteFilter = siteFilterForModel("classe", session.user);
  return prisma.classe.findMany({
    where: mergeFilters(
      { tenantId: session.user.tenantId },
      siteFilter,
      anneeFilterForModel(
        "classe",
        await getAnneeCouranteLibelle(session.user.tenantId),
      ),
    ),
    select: {
      id: true, nom: true, niveau: true,
      structure: { select: { id: true, type: true, nom: true } },
      site: { select: { id: true, nom: true } },
    },
    orderBy: { nom: "asc" },
  });
}

/**
 * Affecte les matières à un enseignant (remplace la liste existante).
 * Oblligatoire pour les enseignants du collège/lycée.
 */
export async function assignEnseignantMatieres(enseignantId: string, matiereIds: string[]) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "enseignants:write");
  if (denied) throw new Error("Accès refusé");

  // Vérifier que l'enseignant appartient au tenant
  const ens = await prisma.enseignant.findFirst({
    where: {
      id: enseignantId,
      tenantId: session.user.tenantId,
      ...siteFilterForModel("enseignant", session.user),
    },
    select: { id: true },
  });
  if (!ens) throw new Error("Enseignant introuvable");

  // Valider que toutes les matières appartiennent au tenant
  if (matiereIds.length > 0) {
    const validMatieres = await prisma.matiere.findMany({
      where: {
        id: { in: matiereIds },
        tenantId: session.user.tenantId,
        ...siteFilterForModel("matiere", session.user),
      },
      select: { id: true },
    });
    if (validMatieres.length !== matiereIds.length) {
      throw new Error("Une ou plusieurs matières sont invalides");
    }
  }

  // Supprimer les anciennes associations
  await prisma.enseignantMatiere.deleteMany({
    where: { enseignantId, tenantId: session.user.tenantId },
  });

  // Créer les nouvelles
  if (matiereIds.length > 0) {
    await prisma.enseignantMatiere.createMany({
      data: matiereIds.map((matiereId) => ({
        tenantId: session.user.tenantId!,
        enseignantId,
        matiereId,
      })),
    });
  }

  revalidatePath("/parametres");
  return { success: true };
}

/**
 * Affecte un enseignant à une classe (+ matière optionnelle).
 * - Primaire : matiereId = null, 1 classe max
 * - Collège/Lycée : matiereId requis, multiples classes
 */
export async function assignEnseignantClasse(
  enseignantId: string,
  classeId: string,
  matiereId?: string
) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "enseignants:write");
  if (denied) throw new Error("Accès refusé");

  // Vérifier que l'enseignant appartient au tenant
  const ens = await prisma.enseignant.findFirst({
    where: {
      id: enseignantId,
      tenantId: session.user.tenantId,
      ...siteFilterForModel("enseignant", session.user),
    },
    select: { id: true },
  });
  if (!ens) throw new Error("Enseignant introuvable");

  // Vérifier que la classe appartient au tenant, au site et à l'année en cours
  const classe = await prisma.classe.findFirst({
    where: mergeFilters(
      { id: classeId, tenantId: session.user.tenantId },
      siteFilterForModel("classe", session.user),
      anneeFilterForModel(
        "classe",
        await getAnneeCouranteLibelle(session.user.tenantId),
      ),
    ),
    select: { id: true, niveau: true },
  });
  if (!classe) throw new Error("Classe introuvable");

  const isPrimaire = isNiveauPrimaire(classe.niveau);

  // Valider la matière si fournie
  if (matiereId) {
    const matiere = await prisma.matiere.findFirst({
      where: {
        id: matiereId,
        tenantId: session.user.tenantId,
        ...siteFilterForModel("matiere", session.user),
      },
      select: { id: true },
    });
    if (!matiere) throw new Error("Matière introuvable");
  }

  // Validation : primaire = 1 classe max, pas de matière
  if (isPrimaire) {
    const existing = await prisma.enseignantAffectation.count({
      where: { enseignantId, tenantId: session.user.tenantId },
    });
    if (existing > 0) {
      throw new Error("Un enseignant du primaire ne peut être affecté qu'à une seule classe");
    }
    if (matiereId) {
      throw new Error("Au primaire, l'enseignant enseigne toutes les matières (pas de matière spécifique)");
    }
  } else {
    // Collège/Lycée : matière obligatoire
    if (!matiereId) {
      throw new Error("La matière est obligatoire pour les classes de collège et lycée");
    }
    // Vérifier que l'enseignant a bien cette matière dans sa liste
    // eslint-disable-next-line ecolemiriam/require-tenant-id -- tenantId fourni par le caller (session.user.tenantId)
    const hasMatiere = await prisma.enseignantMatiere.findFirst({
      where: { enseignantId, matiereId },
    });
    if (!hasMatiere) {
      throw new Error("L'enseignant doit d'abord être lié à cette matière avant d'être affecté");
    }
  }

  // Éviter les doublons (unique sur [enseignantId, classeId, matiereId])
  // eslint-disable-next-line ecolemiriam/require-tenant-id -- tenantId fourni par le caller (session.user.tenantId)
  const existing = await prisma.enseignantAffectation.findFirst({
    where: { enseignantId, classeId, matiereId: matiereId ?? null },
  });
  if (existing) {
    throw new Error("Cette affectation existe déjà");
  }

  await prisma.enseignantAffectation.create({
    data: {
      tenantId: session.user.tenantId!,
      enseignantId,
      classeId,
      matiereId: matiereId || null,
    },
  });

  revalidatePath("/parametres");
  return { success: true };
}

/**
 * Supprime une affectation enseignant ↔ classe.
 */
export async function unassignEnseignantClasse(affectationId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "enseignants:write");
  if (denied) throw new Error("Accès refusé");

  const affectation = await prisma.enseignantAffectation.findFirst({
    where: {
      id: affectationId,
      tenantId: session.user.tenantId,
      ...siteFilterForModel("enseignant", session.user),
    },
  });
  if (!affectation) throw new Error("Affectation introuvable");

  await prisma.enseignantAffectation.delete({
    where: { id: affectationId },
  });

  revalidatePath("/parametres");
  return { success: true };
}

// ============================================================
// PERMISSIONS PERSONNALISÉES PAR UTILISATEUR
// ============================================================

export interface UserPermissionEntry {
  id: string;
  permission: string;
  mode: string; // "grant" ou "deny"
}

/**
 * Récupère les permissions personnalisées d'un utilisateur pour le tenant actif.
 */
export async function getUserPermissions(userId: string): Promise<UserPermissionEntry[]> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "parametres:write");
  if (denied) throw new Error("Privilèges insuffisants");

  return prisma.userPermission.findMany({
    where: { userId, tenantId: session.user.tenantId },
    select: { id: true, permission: true, mode: true },
    orderBy: { permission: "asc" },
  });
}

/**
 * Sauvegarde les permissions personnalisées d'un utilisateur.
 * - `grants` : permissions à accorder (au-delà du rôle)
 * - `denies` : permissions à retirer (en moins du rôle)
 * Les permissions non présentes dans ces listes sont supprimées (retour au rôle).
 */
export async function saveUserPermissions(
  userId: string,
  grants: string[],
  denies: string[]
): Promise<{ success: boolean }> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "parametres:write");
  if (denied) throw new Error("Privilèges insuffisants");

  const tenantId = session.user.tenantId;

  // Vérifier que l'utilisateur cible appartient bien à ce tenant
  // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId dans le where, site filter géré par le caller
  const targetUser = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    select: { id: true, role: true },
  });
  if (!targetUser) throw new Error("Utilisateur introuvable dans cet établissement");

  // SUPER_ADMIN n'est pas surchargeable
  if (targetUser.role === "SUPER_ADMIN") {
    throw new Error("Les permissions d'un super-admin ne sont pas modifiables");
  }

  // Supprimer toutes les permissions existantes pour cet user/tenant
  await prisma.userPermission.deleteMany({
    where: { userId, tenantId },
  });

  // Insérer les nouvelles permissions
  const allPerms = [
    ...grants.map((p) => ({ userId, tenantId, permission: p, mode: "grant" as const })),
    ...denies.map((p) => ({ userId, tenantId, permission: p, mode: "deny" as const })),
  ];

  if (allPerms.length > 0) {
    await prisma.userPermission.createMany({ data: allPerms });
  }

  // Invalider le cache des permissions pour cet utilisateur
  const { invalidateUserPermsCache } = await import("@/lib/rbac");
  invalidateUserPermsCache(userId, tenantId);

  // Audit log
  const { auditFire } = await import("@/lib/audit");
  auditFire({
    userId: session.user.id,
    tenantId,
    action: "user:permissions:update",
    verdict: "ALLOWED",
    resource: "user",
    resourceId: userId,
    metadata: { grants, denies },
  });

  revalidatePath("/parametres");
  return { success: true };
}

// ============================================================
// JOURNAL DES EMAILS TRANSACTIONNELS
// ============================================================

export async function getEmailLogs(filters?: {
  status?: string;
  type?: string;
  email?: string;
  limit?: number;
  offset?: number;
}) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "parametres:read");
  if (denied) throw new Error("Accès refusé");

  const where: Record<string, unknown> = {
    tenantId: session.user.tenantId,
  };
  if (filters?.status) where.status = filters.status;
  if (filters?.type) where.type = filters.type;
  if (filters?.email) where.email = { contains: filters.email, mode: "insensitive" };

  const limit = filters?.limit ?? 100;
  const offset = filters?.offset ?? 0;

  const [logs, total] = await Promise.all([
    prisma.emailLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        user: { select: { id: true, name: true, emailVerified: true } },
      },
    }),
    prisma.emailLog.count({ where }),
  ]);

  return { logs, total };
}

export async function getEmailStats() {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "parametres:read");
  if (denied) throw new Error("Accès refusé");

  const tenantId = session.user.tenantId;

  const [total, sent, delivered, bounced, failed, opened, complained] = await Promise.all([
    prisma.emailLog.count({ where: { tenantId } }),
    prisma.emailLog.count({ where: { tenantId, status: "SENT" } }),
    prisma.emailLog.count({ where: { tenantId, status: "DELIVERED" } }),
    prisma.emailLog.count({ where: { tenantId, status: "BOUNCED" } }),
    prisma.emailLog.count({ where: { tenantId, status: "FAILED" } }),
    prisma.emailLog.count({ where: { tenantId, status: "OPENED" } }),
    prisma.emailLog.count({ where: { tenantId, status: "COMPLAINED" } }),
  ]);

  return { total, sent, delivered, bounced, failed, opened, complained };
}

export async function resendVerificationEmail(userId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "parametres:write");
  if (denied) throw new Error("Accès refusé");

  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      tenantId: session.user.tenantId,
      ...siteFilterForModel("user", session.user),
    },
    select: { id: true, name: true, email: true, emailVerified: true },
  });
  if (!user) throw new Error("Utilisateur non trouvé");
  if (user.emailVerified) throw new Error("Cet email est déjà vérifié");

  const result = await sendVerificationEmail(
    user.email,
    user.name,
    undefined,
    true,
    undefined,
    { tenantId: session.user.tenantId, userId: user.id, createdBy: session.user.id }
  );

  if (!result.success) {
    return { success: false, error: result.error ?? "Échec d'envoi" };
  }

  revalidatePath("/parametres");
  return { success: true };
}

/**
 * Marque comme vérifiés les emails de comptes qui ne le sont pas encore.
 * ============================================================
 * Cas visé : les comptes **provisionnés par l'administration** (saisie directe,
 * import, création groupée) dont l'email n'a jamais été confirmé. Le garde-fou
 * de connexion (`authorize()` → « Email non vérifié ») leur refuse l'accès ;
 * sans cette action, l'administrateur n'avait aucun moyen de débloquer un
 * compte dont l'adresse est fiable — le renvoi d'email ne suffit pas quand la
 * boîte est inaccessible ou que le message n'arrive pas.
 *
 * Sécurité : permission `parametres:write`, périmètre tenant + sites de
 * l'appelant, et **seuls** les comptes dont `emailVerified` est nul sont
 * touchés (aucune régression possible sur un compte déjà vérifié). L'opération
 * est tracée (`user:email:verify`) avec la liste des adresses concernées.
 *
 * @param userIds comptes à traiter. Omis (ou vide) = tous les comptes non
 *                vérifiés du périmètre — c'est le bouton global de l'annuaire.
 */
export async function marquerEmailsVerifies(userIds?: string[]) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "parametres:write");
  if (denied) throw new Error("Accès refusé");

  const cibles = await prisma.user.findMany({
    where: {
      tenantId: session.user.tenantId,
      emailVerified: null,
      ...(userIds && userIds.length > 0 ? { id: { in: userIds } } : {}),
      ...siteFilterForModel("user", session.user),
    },
    select: { id: true, email: true },
  });

  if (cibles.length === 0) return { success: true, modified: 0 };

  await prisma.user.updateMany({
    where: { id: { in: cibles.map((c) => c.id) }, tenantId: session.user.tenantId },
    data: { emailVerified: new Date() },
  });

  const { auditFire } = await import("@/lib/audit");
  auditFire({
    userId: session.user.id,
    tenantId: session.user.tenantId,
    action: "user:email:verify",
    verdict: "ALLOWED",
    resource: "user",
    resourceId: cibles.length === 1 ? cibles[0].id : undefined,
    reason: `${cibles.length} email(s) marqué(s) vérifié(s) par l'administration`,
    metadata: { total: cibles.length, emails: cibles.map((c) => c.email).slice(0, 50) },
  });

  revalidatePath("/parametres");
  revalidateTag("dashboard-data", "max");
  return { success: true, modified: cibles.length };
}

