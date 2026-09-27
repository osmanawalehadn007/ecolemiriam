"use server";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auditFire } from "@/lib/audit";
import { sendEmail } from "@/lib/notifications/email";
import {
  INVITABLE_ROLES,
  buildInvitationUrl,
  generateInvitationToken,
  hashInvitationToken,
  invitationExpiry,
  isInvitationExpired,
  renderInvitationEmail,
  validatePasswordStrength,
} from "@/lib/invitations";

/**
 * ============================================================
 * EcolPro — Invitations d'utilisateurs (server actions)
 * ============================================================
 *
 * Cycle de vie : `createInvitation` (admin) → email avec jeton → page publique
 * `/accept-invitation` → `acceptInvitation` (création/ rattachement du compte) →
 * le nouvel utilisateur se connecte avec le mot de passe qu'il a choisi.
 *
 * Robustesse :
 *  - jeton aléatoire 256 bits, stocké sous forme d'empreinte SHA-256 ;
 *  - usage unique garanti par une mise à jour conditionnelle (anti-course) ;
 *  - expiration (72 h) vérifiée à l'acceptation ;
 *  - une seule invitation PENDING par (tenant, email) ;
 *  - le mot de passe choisi doit respecter une politique minimale ;
 *  - tout est journalisé dans le journal d'audit.
 */

const EMAIL_RE = z.string().email("Email invalide");

const CreateInvitationSchema = z.object({
  email: EMAIL_RE,
  name: z.string().min(1, "Le nom est requis"),
  role: z.enum(INVITABLE_ROLES),
  phone: z.string().optional(),
  siteId: z.string().optional().nullable(),
});

export type CreateInvitationInput = z.infer<typeof CreateInvitationSchema>;

const AcceptInvitationSchema = z.object({
  token: z.string().min(16, "Lien d'invitation invalide"),
  name: z.string().optional(),
  password: z.string().min(1, "Le mot de passe est requis"),
});

export type AcceptInvitationInput = z.infer<typeof AcceptInvitationSchema>;

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Le mot de passe actuel est requis"),
  newPassword: z.string().min(1, "Le nouveau mot de passe est requis"),
});

/**
 * Vérifie que l'appelant administre bien l'établissement ciblé. Sans ce
 * contrôle, un admin de l'école A pourrait inviter des comptes dans l'école B
 * en forgeant `tenantId`.
 *
 * Deux chemins, dans cet ordre :
 *  1. adhésions `UserTenant` explicites (cas nominal, multi-tenant) ;
 *  2. compte « historique » sans aucune adhésion : repli sur le `tenantId`
 *     dénormalisé — MÊME logique que `deriveClaims`, sinon les comptes créés
 *     avant l'introduction de `UserTenant` seraient bloqués.
 */
async function assertCanManageTenant(
  session: { user?: { id?: string; role?: string; tenantId?: string | null } } | null,
  tenantId: string
): Promise<void> {
  if (!session?.user?.id) throw new InvitationError("Non autorisé");
  if (session.user.role === "SUPER_ADMIN") return;

  // Inventaire des adhésions de l'appelant — contrôle d'accès, pas lecture métier.
  // eslint-disable-next-line ecolemiriam/require-tenant-id
  const memberships = await prisma.userTenant.findMany({
    where: { userId: session.user.id, isActive: true },
    select: { tenantId: true, role: true },
  });

  if (memberships.length === 0) {
    const isManager =
      session.user.role === "TENANT_ADMIN" || session.user.role === "PRINCIPAL";
    if (isManager && session.user.tenantId === tenantId) return;
    throw new InvitationError("Vous n'administrez pas cet établissement");
  }

  const allowed = memberships.some(
    (m) =>
      m.tenantId === tenantId &&
      (m.role === "TENANT_ADMIN" || m.role === "PRINCIPAL")
  );
  if (!allowed) throw new InvitationError("Vous n'administrez pas cet établissement");
}

