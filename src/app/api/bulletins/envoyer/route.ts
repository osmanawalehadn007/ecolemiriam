import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForModel } from "@/lib/site-scope";
import { sendEmail } from "@/lib/notifications/email";
import { sendWhatsAppMessage } from "@/lib/notifications/whatsapp";
import { signerLienBulletin, urlLienBulletin } from "@/lib/bulletins/partage";

const Schema = z.object({
  eleveId: z.string().min(1),
  periodeId: z.string().min(1),
  canaux: z.array(z.enum(["email", "whatsapp"])).min(1),
});

function echapper(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "bulletins:write");
    if (denied) return denied;

    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Données invalides" }, { status: 400 });
    }
    const { eleveId, periodeId, canaux } = parsed.data;
    const tenantId = session.user.tenantId;

    const eleve = await prisma.eleve.findFirst({
      where: { id: eleveId, tenantId, ...siteFilterForModel("eleve", session.user) },
      select: { prenom: true, nom: true },
    });
    if (!eleve) return NextResponse.json({ error: "Élève introuvable" }, { status: 404 });

    const bulletin = await prisma.bulletin.findFirst({
      where: { eleveId, periodeId, tenantId, ...siteFilterForModel("bulletin", session.user) },
      select: { isPublie: true },
    });
    if (!bulletin) return NextResponse.json({ error: "Bulletin introuvable" }, { status: 404 });
    if (!bulletin.isPublie) {
      return NextResponse.json({ error: "Publiez d'abord les bulletins de la classe avant de les envoyer." }, { status: 409 });
    }

    const [tenant, periode, liens] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
      prisma.periode.findFirst({ where: { id: periodeId, annee: { tenantId } }, select: { nom: true } }),
      prisma.eleveParent.findMany({
        where: { eleveId, ...siteFilterForModel("eleveParent", session.user) },
        include: { parent: { select: { email: true, phone: true, phone2: true } } },
      }),
    ]);

    const ecole = tenant?.name ?? "École Miriam";
    const nomEleve = `${eleve.prenom} ${eleve.nom}`;
    const periodeNom = periode?.nom ?? "";
    const lien = urlLienBulletin(signerLienBulletin({ eleveId, periodeId, tenantId }));

    const emails = [...new Set(liens.map((l) => l.parent.email).filter((e): e is string => !!e))];
    const telephones = [...new Set(liens.map((l) => l.parent.phone).filter(Boolean))];

    const resultat = { email: { envoyes: 0, destinataires: emails.length, erreur: null as string | null },
      whatsapp: { envoyes: 0, destinataires: telephones.length, erreur: null as string | null } };

    if (canaux.includes("email") && emails.length > 0) {
      const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
<p>Bonjour,</p>
<p>Le bulletin de <strong>${echapper(nomEleve)}</strong> (${echapper(periodeNom)}) est disponible.</p>
<p><a href="${lien}" style="background:#1e40af;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Consulter et imprimer le bulletin</a></p>
<p style="color:#555;font-size:12px">Ce lien est personnel et valable 60 jours.</p>
<p>${echapper(ecole)}</p></div>`;
      const r = await sendEmail(emails, `Bulletin de ${nomEleve} — ${periodeNom}`, html,
        `Le bulletin de ${nomEleve} (${periodeNom}) est disponible : ${lien}`, { type: "bulletin" });
      resultat.email.envoyes = r.sent;
      resultat.email.erreur = r.success ? null : (r.error ?? "Échec de l'envoi");
    }

    if (canaux.includes("whatsapp") && telephones.length > 0) {
      const message = `🎓 *${ecole}*\n\nBonjour,\n\nLe bulletin de *${nomEleve}* (${periodeNom}) est disponible :\n${lien}\n\nLe lien est personnel et valable 60 jours.`;
      for (const tel of telephones) {
        const r = await sendWhatsAppMessage(tel, message);
        if (r.success) resultat.whatsapp.envoyes++;
        else resultat.whatsapp.erreur = r.error ?? "Échec de l'envoi";
      }
    }

    return NextResponse.json({ success: true, ...resultat });
  } catch (error) {
    console.error("[API/bulletins/envoyer]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
