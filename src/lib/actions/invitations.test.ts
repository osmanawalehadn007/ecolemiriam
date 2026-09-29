import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================
// Invitations — tests d'intégration des server actions
// ============================================================
//
// Cycle vérifié : émission (admin) → email/jeton → acceptation (création ou
// rattachement du compte) → révocation. Le jeton n'existe qu'en clair dans le
// lien : on vérifie systématiquement que l'empreinte stockée correspond.

const mocks = vi.hoisted(() => {
  const model = () => ({
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
  });

  const tx = {
    invitation: model(),
    user: model(),
    userTenant: model(),
    userSite: model(),
    enseignant: { create: vi.fn(), findFirst: vi.fn() },
    enseignantSite: model(),
    parent: { create: vi.fn() },
  };

  const prisma = {
    tenant: model(),
    site: model(),
    user: model(),
    userTenant: model(),
    invitation: model(),
    enseignant: { create: vi.fn() },
    parent: { create: vi.fn() },
    $transaction: vi.fn(),
  };

  return { tx, prisma };
});

// Le module d'invitations utilise le client SANS RLS (prisma-base) : la page
// publique et l'acceptation s'exécutent hors session. Le mock porte donc sur
// `@/lib/prisma-base`.
vi.mock("@/lib/prisma-base", () => ({ default: mocks.prisma }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/audit", () => ({ auditFire: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/notifications/email", () => ({ sendEmail: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { sendEmail } from "@/lib/notifications/email";
import { generateInvitationToken, hashInvitationToken } from "@/lib/invitations";
import {
  acceptInvitation,
  changePassword,
  createInvitation,
  resendInvitation,
  revokeInvitation,
} from "@/lib/actions/invitations";

type Mock = ReturnType<typeof vi.fn>;

const mockAuth = auth as unknown as { mockResolvedValue: (v: unknown) => void };
const mockSendEmail = sendEmail as unknown as Mock;
const p = mocks.prisma as unknown as Record<string, Record<string, Mock> | Mock>;
const tx = mocks.tx as unknown as Record<string, Record<string, Mock>>;

function adminSession(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      id: "admin-1",
      tenantId: "tenant-A",
      name: "Admin A",
      role: "TENANT_ADMIN",
      // Positionné sur un site précis : c'est lui que reçoit l'invité.
      siteId: "site-1",
      siteIds: [],
      tenantHasSites: true,
      ...overrides,
    },
  };
}

const INVITE_URL = "http://localhost:3001/accept-invitation";
const FUTURE = new Date(Date.now() + 60 * 60 * 1000);
const PAST = new Date(Date.now() - 60 * 60 * 1000);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.RESEND_API_KEY;
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";

  mockAuth.mockResolvedValue(adminSession());
  mockSendEmail.mockResolvedValue({ success: true, sent: 1 });

  // Appelant administrateur du tenant + tenant cible.
  (p.userTenant as Record<string, Mock>).findFirst.mockResolvedValue({ id: "ut-admin" });
  (p.userTenant as Record<string, Mock>).findMany.mockResolvedValue([
    { tenantId: "tenant-A", role: "TENANT_ADMIN" },
  ]);
  (p.tenant as Record<string, Mock>).findUnique.mockResolvedValue({
    id: "tenant-A",
    name: "École A",
  });
  (p.site as Record<string, Mock>).findFirst.mockResolvedValue({ id: "site-1" });
  (p.invitation as Record<string, Mock>).create.mockResolvedValue({ id: "inv-1" });
  (p.invitation as Record<string, Mock>).updateMany.mockResolvedValue({ count: 0 });
  (p.invitation as Record<string, Mock>).update.mockResolvedValue({ id: "inv-1" });
  (p.user as Record<string, Mock>).findUnique.mockResolvedValue(null);

  // Transactionnel : exécute le callback avec le mock `tx`.
  (p.$transaction as Mock).mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
  tx.invitation.updateMany.mockResolvedValue({ count: 1 });
  tx.invitation.update.mockResolvedValue({ id: "inv-1" });
});