/** L'envoi d'email est-il réellement configuré (clé Resend présente) ? */
function isEmailConfigured(): boolean {
  const key = process.env.RESEND_API_KEY;
  return Boolean(key) && !key!.includes("xxxx");
}


/** Rendu + envoi de l'email d'invitation. Renvoie l'URL (utile si l'email
 *  n'est pas configuré : l'administrateur peut alors transmettre le lien). */
async function deliverInvitation(params: {
  tenantName: string;
  inviterName: string | null;
  email: string;
  role: string;
  token: string;
  expiresAt: Date;
}): Promise<{ emailSent: boolean; inviteUrl: string }> {
  const inviteUrl = buildInvitationUrl(params.token);
  const html = renderInvitationEmail({
    tenantName: params.tenantName,
    inviterName: params.inviterName,
    email: params.email,
    role: params.role,
    inviteUrl,
    expiresAt: params.expiresAt,
  });

  if (!isEmailConfigured()) {
    console.warn("[Invitation] RESEND_API_KEY absente — email non envoyé, lien retourné.");
    return { emailSent: false, inviteUrl };
  }

  const result = await sendEmail(
    [params.email],
    `Invitation à rejoindre ${params.tenantName} sur EcolPro`,
    html
  );
  return { emailSent: result.success, inviteUrl };
}

// ============================================================
// Émission / gestion des invitations (administration)
// ============================================================

async function createInvitationImpl(input: CreateInvitationInput) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new InvitationError("Non autorisé");

  const parsed = CreateInvitationSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvitationError(parsed.error.issues.map((i) => i.message).join(", "));
  }
  const v = parsed.data;
  const tenantId = session.user.tenantId;

  await assertCanManageTenant(session, tenantId);

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true },
  });
  if (!tenant) throw new InvitationError("Établissement introuvable");

  // Le site, s'il est fourni, doit appartenir au tenant.
  if (v.siteId) {
    const site = await prisma.site.findFirst({
      where: { id: v.siteId, tenantId },
      select: { id: true },
    });
    if (!site) throw new InvitationError("Site introuvable dans cet établissement");
  }

  // Refuser si le destinataire a déjà un accès actif à cet établissement.
  // La recherche par email est GLOBALE par conception : le compte peut déjà
  // exister dans un autre établissement (on ne s'intéresse qu'à l'existence).
  // eslint-disable-next-line ecolemiriam/require-tenant-id, ecolemiriam/require-site-filter
  const existingUser = await prisma.user.findUnique({
    where: { email: v.email },
    select: { id: true },
  });
  if (existingUser) {
    // eslint-disable-next-line ecolemiriam/require-tenant-id -- rattachement ciblé par sa clé (userId, tenantId)
    const activeMembership = await prisma.userTenant.findUnique({
      where: { userId_tenantId: { userId: existingUser.id, tenantId } },
      select: { isActive: true },
    });
    if (activeMembership?.isActive) {
      throw new InvitationError("Cet utilisateur a déjà accès à cet établissement");
    }
  }

  // Une seule invitation PENDING par (tenant, email) : on révoque les
  // précédentes pour éviter des jetons concurrents.
  await prisma.invitation.updateMany({
    where: { tenantId, email: v.email, status: "PENDING" },
    data: { status: "REVOKED", revokedAt: new Date() },
  });

  const { token, tokenHash } = generateInvitationToken();
  const expiresAt = invitationExpiry();

  const invitation = await prisma.invitation.create({
    data: {
      tenantId,
      siteId: v.siteId || null,
      email: v.email,
      name: v.name,
      role: v.role,
      phone: v.phone || null,
      tokenHash,
      expiresAt,
      invitedById: session.user.id ?? null,
    },
    select: { id: true },
  });

  const { emailSent, inviteUrl } = await deliverInvitation({
    tenantName: tenant.name,
    inviterName: session.user.name ?? null,
    email: v.email,
    role: v.role,
    token,
    expiresAt,
  });

  auditFire({
    tenantId,
    userId: session.user.id,
    action: "invitation:create",
    verdict: "ALLOWED",
    resource: "invitation",
    resourceId: invitation.id,
    metadata: { email: v.email, role: v.role, siteId: v.siteId ?? null, emailSent },
  });

  revalidatePath("/parametres");

  return {
    success: true as const,
    invitationId: invitation.id,
    emailSent,
    // Le lien n'est renvoyé que si l'email n'a pas pu être envoyé (clé Resend
    // absente) : l'admin peut alors le transmettre manuellement.
    inviteUrl: emailSent ? undefined : inviteUrl,
  };
}

