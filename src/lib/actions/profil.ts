"use server";

import { auth } from "@/lib/auth";
import prismaBase from "@/lib/prisma-base";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { validatePasswordStrength } from "@/lib/security/password";
import { auditFire } from "@/lib/audit";

// ─── Schémas ──────────────────────────────────────────────────────────────

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Mot de passe actuel requis"),
  newPassword: z.string().min(1, "Nouveau mot de passe requis"),
  confirmPassword: z.string().min(1, "Confirmation requise"),
});

const UpdateProfileSchema = z.object({
  name: z.string().min(1, "Nom requis").max(100),
  firstName: z.string().max(50).optional().nullable(),
  lastName: z.string().max(50).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  avatarUrl: z.string().url().optional().nullable(),
  langue: z.enum(["fr", "en", "so"]).optional(),
  notifications: z
    .object({
      email: z.boolean().optional(),
      sms: z.boolean().optional(),
      push: z.boolean().optional(),
    })
    .optional(),
});

// ─── Changer le mot de passe ──────────────────────────────────────────────

export async function changePassword(data: z.infer<typeof ChangePasswordSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Non authentifié");

  const parsed = ChangePasswordSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }

  const { currentPassword, newPassword, confirmPassword } = parsed.data;

  if (newPassword !== confirmPassword) {
    return { success: false, error: "Les nouveaux mots de passe ne correspondent pas" };
  }

  const strengthError = validatePasswordStrength(newPassword);
  if (strengthError) {
    return { success: false, error: strengthError };
  }

  // Récupérer le mot de passe actuel hashé
  const user = await prismaBase.user.findUnique({
    where: { id: session.user.id },
    select: { password: true, email: true },
  });

  if (!user?.password) {
    return { success: false, error: "Aucun mot de passe défini sur ce compte" };
  }

  // Vérifier le mot de passe actuel
  const isValid = await bcrypt.compare(currentPassword, user.password);
  if (!isValid) {
    return { success: false, error: "Mot de passe actuel incorrect" };
  }

  // Vérifier que le nouveau mot de passe est différent
  const isSame = await bcrypt.compare(newPassword, user.password);
  if (isSame) {
    return { success: false, error: "Le nouveau mot de passe doit être différent de l'actuel" };
  }

  // Hasher et sauvegarder
  const hashed = await bcrypt.hash(newPassword, 12);
  await prismaBase.user.update({
    where: { id: session.user.id },
    data: { password: hashed },
  });

  auditFire({
    userId: session.user.id,
    action: "auth:change-password",
    verdict: "ALLOWED",
    reason: "Mot de passe modifié par l'utilisateur",
  });

  revalidatePath("/profil");
  return { success: true };
}

// ─── Mettre à jour le profil ──────────────────────────────────────────────

export async function updateProfile(data: z.infer<typeof UpdateProfileSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Non authentifié");

  const parsed = UpdateProfileSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }

  const v = parsed.data;

  await prismaBase.user.update({
    where: { id: session.user.id },
    data: {
      name: v.name,
      firstName: v.firstName ?? null,
      lastName: v.lastName ?? null,
      phone: v.phone ?? null,
      avatarUrl: v.avatarUrl ?? null,
      langue: v.langue ?? undefined,
      notifications: v.notifications ?? undefined,
    },
  });

  auditFire({
    userId: session.user.id,
    action: "user:update-profile",
    verdict: "ALLOWED",
    reason: "Profil mis à jour par l'utilisateur",
  });

  revalidatePath("/profil");
  revalidatePath("/(dashboard)", "layout");
  return { success: true };
}

// ─── Récupérer les détails du profil ──────────────────────────────────────

export async function getProfileDetails() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const user = await prismaBase.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      firstName: true,
      lastName: true,
      avatarUrl: true,
      phone: true,
      role: true,
      emailVerified: true,
      mfaEnabled: true,
      langue: true,
      locale: true,
      notifications: true,
      lastLoginAt: true,
      createdAt: true,
      tenant: { select: { name: true } },
      site: { select: { nom: true } },
    },
  });

  return user;
}