const models = {
  invitation: p.invitation as Record<string, Mock>,
  user: p.user as Record<string, Mock>,
  userTenant: p.userTenant as Record<string, Mock>,
  site: p.site as Record<string, Mock>,
  tenant: p.tenant as Record<string, Mock>,
  $transaction: p.$transaction as Mock,
};

// ============================================================
// 1. Émission d'une invitation
// ============================================================

describe("createInvitation", () => {
  const input = { email: "prof@ecolemiriam.app", name: "Prof Test", role: "TEACHER" as const };

  it("crée l'invitation et le lien dont le jeton correspond à l'empreinte stockée", async () => {
    const result = await createInvitation(input);
    if (!result.success) throw new Error(result.error);

    // Resend non configuré ⇒ pas d'email, mais lien de secours renvoyé.
    expect(result.emailSent).toBe(false);
    const url = result.inviteUrl as string;
    expect(url.startsWith(INVITE_URL)).toBe(true);

    const data = models.invitation.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      tenantId: "tenant-A",
      email: "prof@ecolemiriam.app",
      role: "TEACHER",
      name: "Prof Test",
    });
    expect((data.expiresAt as Date).getTime()).toBeGreaterThan(Date.now());

    // Le jeton du lien, une fois haché, EST l'empreinte persistée.
    const token = new URL(url).searchParams.get("token") as string;
    expect(hashInvitationToken(token)).toBe(data.tokenHash);

    // Une éventuelle invitation PENDING antérieure est révoquée (une seule).
    expect(models.invitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "tenant-A", email: "prof@ecolemiriam.app", status: "PENDING" },
      })
    );
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("envoie l'email quand Resend est configuré (sans exposer le lien)", async () => {
    process.env.RESEND_API_KEY = "re_test_123";
    const result = await createInvitation(input);
    if (!result.success) throw new Error(result.error);

    expect(result.emailSent).toBe(true);
    expect(result.inviteUrl).toBeUndefined();
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const [to, subject, html] = mockSendEmail.mock.calls[0];
    expect(to).toEqual(["prof@ecolemiriam.app"]);
    expect(subject).toContain("École A");
    expect(html).toContain("/accept-invitation?token=");
  });

  it("refuse si l'appelant n'administre pas l'établissement cible", async () => {
    // L'appelant n'a d'adhésion que dans un AUTRE établissement.
    models.userTenant.findMany.mockResolvedValue([
      { tenantId: "tenant-B", role: "TENANT_ADMIN" },
    ]);
    const result = await createInvitation(input);
    expect(result).toEqual({
      success: false,
      error: "Vous n'administrez pas cet établissement",
    });
    expect(models.invitation.create).not.toHaveBeenCalled();
  });

  it("autorise un compte historique sans adhésion UserTenant (tenantId dénormalisé)", async () => {
    models.userTenant.findMany.mockResolvedValue([]);
    const result = await createInvitation(input);
    expect(result.success).toBe(true);
  });

  it("refuse un destinataire ayant déjà un accès actif", async () => {
    models.user.findUnique.mockResolvedValue({ id: "u1" });
    models.userTenant.findUnique.mockResolvedValue({ isActive: true });
    const result = await createInvitation(input);
    expect(result).toEqual({
      success: false,
      error: "Cet utilisateur a déjà accès à cet établissement",
    });
  });

  it("rattache l'invité au site sur lequel l'administrateur est positionné", async () => {
    const result = await createInvitation(input);
    expect(result.success).toBe(true);
    expect(models.invitation.create.mock.calls[0][0].data.siteId).toBe("site-1");
  });

  it("refuse d'inviter du personnel depuis « tous les sites »", async () => {
    mockAuth.mockResolvedValue(adminSession({ siteId: null }));
    const result = await createInvitation(input);
    expect(result.success).toBe(false);
    expect(models.invitation.create).not.toHaveBeenCalled();
  });

  it("autorise un parent ou un directeur depuis « tous les sites »", async () => {
    mockAuth.mockResolvedValue(adminSession({ siteId: null }));
    for (const role of ["PARENT", "TENANT_ADMIN"] as const) {
      const result = await createInvitation({ ...input, role });
      expect(result.success).toBe(true);
    }
  });

  it("refuse un site qui n'appartient pas à l'établissement", async () => {
    mockAuth.mockResolvedValue(adminSession({ siteId: "site-autre" }));
    models.site.findFirst.mockResolvedValue(null);
    const result = await createInvitation(input);
    expect(result).toEqual({
      success: false,
      error: "Site introuvable dans cet établissement",
    });
  });

  it("refuse sans session", async () => {
    mockAuth.mockResolvedValue(null);
    const result = await createInvitation(input);
    expect(result).toEqual({ success: false, error: "Non autorisé" });
  });
});