async function resendInvitationImpl(invitationId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new InvitationError("Non autorisé");
  const tenantId = session.user.tenantId;
  await assertCanManageTenant(session, tenantId);

  const invitation = await prisma.invitation.findFirst({
    where: { id: invitationId, tenantId },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      tenant: { select: { name: true } },
    },
  });
  if (!invitation) throw new InvitationError("Invitation introuvable");
  if (invitation.status !== "PENDING") {
    throw new InvitationError("Seule une invitation en attente peut être renvoyée");
  }

  const { token, tokenHash } = generateInvitationToken();
  const expiresAt = invitationExpiry();

  await prisma.invitation.update({
    where: { id: invitation.id },
    data: { tokenHash, expiresAt },
  });

  const { emailSent, inviteUrl } = await deliverInvitation({
    tenantName: invitation.tenant.name,
    inviterName: session.user.name ?? null,
    email: invitation.email,
    role: invitation.role,
    token,
    expiresAt,
  });

  auditFire({
    tenantId,
    userId: session.user.id,
    action: "invitation:resend",
    verdict: "ALLOWED",
    resource: "invitation",
    resourceId: invitation.id,
    metadata: { email: invitation.email, emailSent },
  });

  revalidatePath("/parametres");
  return { success: true as const, emailSent, inviteUrl: emailSent ? undefined : inviteUrl };
}

async function revokeInvitationImpl(invitationId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new InvitationError("Non autorisé");
  const tenantId = session.user.tenantId;
  await assertCanManageTenant(session, tenantId);

  const invitation = await prisma.invitation.findFirst({
    where: { id: invitationId, tenantId },
    select: { id: true, status: true },
  });
  if (!invitation) throw new InvitationError("Invitation introuvable");
  if (invitation.status !== "PENDING") {
    throw new InvitationError("Cette invitation n'est plus en attente");
  }

  await prisma.invitation.update({
    where: { id: invitation.id },
    data: { status: "REVOKED", revokedAt: new Date() },
  });

  auditFire({
    tenantId,
    userId: session.user.id,
    action: "invitation:revoke",
    verdict: "ALLOWED",
    resource: "invitation",
    resourceId: invitation.id,
  });

  revalidatePath("/parametres");
  return { success: true as const };
}

export async function getTenantInvitations() {
  const session = await auth();
  if (!session?.user?.tenantId) return [];

  // eslint-disable-next-line ecolemiriam/require-site-filter -- liste administrative bornée au tenant courant
  const rows = await prisma.invitation.findMany({
    where: { tenantId: session.user.tenantId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      siteId: true,
    },
  });

  // Expiration calculée CÔTÉ SERVEUR : appeler `Date.now()` pendant le rendu
  // d'un composant client viole la règle de pureté React.
  const now = Date.now();
  return rows.map((row) => ({ ...row, isExpired: row.expiresAt.getTime() <= now }));
}


// ============================================================
// Acceptation (page publique, sans session)
// ============================================================

