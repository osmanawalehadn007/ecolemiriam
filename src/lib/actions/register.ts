"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { sendVerificationEmail } from "@/lib/security/email-verification";
import { auditFire } from "@/lib/audit";

const RegisterSchema = z.object({
  // Établissement
  schoolName: z.string().min(2, "Le nom de l'établissement est requis"),
  schoolType: z.enum(["maternelle", "primaire", "college", "lycee", "mixte"]),
  country: z.string().default("SN"),
  city: z.string().min(1, "La ville est requise"),
  address: z.string().optional(),
  phone: z.string().min(1, "Le téléphone est requis"),
  email: z.string().email("Email invalide"),

  // Administrateur
  adminFirstName: z.string().min(1, "Le prénom est requis"),
  adminLastName: z.string().min(1, "Le nom est requis"),
  adminEmail: z.string().email("Email administrateur invalide"),
  adminPassword: z.string().min(8, "Le mot de passe doit faire au moins 8 caractères"),
  adminPhone: z.string().optional(),

  // Plan
  plan: z.enum(["STARTER", "PRO", "BUSINESS", "ENTERPRISE"]).default("STARTER"),
});

export type RegisterFormData = z.infer<typeof RegisterSchema>;

export async function registerTenant(data: RegisterFormData) {
  const parsed = RegisterSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const values = parsed.data;

  // eslint-disable-next-line ecolemiriam/require-tenant-id, ecolemiriam/require-site-filter -- inscription publique, pas de session/tenant : vérification d'unicité email globale
  const existingUser = await prisma.user.findFirst({
    where: { email: { equals: values.adminEmail, mode: "insensitive" } },
  });
  if (existingUser) {
    throw new Error("Un compte existe déjà avec cet email administrateur");
  }

  const slug = values.schoolName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const existingSlug = await prisma.tenant.findUnique({ where: { slug } });
  if (existingSlug) {
    throw new Error("Un établissement avec ce nom existe déjà");
  }

  const hashedPassword = await bcrypt.hash(values.adminPassword, 10);
  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 30);

  const tenant = await prisma.tenant.create({
    data: {
      name: values.schoolName,
      slug,
      plan: values.plan,
      status: "TRIAL",
      trialEndsAt,
      address: values.address || null,
      city: values.city,
      country: values.country,
      phone: values.phone,
      email: values.email,
    },
  });

  const newUser = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: values.adminEmail,
      name: `${values.adminFirstName} ${values.adminLastName}`,
      firstName: values.adminFirstName,
      lastName: values.adminLastName,
      password: hashedPassword,
      phone: values.adminPhone || null,
      role: "TENANT_ADMIN",
      isActive: true,
      // emailVerified est null à la création — l'utilisateur doit vérifier son email
      // Créer l'entrée UserTenant pour le multi-tenant
      userTenants: {
        create: {
          tenantId: tenant.id,
          role: "TENANT_ADMIN",
          isActive: true,
          isDefault: true,
        },
      },
    },
  });

  // ── Envoi de l'email de vérification ──────────────────────────────
  // Ne pas bloquer l'inscription si l'envoi échoue : l'utilisateur peut
  // redemander l'email depuis la page de connexion.
  try {
    const verifyResult = await sendVerificationEmail(
      values.adminEmail,
      `${values.adminFirstName} ${values.adminLastName}`,
      values.schoolName,
      false,
      values.adminPassword // mot de passe choisi à l'inscription, inclus dans l'email
    );
    if (!verifyResult.success) {
      console.warn("[registerTenant] Échec envoi email de vérification:", verifyResult.error);
    }
    auditFire({
      userId: newUser.id,
      action: "auth:register",
      verdict: "ALLOWED",
      resource: "user",
      resourceId: newUser.id,
      reason: verifyResult.success
        ? "Inscription + email de vérification envoyé"
        : "Inscription OK mais échec envoi email vérification",
      metadata: { email: values.adminEmail, tenantSlug: slug },
    });
  } catch (err) {
    console.warn("[registerTenant] Erreur envoi email de vérification:", err);
  }

  revalidatePath("/");
  return { success: true, slug: tenant.slug };
}
