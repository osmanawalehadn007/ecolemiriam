import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================
// Système d'invitation — tests d'intégration des server actions
// ============================================================
//
// Parcours vérifié de bout en bout (au niveau des actions) :
//
//   invitation (admin)  →  création / rattachement du compte
//                       →  acceptation (le mot de passe stocké authentifie)
//                       →  révocation de l'accès
//
// L'« acceptation » n'est pas un lien à token dans le code actuel : le compte
// est créé avec un mot de passe (fourni ou temporaire par défaut) et
// l'utilisateur l'accepte en se connectant. On vérifie donc que le hash stocké
// correspond bien au mot de passe annoncé — c'est exactement ce que fait
// `authorize()` dans `src/lib/auth.ts` (bcrypt.compare).

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    userTenant: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    tenant: { findUnique: vi.fn(), create: vi.fn() },
    enseignant: { create: vi.fn() },
    parent: { create: vi.fn() },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { registerTenant } from "@/lib/actions/register";
import { createUser } from "@/lib/actions/parametres";
import { addUserToTenant, removeUserFromTenant } from "@/lib/actions/user-tenant";

const mockAuth = auth as unknown as { mockResolvedValue: (v: unknown) => void };
const mockPrisma = prisma as unknown as {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  userTenant: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  tenant: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  enseignant: { create: ReturnType<typeof vi.fn> };
  parent: { create: ReturnType<typeof vi.fn> };
};

/** Session d'un TENANT_ADMIN en vue « tous les sites » (aucun filtre de site). */
function adminSession(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      id: "admin-1",
      tenantId: "tenant-A",
      name: "Admin A",
      role: "TENANT_ADMIN",
      siteId: null,
      siteIds: [],
      tenantHasSites: false,
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(adminSession());
  mockPrisma.enseignant.create.mockResolvedValue({ id: "ens-1" });
  mockPrisma.parent.create.mockResolvedValue({ id: "parent-1" });
  mockPrisma.user.create.mockImplementation(async ({ data }: { data: { email: string } }) => ({
    id: `user-${data.email}`,
    email: data.email,
  }));
});


// ============================================================
// 1. Création de compte publique (`/register` → registerTenant)
// ============================================================

describe("registerTenant — création de l'établissement et du compte admin", () => {
  const payload = {
    schoolName: "École Miriam Test",
    schoolType: "mixte" as const,
    country: "SN",
    city: "Dakar",
    address: "Rue 1",
    phone: "+221770000000",
    email: "contact@ecole-miriam.sn",
    adminFirstName: "Awa",
    adminLastName: "Diop",
    adminEmail: "awa.diop@ecole-miriam.sn",
    adminPassword: "MotDePasse2026!",
    adminPhone: "+221780000000",
    plan: "STARTER" as const,
  };

  it("crée le tenant (essai 30 jours), l'admin TENANT_ADMIN et son rattachement", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.tenant.findUnique.mockResolvedValue(null);
    mockPrisma.tenant.create.mockResolvedValue({ id: "tenant-new", slug: "ecole-miriam-test" });
    mockPrisma.user.create.mockResolvedValue({ id: "user-admin-new" });

    const result = await registerTenant(payload);

    expect(result).toEqual({ success: true, slug: "ecole-miriam-test" });

    const tenantData = mockPrisma.tenant.create.mock.calls[0][0].data;
    expect(tenantData).toMatchObject({
      name: "École Miriam Test",
      slug: "ecole-miriam-test",
      plan: "STARTER",
      status: "TRIAL",
      city: "Dakar",
    });
    expect(tenantData.trialEndsAt).toBeInstanceOf(Date);

    const userData = mockPrisma.user.create.mock.calls[0][0].data;
    expect(userData).toMatchObject({
      tenantId: "tenant-new",
      email: "awa.diop@ecole-miriam.sn",
      name: "Awa Diop",
      firstName: "Awa",
      lastName: "Diop",
      role: "TENANT_ADMIN",
      isActive: true,
    });
    expect(userData.userTenants.create).toMatchObject({
      tenantId: "tenant-new",
      role: "TENANT_ADMIN",
      isActive: true,
      isDefault: true,
    });

    // ACCEPTATION : le hash stocké authentifie le mot de passe choisi.
    const hash = userData.password as string;
    expect(hash).not.toBe(payload.adminPassword);
    await expect(bcrypt.compare(payload.adminPassword, hash)).resolves.toBe(true);
  });

  it("refuse un email administrateur déjà utilisé (unicité globale)", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "existing" });

    await expect(registerTenant(payload)).rejects.toThrow(
      "Un compte existe déjà avec cet email administrateur"
    );
    expect(mockPrisma.tenant.create).not.toHaveBeenCalled();
  });

  it("refuse un nom d'établissement déjà pris (slug unique)", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: "tenant-existant" });

    await expect(registerTenant(payload)).rejects.toThrow(
      "Un établissement avec ce nom existe déjà"
    );
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });
});

