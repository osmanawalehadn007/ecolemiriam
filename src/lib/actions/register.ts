"use server";

// Ce parcours est PUBLIC (aucun contexte tenant) : il utilise exclusivement
// `prismaBase` (client sans RLS). Le client RLS `@/lib/prisma` lèverait
// « prisma-rls: contexte tenant manquant » sur `user.create`.
import prismaBase from "@/lib/prisma-base";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { sendVerificationEmail } from "@/lib/security/email-verification";
import { auditFire } from "@/lib/audit";
import { rateLimit } from "@/lib/security/rateLimit";
import { verifyTurnstileToken } from "@/lib/security/turnstile";

/**
 * Extrait l'IP du client depuis les headers de la requête courante
 * (server action). Même logique que `getClientIP` mais adaptée aux
 * server actions où l'objet Request n'est pas directement disponible.
 */
async function getActionIP(): Promise<string> {
  const h = await headers();
  const cfIP = h.get("cf-connecting-ip");
  if (cfIP && process.env.NODE_ENV === "production") return cfIP.trim();

  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const ip = forwarded.split(",")[0].trim();
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip) || /^[a-f0-9:]+$/i.test(ip)) {
      return ip;
    }
  }
  const real = h.get("x-real-ip");
  if (real) return real.trim();

  return "unknown";
}

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

  // Token Turnstile (anti-bot)
  turnstileToken: z.string().optional(),
});

export type RegisterFormData = z.infer<typeof RegisterSchema>;

export async function registerTenant(data: RegisterFormData) {
  // ── Rate limit : 3 inscriptions par heure par IP ──────────────────
  // Empêche la création massive de comptes par un bot depuis une même IP.
  const ip = await getActionIP();
  const rl = rateLimit({ max: 3, windowSec: 3600, key: `register:${ip}` });
  if (!rl.allowed) {
    throw new Error(
      "Trop de comptes créés depuis cette adresse. Réessayez dans 1 heure."
    );
  }

  // ── Vérification Turnstile (anti-bot) ──────────────────────────────
  // Si TURNSTILE_SECRET est configuré, le token doit être valide.
  // Mode dégradé : sans secret, la vérification est ignorée.
  const turnstileResult = await verifyTurnstileToken(
    data.turnstileToken ?? null,
    new Request("https://ecolemiriam.com/api/register", {
      headers: await headers() as Headers,
    })
  );
  if (!turnstileResult.success) {
    auditFire({
      action: "auth:register",
      verdict: "DENIED",
      resource: "user",
      reason: "Vérification Turnstile échouée",
      metadata: { ip, errorCodes: turnstileResult.errorCodes },
    });
    throw new Error("Vérification anti-bot échouée. Veuillez réessayer.");
  }

  const parsed = RegisterSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const values = parsed.data;

   
  const existingUser = await prismaBase.user.findFirst({
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

  const existingSlug = await prismaBase.tenant.findUnique({ where: { slug } });
  if (existingSlug) {
    throw new Error("Un établissement avec ce nom existe déjà");
  }

  const hashedPassword = await bcrypt.hash(values.adminPassword, 10);
  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 30);

  const tenant = await prismaBase.tenant.create({
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

  // ── Client SANS RLS : parcours public ──────────────────────────────
  // `/register` s'exécute AVANT toute authentification : aucun contexte tenant
  // n'existe, donc le client RLS lève « prisma-rls: contexte tenant manquant »
  // sur `user.create` — l'inscription publique renvoyait un 500 en production
  // (RLS_ACTIVE=true). Même correctif que pour l'acceptation d'invitation
  // (src/lib/actions/invitations.ts, PR #25). Aucune lecture cross-tenant
  // n'est faite ici : les contrôles d'unicité passent par prismaBase et la
  // création concerne un établissement neuf.
  const newUser = await prismaBase.user.create({
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