async function acceptInvitationImpl(input: AcceptInvitationInput) {
  const parsed = AcceptInvitationSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvitationError(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const passwordError = validatePasswordStrength(parsed.data.password);
  if (passwordError) throw new InvitationError(passwordError);

  const tokenHash = hashInvitationToken(parsed.data.token);

  // Lecture par empreinte de jeton : il n'y a pas encore de session.
  // eslint-disable-next-line ecolemiriam/require-tenant-id
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      tenantId: true,
      siteId: true,
      email: true,
      name: true,
      role: true,
      phone: true,
      status: true,
      expiresAt: true,
    },
  });

  if (!invitation) throw new InvitationError("Invitation introuvable ou déjà utilisée");
  if (invitation.status !== "PENDING") {
    throw new InvitationError("Cette invitation a déjà été utilisée ou annulée");
  }
  if (isInvitationExpired(invitation.expiresAt)) {
    throw new InvitationError("Cette invitation a expiré");
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const fallbackName = invitation.name?.trim() || invitation.email.split("@")[0];
  const name = parsed.data.name?.trim() || fallbackName;

  const { userId, isNewUser } = await prisma.$transaction(async (tx) => {
    // Consommation ATOMIQUE : seul un appel peut faire passer le statut de
    // PENDING à ACCEPTED. Deux acceptations concurrentes : la seconde échoue.
    const claimed = await tx.invitation.updateMany({
      where: { id: invitation.id, status: "PENDING" },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });
    if (claimed.count !== 1) throw new InvitationError("Cette invitation a déjà été utilisée");

    // Recherche globale par email (le compte peut déjà exister ailleurs).
    // eslint-disable-next-line ecolemiriam/require-tenant-id
    let user = await tx.user.findUnique({ where: { email: invitation.email } });
    let created = false;

    if (user) {
      const membership = await tx.userTenant.findUnique({
        where: { userId_tenantId: { userId: user.id, tenantId: invitation.tenantId } },
        select: { id: true, isActive: true },
      });
      if (membership?.isActive) {
        throw new InvitationError("Ce compte a déjà accès à cet établissement");
      }
      if (membership) {
        await tx.userTenant.update({
          where: { id: membership.id },
          data: { isActive: true, role: invitation.role },
        });
      } else {
        await tx.userTenant.create({
          data: {
            userId: user.id,
            tenantId: invitation.tenantId,
            role: invitation.role,
            isActive: true,
            isDefault: false,
          },
        });
      }
    } else {
      created = true;
      user = await tx.user.create({
        data: {
          tenantId: invitation.tenantId,
          siteId: invitation.siteId,
          email: invitation.email,
          name,
          password: passwordHash,
          phone: invitation.phone,
          role: invitation.role,
          isActive: true,
          // Le mot de passe a été choisi par l'utilisateur : pas de changement forcé.
          mustChangePassword: false,
          userTenants: {
            create: {
              tenantId: invitation.tenantId,
              role: invitation.role,
              isActive: true,
              isDefault: true,
            },
          },
        },
      });

      if (invitation.role === "TEACHER" || invitation.role === "CLASS_TEACHER") {
        await tx.enseignant.create({
          data: { tenantId: invitation.tenantId, userId: user.id, dateEntree: new Date() },
        });
      }

      if (invitation.role === "PARENT") {
        const [firstName, ...rest] = name.split(" ");
        await tx.parent.create({
          data: {
            tenantId: invitation.tenantId,
            userId: user.id,
            nom: rest.join(" ") || firstName,
            prenom: firstName,
            email: invitation.email,
            phone: invitation.phone ?? "",
          },
        });
      }
    }

    // Rattachement au site prévu par l'invitation (facultatif).
    if (invitation.siteId) {
      await tx.userSite.upsert({
        where: { userId_siteId: { userId: user.id, siteId: invitation.siteId } },
        create: { userId: user.id, siteId: invitation.siteId },
        update: {},
      });
      if (!user.siteId) {
        await tx.user.update({
          where: { id: user.id },
          data: { siteId: invitation.siteId },
        });
      }
    }

    await tx.invitation.update({
      where: { id: invitation.id },
      data: { acceptedByUserId: user.id },
    });

    return { userId: user.id, isNewUser: created };
  });

  auditFire({
    tenantId: invitation.tenantId,
    userId,
    action: "invitation:accept",
    verdict: "ALLOWED",
    resource: "invitation",
    resourceId: invitation.id,
    metadata: { isNewUser },
  });

  return { success: true as const };
}