// ============================================================
// 2. Invitation d'un utilisateur par l'admin (Paramètres → Utilisateurs)
// ============================================================

describe("createUser — l'admin invite un utilisateur dans son établissement", () => {
  const invite = {
    name: "Moussa Ndiaye",
    email: "moussa.ndiaye@lycee-demo.ecolpro.app",
    role: "TEACHER" as const,
    phone: "+221770000001",
    password: "",
    isActive: true,
  };

  it("crée le compte, son rattachement UserTenant et la fiche Enseignant", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const result = await createUser(invite);

    expect(result).toEqual({ success: true, userId: "user-moussa.ndiaye@lycee-demo.ecolpro.app" });

    const data = mockPrisma.user.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      tenantId: "tenant-A",
      email: invite.email,
      name: "Moussa Ndiaye",
      role: "TEACHER",
      phone: invite.phone,
      isActive: true,
    });
    expect(data.userTenants.create).toMatchObject({
      tenantId: "tenant-A",
      role: "TEACHER",
      isActive: true,
      isDefault: true,
    });

    // Un enseignant obtient automatiquement sa fiche métier.
    expect(mockPrisma.enseignant.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.enseignant.create.mock.calls[0][0].data).toMatchObject({
      tenantId: "tenant-A",
      userId: result.userId,
    });
    expect(mockPrisma.parent.create).not.toHaveBeenCalled();
  });

  it("utilise le mot de passe fourni : il authentifie ensuite (acceptation)", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await createUser({ ...invite, password: "SuperSecret2026!" });

    const hash = mockPrisma.user.create.mock.calls[0][0].data.password as string;
    expect(hash).not.toBe("SuperSecret2026!");
    await expect(bcrypt.compare("SuperSecret2026!", hash)).resolves.toBe(true);
  });

  it("sans mot de passe, applique le mot de passe temporaire par défaut", async () => {
    // Comportement actuel : un mot de passe temporaire commun est appliqué et
    // il authentifie effectivement le compte (voir note de sécurité plus bas).
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await createUser(invite);

    const hash = mockPrisma.user.create.mock.calls[0][0].data.password as string;
    await expect(bcrypt.compare("EcolPro2026!", hash)).resolves.toBe(true);
  });

  it("crée aussi la fiche Parent pour un rôle PARENT", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await createUser({ ...invite, role: "PARENT", name: "Fatou Fall" });

    expect(mockPrisma.parent.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.parent.create.mock.calls[0][0].data).toMatchObject({
      tenantId: "tenant-A",
      nom: "Fall",
      prenom: "Fatou",
      email: invite.email,
    });
    expect(mockPrisma.enseignant.create).not.toHaveBeenCalled();
  });

  it("refuse un email déjà utilisé", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "existant" });

    await expect(createUser(invite)).rejects.toThrow(
      "Un utilisateur avec cet email existe déjà"
    );
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("refuse un rôle non autorisé (enseignant non administrateur)", async () => {
    mockAuth.mockResolvedValue(adminSession({ role: "TEACHER" }));

    await expect(createUser(invite)).rejects.toThrow("Permissions insuffisantes");
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("refuse sans session", async () => {
    mockAuth.mockResolvedValue(null);

    await expect(createUser(invite)).rejects.toThrow("Non autorisé");
  });
});


// ============================================================
// 3. Rattachement inter-établissements (`addUserToTenant`)
// ============================================================

