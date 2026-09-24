import { NextRequest, NextResponse } from "next/server";
import { authorizeSuperAdmin } from "@/lib/rbac";
import { rateLimit } from "@/lib/security/rate-limit";
import { sendWhatsAppMessage, sendAbsenceWhatsApp, sendRetardWhatsApp } from "@/lib/notifications/whatsapp";
import { sendSMS } from "@/lib/sms/africasTalking";
import { z } from "zod";

const TestSchema = z.object({
  phone: z.string().min(1),
  type: z.enum(["test", "absence", "retard", "sms"]).default("test"),
  eleveNom: z.string().optional(),
  ecoleNom: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, {
    keyPrefix: "test:whatsapp:ip",
    limit: 5,
    windowSeconds: 60,
  });
  if (limited) return limited;

  const gate = await authorizeSuperAdmin();
  if (!gate.ok) return gate.response;

  const body = await req.json();
  const parsed = TestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  const { phone, type, eleveNom, ecoleNom } = parsed.data;
  const nom = ecoleNom ?? "École Miriam Test";
  const eleve = eleveNom ?? "Élève Test";
  const date = new Date().toLocaleDateString("fr-FR");

  const hasWhatsappToken = !!process.env.WHATSAPP_API_TOKEN && !process.env.WHATSAPP_API_TOKEN?.includes("xxxx");
  const hasSmsKey = !!process.env.AT_API_KEY && !!process.env.AT_USERNAME;

  let result;
  switch (type) {
    case "absence":
      result = await sendAbsenceWhatsApp(phone, eleve, date, nom);
      break;
    case "retard":
      result = await sendRetardWhatsApp(phone, eleve, date, nom);
      break;
    case "sms":
      result = await sendSMS(phone, `[${nom}] Test SMS depuis École Miriam le ${date}`);
      break;
    case "test":
    default:
      result = await sendWhatsAppMessage(phone, `🎓 *${nom}*\n\nCeci est un message de test depuis École Miriam.\n\nSi vous recevez ce message, l'intégration WhatsApp fonctionne correctement !\n\n— École Miriam`);
      break;
  }

  return NextResponse.json({
    success: result.success,
    messageId: result.messageId,
    error: result.error,
    simulated: (type === "sms" ? !hasSmsKey : !hasWhatsappToken),
    config: {
      whatsappToken: hasWhatsappToken ? "✅ Configuré" : "❌ Manquant (simulation)",
      whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ? "✅ Configuré" : "❌ Manquant",
      smsApiKey: hasSmsKey ? "✅ Configuré" : "❌ Manquant (simulation)",
    },
    sentTo: phone,
    type,
  });
}

export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, {
    keyPrefix: "test:whatsapp:ip",
    limit: 10,
    windowSeconds: 60,
  });
  if (limited) return limited;

  const gate = await authorizeSuperAdmin();
  if (!gate.ok) return gate.response;

  const hasWhatsappToken = !!process.env.WHATSAPP_API_TOKEN && !process.env.WHATSAPP_API_TOKEN?.includes("xxxx");
  const hasSmsKey = !!process.env.AT_API_KEY && !!process.env.AT_USERNAME;

  return NextResponse.json({
    whatsapp: {
      token: hasWhatsappToken ? "✅ Configuré" : "❌ Manquant — simulation active",
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ? "✅ Configuré" : "❌ Manquant",
      businessId: process.env.WHATSAPP_BUSINESS_ID ? "✅ Configuré" : "❌ Manquant",
    },
    sms: {
      apiKey: hasSmsKey ? "✅ Configuré" : "❌ Manquant — simulation active",
      username: process.env.AT_USERNAME ? "✅ Configuré" : "❌ Manquant",
      senderId: process.env.AT_SENDER_ID ?? "Non défini",
    },
    instructions: {
      whatsapp: "Configurez WHATSAPP_API_TOKEN et WHATSAPP_PHONE_NUMBER_ID dans .env.local",
      sms: "Configurez AT_API_KEY et AT_USERNAME dans .env.local",
    },
  });
}
