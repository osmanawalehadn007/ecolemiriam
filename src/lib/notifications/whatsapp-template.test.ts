import { describe, it, expect, vi, afterEach } from "vitest";
import { sendWhatsAppTemplate } from "@/lib/notifications/whatsapp";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WHATSAPP_API_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
});

describe("sendWhatsAppTemplate", () => {
  it("simule sans clés", async () => {
    const r = await sendWhatsAppTemplate("77001122", "bulletin_disponible", ["a"]);
    expect(r).toMatchObject({ success: true, simulated: true });
  });

  it("envoie le modèle avec ses variables dans l'ordre, au numéro normalisé", async () => {
    process.env.WHATSAPP_API_TOKEN = "jeton-test";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: "wamid.9" }] }) });
    vi.stubGlobal("fetch", fetchMock);

    const r = await sendWhatsAppTemplate("77 00 11 22", "bulletin_disponible", ["Amina", "Trimestre 1", "https://x/y"], "fr");

    expect(r).toEqual({ success: true, messageId: "wamid.9" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/123/messages");
    const corps = JSON.parse(init.body);
    expect(corps.to).toBe("253770011" + "22");
    expect(corps.type).toBe("template");
    expect(corps.template.name).toBe("bulletin_disponible");
    expect(corps.template.language.code).toBe("fr");
    expect(corps.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual(["Amina", "Trimestre 1", "https://x/y"]);
  });

  it("remonte le refus de Meta", async () => {
    process.env.WHATSAPP_API_TOKEN = "jeton-test";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: { message: "Template not found" } }) }));
    const r = await sendWhatsAppTemplate("77001122", "inconnu", []);
    expect(r).toEqual({ success: false, error: "Template not found" });
  });
});