// ============================================================
// 2. Acceptation (page publique)
// ============================================================

function pendingInvitation(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    tenantId: "tenant-A",
    siteId: null,
    email: "new@ecolemiriam.app",
    name: "Nouveau Prof",
    role: "TEACHER",
    phone: null,
    status: "PENDING",
    expiresAt: FUTURE,
    ...overrides,
  };
}

describe("acceptInvitation", () => {
  it("crée le compte, consomme l'invitation et le mot de passe choisi authentifie", async () => {
    const { token, tokenHash } = generateInvitationToken();
    models.invitation.findUnique.mockResolvedValue(pendingInvitation({ tokenHash }));
    tx.user.findUnique.mockResolvedValue(null);
    tx.user.create.mockResolvedValue({ id: "u-new", siteId: null });

    const result = await acceptInvitation({
      token,
      name: "Nouveau Prof",
      password: "MotDePasse2026",
    });
    expect(result).toEqual({ success: true });

    // Consommation atomique PENDING → ACCEPTED (anti double-acceptation).
    expect(tx.invitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "inv-1", status: "PENDING" },
        data: expect.objectContaining({ status: "ACCEPTED" }),
      })
    );

    const data = tx.user.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      tenantId: "tenant-A",
      email: "new@ecolemiriam.app",
      name: "Nouveau Prof",
      role: "TEACHER",
      isActive: true,
      // Mot de passe choisi par l'utilisateur : pas de changement forcé.
      mustChangePassword: false,
    });
    expect(data.userTenants.create).toMatchObject({
      tenantId: "tenant-A",
      role: "TEACHER",
      isActive: true,
      isDefault: true,
    });
    // ACCEPTATION : le hash stocké authentifie le mot de passe choisi.
    await expect(bcrypt.compare("MotDePasse2026", data.password as string)).resolves.toBe(true);

    // Fiche métier enseignant créée automatiquement.
    expect(tx.enseignant.create).toHaveBeenCalledTimes(1);
    expect(tx.invitation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { acceptedByUserId: "u-new" } })
    );
  });

  it("rattache un compte existant sans écraser son mot de passe", async () => {
    const { token } = generateInvitationToken();
    models.invitation.findUnique.mockResolvedValue(pendingInvitation());
    tx.user.findUnique.mockResolvedValue({ id: "u-existing", siteId: null });
    tx.userTenant.findUnique.mockResolvedValue(null);

    const result = await acceptInvitation({
      token,
      name: "Nouveau Prof",
      password: "MotDePasse2026",
    });

    expect(result).toEqual({ success: true });
    expect(tx.user.create).not.toHaveBeenCalled();
    // Compte existant sans fiche dans cet établissement : elle est créée.
    expect(tx.enseignant.create).toHaveBeenCalledTimes(1);
    expect(tx.userTenant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "u-existing",
          tenantId: "tenant-A",
          role: "TEACHER",
          isActive: true,
          isDefault: false,
        }),
      })
    );
  });

  it("rattache le nouvel enseignant au site de l'invitation (UserSite + EnseignantSite)", async () => {
    const { token } = generateInvitationToken();
    models.invitation.findUnique.mockResolvedValue(pendingInvitation({ siteId: "site-1" }));
    tx.user.findUnique.mockResolvedValue(null);
    tx.user.create.mockResolvedValue({ id: "u-new", siteId: "site-1" });

    const result = await acceptInvitation({ token, password: "MotDePasse2026" });
    expect(result).toEqual({ success: true });
    expect(tx.enseignant.create.mock.calls[0][0].data.sites).toEqual({ create: { siteId: "site-1" } });
    expect(tx.userSite.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { userId: "u-new", siteId: "site-1" } })
    );
  });

  it("ajoute le site à la fiche existante d'un enseignant déjà connu", async () => {
    const { token } = generateInvitationToken();
    models.invitation.findUnique.mockResolvedValue(pendingInvitation({ siteId: "site-1" }));
    tx.user.findUnique.mockResolvedValue({ id: "u-existing", siteId: "site-1" });
    tx.userTenant.findUnique.mockResolvedValue(null);
    tx.enseignant.findFirst.mockResolvedValue({ id: "ens-1" });

    const result = await acceptInvitation({ token, password: "MotDePasse2026" });
    expect(result).toEqual({ success: true });
    expect(tx.enseignant.create).not.toHaveBeenCalled();
    expect(tx.enseignantSite.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { enseignantId: "ens-1", siteId: "site-1" } })
    );
  });

  it("refuse un mot de passe trop faible", async () => {
    const { token } = generateInvitationToken();
    const result = await acceptInvitation({ token, password: "abc" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/au moins 10/);
    expect(models.invitation.findUnique).not.toHaveBeenCalled();
  });

  it("refuse un jeton inconnu", async () => {
    const { token } = generateInvitationToken();
    models.invitation.findUnique.mockResolvedValue(null);
    const result = await acceptInvitation({ token, password: "MotDePasse2026" });
    expect(result).toEqual({
      success: false,
      error: "Invitation introuvable ou déjà utilisée",
    });
  });

  it("refuse une invitation déjà utilisée", async () => {
    const { token } = generateInvitationToken();
    models.invitation.findUnique.mockResolvedValue(
      pendingInvitation({ status: "ACCEPTED" })
    );
    const result = await acceptInvitation({ token, password: "MotDePasse2026" });
    expect(result).toEqual({
      success: false,
      error: "Cette invitation a déjà été utilisée ou annulée",
    });
  });

  it("refuse une invitation expirée", async () => {
    const { token } = generateInvitationToken();
    models.invitation.findUnique.mockResolvedValue(pendingInvitation({ expiresAt: PAST }));
    const result = await acceptInvitation({ token, password: "MotDePasse2026" });
    expect(result).toEqual({ success: false, error: "Cette invitation a expiré" });
  });

  it("refuse une seconde acceptation concurrente (consommation atomique)", async () => {
    const { token } = generateInvitationToken();
    models.invitation.findUnique.mockResolvedValue(pendingInvitation());
    tx.invitation.updateMany.mockResolvedValue({ count: 0 });

    const result = await acceptInvitation({ token, password: "MotDePasse2026" });
    expect(result).toEqual({
      success: false,
      error: "Cette invitation a déjà été utilisée",
    });
    expect(tx.user.create).not.toHaveBeenCalled();
  });
});

