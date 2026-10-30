import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  eleve: { findFirst: vi.fn() },
  bulletin: { findFirst: vi.fn() },
  tenant: { findUnique: vi.fn() },
  periode: { findFirst: vi.fn() },
  eleveParent: { findMany: vi.fn() },
}));
const sendEmail = vi.hoisted(() => vi.fn());
const sendWhatsAppMessage = vi.hoisted(() => vi.fn());
const sendWhatsAppTemplate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/auth", () => ({
  auth: async () => ({ user: { id: "u1", tenantId: "t1", role: "TENANT_ADMIN", siteId: null } }),
}));
vi.mock("@/lib/notifications/email", () => ({ sendEmail }));
vi.mock("@/lib/notifications/whatsapp", () => ({ sendWhatsAppMessage, sendWhatsAppTemplate }));

import { POST } from "@/app/api/bulletins/envoyer/route";
import { verifierLienBulletin } from "@/lib/bulletins/partage";

const requete = (canaux: string[]) =>
  new Request("http://x/api/bulletins/envoyer", {
    method: "POST",
    body: JSON.stringify({ eleveId: "e1", periodeId: "p1", canaux }),
  }) as never;

const parents = [
  { parent: { email: "mere@exemple.dj", phone: "77 00 11 22", phone2: null } },
  { parent: { email: "pere@exemple.dj", phone: "77 00 11 22", phone2: null } }, // même numéro : un seul envoi
];

describe("POST /api/bulletins/envoyer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_SECRET = "secret-de-test";
    delete process.env.WHATSAPP_TEMPLATE_BULLETIN;
    prismaMock.eleve.findFirst.mockResolvedValue({ prenom: "Amina", nom: "HASSAN" });
    prismaMock.bulletin.findFirst.mockResolvedValue({ isPublie: true });
    prismaMock.tenant.findUnique.mockResolvedValue({ name: "École Miriam" });
    prismaMock.periode.findFirst.mockResolvedValue({ nom: "Trimestre 1" });
    prismaMock.eleveParent.findMany.mockResolvedValue(parents);
    sendEmail.mockResolvedValue({ success: true, sent: 2 });
    sendWhatsAppMessage.mockResolvedValue({ success: true, messageId: "wamid.1" });
    sendWhatsAppTemplate.mockResolvedValue({ success: true, messageId: "wamid.2" });
  });

  it("refuse d'envoyer un bulletin non publié", async () => {
    prismaMock.bulletin.findFirst.mockResolvedValue({ isPublie: false });
    const res = await POST(requete(["email"]));
    expect(res.status).toBe(409);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("envoie l'e-mail à chaque parent avec un lien valide", async () => {
    const res = await POST(requete(["email"]));
    const corps = await res.json();
    expect(corps.email).toMatchObject({ envoyes: 2, destinataires: 2, erreur: null, simule: false });
    const [destinataires, sujet, html] = sendEmail.mock.calls[0];
    expect(destinataires).toEqual(parents.map((p) => p.parent.email));
    expect(sujet).toContain("Amina HASSAN");
    const lien = /href="([^"]+)"/.exec(html)![1];
    const jeton = lien.split("/bulletin-partage/")[1];
    expect(verifierLienBulletin(jeton)).toEqual({ eleveId: "e1", periodeId: "p1", tenantId: "t1" });
  });

  it("envoie WhatsApp en texte libre, une seule fois par numéro", async () => {
    const res = await POST(requete(["whatsapp"]));
    const corps = await res.json();
    expect(corps.whatsapp).toMatchObject({ envoyes: 1, destinataires: 1, simule: false });
    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppMessage.mock.calls[0][1]).toContain("/bulletin-partage/");
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it("utilise le modèle approuvé quand il est configuré", async () => {
    process.env.WHATSAPP_TEMPLATE_BULLETIN = "bulletin_disponible";
    await POST(requete(["whatsapp"]));
    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(1);
    const [, modele, variables] = sendWhatsAppTemplate.mock.calls[0];
    expect(modele).toBe("bulletin_disponible");
    expect(variables[0]).toBe("Amina HASSAN");
    expect(variables[1]).toBe("Trimestre 1");
    expect(variables[2]).toContain("/bulletin-partage/");
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("signale un envoi simulé (clés absentes) au lieu d'annoncer un succès", async () => {
    sendEmail.mockResolvedValue({ success: true, sent: 2, simulated: true });
    sendWhatsAppMessage.mockResolvedValue({ success: true, messageId: "sim_1", simulated: true });
    const corps = await (await POST(requete(["email", "whatsapp"]))).json();
    expect(corps.email.simule).toBe(true);
    expect(corps.whatsapp.simule).toBe(true);
  });

  it("remonte l'erreur du fournisseur", async () => {
    sendWhatsAppMessage.mockResolvedValue({ success: false, error: "Re-engagement message" });
    const corps = await (await POST(requete(["whatsapp"]))).json();
    expect(corps.whatsapp).toMatchObject({ envoyes: 0, erreur: "Re-engagement message" });
  });

  it("ne tente rien quand aucun parent n'a de contact", async () => {
    prismaMock.eleveParent.findMany.mockResolvedValue([]);
    const corps = await (await POST(requete(["email", "whatsapp"]))).json();
    expect(corps.email.destinataires).toBe(0);
    expect(corps.whatsapp.destinataires).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });
});