describe("addUserToTenant — inviter un utilisateur vers un autre établissement", () => {
  const params = { email: "prof@ecole.com", tenantId: "tenant-B", role: "TEACHER" as const };

  beforeEach(() => {
    // Par défaut l'admin COURANT administre bien le tenant cible.
    mockPrisma.userTenant.findFirst.mockResolvedValue({ id: "ut-admin" });
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: "tenant-B", name: "École B" });
  });

  it("rattache un utilisateur existant sans créer de nouveau compte", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user-existant", name: "Prof Existant", password: "hash" });
    mockPrisma.userTenant.findUnique.mockResolvedValue(null);

    const result = await addUserToTenant(params);

    expect(result).toEqual({ success: true, message: "Prof Existant ajouté à École B" });
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    expect(mockPrisma.userTenant.create).toHaveBeenCalledWith({
      data: {
        userId: "user-existant",
        tenantId: "tenant-B",
        role: "TEACHER",
        isActive: true,
        isDefault: false,
      },
    });
  });

  it("crée un nouveau compte avec mot de passe temporaire si l'email est inconnu", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const result = await addUserToTenant(params);

    expect(result.success).toBe(true);
    expect(result.message).toContain("École B");
    expect(result.message).toContain("EcolPro2026!");

    const data = mockPrisma.user.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      email: "prof@ecole.com",
      tenantId: "tenant-B",
      role: "TEACHER",
      isActive: true,
    });
    // ACCEPTATION : le mot de passe temporaire annoncé authentifie le compte.
    await expect(bcrypt.compare("EcolPro2026!", data.password as string)).resolves.toBe(true);
  });

  it("réactive un rattachement désactivé au lieu d'en créer un doublon", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user-existant", name: "Prof Existant", password: "hash" });
    mockPrisma.userTenant.findUnique.mockResolvedValue({ id: "ut-1", isActive: false });

    const result = await addUserToTenant(params);

    expect(result).toEqual({ success: true, message: "Accès réactivé pour Prof Existant" });
    expect(mockPrisma.userTenant.update).toHaveBeenCalledWith({
      where: { id: "ut-1" },
      data: { isActive: true, role: "TEACHER" },
    });
    expect(mockPrisma.userTenant.create).not.toHaveBeenCalled();
  });

  it("refuse si l'utilisateur a déjà un accès actif à cet établissement", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user-existant", name: "Prof Existant", password: "hash" });
    mockPrisma.userTenant.findUnique.mockResolvedValue({ id: "ut-1", isActive: true });

    await expect(addUserToTenant(params)).rejects.toThrow(
      "Cet utilisateur a déjà accès à cet établissement"
    );
  });

  it("refuse si l'établissement cible est introuvable", async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null);

    await expect(addUserToTenant(params)).rejects.toThrow("Établissement introuvable");
  });

  it("refuse à un admin de rattacher un utilisateur à un établissement qu'il n'administre pas", async () => {
    mockPrisma.userTenant.findFirst.mockResolvedValue(null);

    await expect(addUserToTenant(params)).rejects.toThrow(
      "Vous n'administrez pas cet établissement"
    );
    expect(mockPrisma.userTenant.create).not.toHaveBeenCalled();
  });

  it("un SUPER_ADMIN n'a pas besoin d'administrer le tenant cible", async () => {
    mockAuth.mockResolvedValue(adminSession({ role: "SUPER_ADMIN" }));
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user-existant", name: "Prof Existant", password: "hash" });
    mockPrisma.userTenant.findUnique.mockResolvedValue(null);

    await expect(addUserToTenant(params)).resolves.toEqual({
      success: true,
      message: "Prof Existant ajouté à École B",
    });
    expect(mockPrisma.userTenant.findFirst).not.toHaveBeenCalled();
  });
});


// ============================================================
// 4. Révocation de l'accès (`removeUserFromTenant`)
// ============================================================

describe("removeUserFromTenant — révoquer l'accès d'un utilisateur", () => {
  beforeEach(() => {
    mockPrisma.userTenant.findFirst.mockResolvedValue({ id: "ut-admin" });
  });

  it("désactive le rattachement (soft delete, aucune suppression de compte)", async () => {
    mockPrisma.userTenant.findUnique.mockResolvedValue({ id: "ut-1", isActive: true });

    const result = await removeUserFromTenant("user-2", "tenant-A");

    expect(result).toEqual({ success: true, message: "Accès retiré" });
    expect(mockPrisma.userTenant.update).toHaveBeenCalledWith({
      where: { id: "ut-1" },
      data: { isActive: false },
    });
  });

  it("refuse que l'administrateur se retire lui-même", async () => {
    await expect(removeUserFromTenant("admin-1", "tenant-A")).rejects.toThrow(
      "Vous ne pouvez pas vous retirer vous-même"
    );
  });

  it("refuse un rattachement inexistant", async () => {
    mockPrisma.userTenant.findUnique.mockResolvedValue(null);

    await expect(removeUserFromTenant("user-2", "tenant-A")).rejects.toThrow(
      "Cet utilisateur n'a pas accès à cet établissement"
    );
  });

  it("refuse à un admin de révoquer un accès sur un établissement qu'il n'administre pas", async () => {
    mockPrisma.userTenant.findFirst.mockResolvedValue(null);

    await expect(removeUserFromTenant("user-2", "tenant-B")).rejects.toThrow(
      "Vous n'administrez pas cet établissement"
    );
    expect(mockPrisma.userTenant.update).not.toHaveBeenCalled();
  });
});