// ============================================================
// 3. Révocation / renvoi
// ============================================================

describe("revokeInvitation / resendInvitation", () => {
  it("révoque une invitation en attente", async () => {
    models.invitation.findFirst.mockResolvedValue({ id: "inv-1", status: "PENDING" });
    const result = await revokeInvitation("inv-1");
    expect(result).toEqual({ success: true });
    expect(models.invitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "inv-1" },
        data: expect.objectContaining({ status: "REVOKED" }),
      })
    );
  });

  it("refuse de révoquer une invitation qui n'est plus en attente", async () => {
    models.invitation.findFirst.mockResolvedValue({ id: "inv-1", status: "ACCEPTED" });
    const result = await revokeInvitation("inv-1");
    expect(result).toEqual({
      success: false,
      error: "Cette invitation n'est plus en attente",
    });
    expect(models.invitation.update).not.toHaveBeenCalled();
  });

  it("renvoie une invitation en régénérant un jeton (l'ancien lien ne marche plus)", async () => {
    models.invitation.findFirst.mockResolvedValue({
      id: "inv-1",
      email: "prof@ecolemiriam.app",
      role: "TEACHER",
      status: "PENDING",
      tenant: { name: "École A" },
    });

    const result = await resendInvitation("inv-1");
    if (!result.success) throw new Error(result.error);

    expect(result.emailSent).toBe(false);
    const url = result.inviteUrl as string;
    const token = new URL(url).searchParams.get("token") as string;

    const updateData = models.invitation.update.mock.calls[0][0].data;
    expect(updateData.tokenHash).toBe(hashInvitationToken(token));
    expect((updateData.expiresAt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it("refuse de renvoyer une invitation annulée", async () => {
    models.invitation.findFirst.mockResolvedValue({
      id: "inv-1",
      email: "prof@ecolemiriam.app",
      role: "TEACHER",
      status: "REVOKED",
      tenant: { name: "École A" },
    });
    const result = await resendInvitation("inv-1");
    expect(result).toEqual({
      success: false,
      error: "Seule une invitation en attente peut être renvoyée",
    });
  });
});

// ============================================================
// 4. Changement de mot de passe (compte connecté)
// ============================================================

describe("changePassword", () => {
  it("met à jour le mot de passe et lève l'obligation de changement", async () => {
    const currentHash = await bcrypt.hash("TestOldPassword2026", 12);
    models.user.findUnique.mockResolvedValue({ id: "admin-1", password: currentHash });

    const result = await changePassword({
      currentPassword: "TestOldPassword2026",
      newPassword: "TestNewPassword2026",
    });
    expect(result).toEqual({ success: true });

    const data = models.user.update.mock.calls[0][0].data;
    expect(data.mustChangePassword).toBe(false);
    await expect(bcrypt.compare("TestNewPassword2026", data.password as string)).resolves.toBe(true);
    // Le nouveau mot de passe ne doit pas être stocké en clair.
    expect(data.password).not.toBe("TestNewPassword2026");
  });

  it("refuse un mot de passe actuel incorrect", async () => {
    const currentHash = await bcrypt.hash("TestOldPassword2026", 12);
    models.user.findUnique.mockResolvedValue({ id: "admin-1", password: currentHash });

    const result = await changePassword({
      currentPassword: "TestMauvaisMotDePasse",
      newPassword: "TestNewPassword2026",
    });
    expect(result).toEqual({ success: false, error: "Mot de passe actuel incorrect" });
    expect(models.user.update).not.toHaveBeenCalled();
  });

  it("refuse un nouveau mot de passe identique à l'actuel", async () => {
    const result = await changePassword({
      currentPassword: "TestSamePassword2026",
      newPassword: "TestSamePassword2026",
    });
    expect(result).toEqual({
      success: false,
      error: "Le nouveau mot de passe doit être différent de l'actuel",
    });
  });

  it("refuse un nouveau mot de passe trop faible", async () => {
    const result = await changePassword({
      currentPassword: "TestOldPassword2026",
      newPassword: "faible",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/au moins 10/);
  });

  it("refuse sans session", async () => {
    mockAuth.mockResolvedValue(null);
    const result = await changePassword({
      currentPassword: "TestOldPassword2026",
      newPassword: "TestNewPassword2026",
    });
    expect(result).toEqual({ success: false, error: "Non autorisé" });
  });
});