// ============================================================
// Changement de mot de passe (compte connecté)
// ============================================================

async function changePasswordImpl(input: {
  currentPassword: string;
  newPassword: string;
}) {
  const session = await auth();
  if (!session?.user?.id) throw new InvitationError("Non autorisé");

  const parsed = ChangePasswordSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvitationError(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const policyError = validatePasswordStrength(parsed.data.newPassword);
  if (policyError) throw new InvitationError(policyError);
  if (parsed.data.currentPassword === parsed.data.newPassword) {
    throw new InvitationError("Le nouveau mot de passe doit être différent de l'actuel");
  }

  // eslint-disable-next-line ecolemiriam/require-tenant-id, ecolemiriam/require-site-filter -- le compte est identifié par la session
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, password: true },
  });
  if (!user?.password) throw new InvitationError("Ce compte n'a pas de mot de passe local");

  const matches = await bcrypt.compare(parsed.data.currentPassword, user.password);
  if (!matches) {
    auditFire({
      tenantId: session.user.tenantId,
      userId: user.id,
      action: "auth:change-password",
      verdict: "DENIED",
      reason: "Mot de passe actuel incorrect",
    });
    throw new InvitationError("Mot de passe actuel incorrect");
  }

  const hash = await bcrypt.hash(parsed.data.newPassword, 12);
  // eslint-disable-next-line ecolemiriam/require-tenant-id, ecolemiriam/require-site-filter -- compte de la session, mot de passe actuel vérifié juste au-dessus
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hash, mustChangePassword: false },
  });

  auditFire({
    tenantId: session.user.tenantId,
    userId: user.id,
    action: "auth:change-password",
    verdict: "ALLOWED",
  });

  return { success: true as const };
}

// ============================================================
// Frontière public / erreurs typées
// ============================================================
//
// Les server actions renvoient un RÉSULTAT TYPÉ pour les erreurs attendues
// (validation, jeton invalide, permissions…). On ne compte pas sur le message
// d'une exception propagée au client : en production, Next.js remplace le
// message des erreurs levées dans une server action par une chaîne générique
// (seul un `digest` est transmis) — l'utilisateur verrait une erreur opaque.

/** Erreur métier « attendue » : son message est présentable à l'utilisateur. */
class InvitationError extends Error {}

function toFailure(error: unknown): { success: false; error: string } {
  if (error instanceof InvitationError) {
    return { success: false, error: error.message };
  }
  console.error("[Invitation] Erreur inattendue:", error);
  return {
    success: false,
    error: "Une erreur inattendue est survenue. Veuillez réessayer.",
  };
}

export async function createInvitation(input: CreateInvitationInput) {
  try {
    return await createInvitationImpl(input);
  } catch (error) {
    return toFailure(error);
  }
}

export async function resendInvitation(invitationId: string) {
  try {
    return await resendInvitationImpl(invitationId);
  } catch (error) {
    return toFailure(error);
  }
}

export async function revokeInvitation(invitationId: string) {
  try {
    return await revokeInvitationImpl(invitationId);
  } catch (error) {
    return toFailure(error);
  }
}

export async function acceptInvitation(input: AcceptInvitationInput) {
  try {
    return await acceptInvitationImpl(input);
  } catch (error) {
    return toFailure(error);
  }
}

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}) {
  try {
    return await changePasswordImpl(input);
  } catch (error) {
    return toFailure(error);
  }
}


