import prisma from "@/lib/prisma";
import { sendSMS } from "@/lib/sms/africasTalking";
import { sendEmail, renderNotificationEmail } from "@/lib/notifications/email";

/**
 * Rappel de début de mois pour les factures du mois déjà émises et non
 * soldées (générées à l'avance, saisies à la main, factures d'inscription
 * rattachées au mois…).
 *
 * Enregistré comme relance de niveau 0 : les relances d'escalade (1 à 3,
 * après échéance) et la relance manuelle (« dernier niveau + 1 ») n'en sont
 * pas affectées. Un seul rappel par facture : relancer le cron le même mois
 * ne renvoie rien.
 */
export const NIVEAU_RAPPEL_MENSUEL = 0;

/** Africa's Talking simule un succès sans clé : on ne compte pas un SMS non envoyé. */
export function smsDisponible(): boolean {
  return !!process.env.AT_API_KEY && !!process.env.AT_USERNAME;
}

export async function envoyerRappelsImpayesDuMois(params: {
  tenantId: string;
  ecoleNom: string;
  moisKey: string; // "2026-10"
  moisLibelle: string; // "Octobre 2026"
  creeesAvant: Date;
  simulation?: boolean;
}) {
  const { tenantId, ecoleNom, moisKey, moisLibelle, creeesAvant, simulation = false } = params;

  // eslint-disable-next-line ecolemiriam/require-site-filter -- rappel pour tout l'établissement, appelé par le cron (CRON_SECRET) dans le contexte RLS du tenant
  const factures = await prisma.facture.findMany({
    where: {
      tenantId,
      mois: moisKey,
      statut: { in: ["EN_ATTENTE", "EN_RETARD"] },
      createdAt: { lt: creeesAvant },
      eleveId: { not: null },
      relances: { none: { niveau: NIVEAU_RAPPEL_MENSUEL } },
    },
    select: {
      id: true,
      numero: true,
      libelle: true,
      montant: true,
      devise: true,
      eleveId: true,
      paiements: { select: { montant: true } },
      eleve: {
        select: {
          nom: true,
          prenom: true,
          parents: { select: { parent: { select: { email: true, phone: true } } } },
        },
      },
    },
  });

  // Une facture partiellement payée reste à rappeler, pour son reste dû.
  const aRappeler = factures
    .map((f) => ({ ...f, reste: f.montant - f.paiements.reduce((s, p) => s + p.montant, 0) }))
    .filter((f) => f.reste > 0);

  const parEleve = new Map<string, typeof aRappeler>();
  for (const f of aRappeler) {
    parEleve.set(f.eleveId!, [...(parEleve.get(f.eleveId!) ?? []), f]);
  }

  const bilan = { factures: aRappeler.length, eleves: parEleve.size, envoyes: 0, sansContact: 0, echecs: 0 };
  if (simulation) return bilan;

  const avecSms = smsDisponible();
  for (const lot of parEleve.values()) {
    const eleve = lot[0].eleve!;
    const eleveNom = `${eleve.prenom} ${eleve.nom}`.trim();
    const emails = [...new Set(eleve.parents.map((p) => p.parent.email).filter((e): e is string => !!e))];
    const phones = avecSms ? [...new Set(eleve.parents.map((p) => p.parent.phone).filter(Boolean))] : [];
    if (emails.length === 0 && phones.length === 0) {
      bilan.sansContact++;
      continue;
    }

    const devise = lot[0].devise;
    const total = lot.reduce((s, f) => s + f.reste, 0);
    const lignes = lot.map((f) => `- ${f.numero} — ${f.libelle} : ${f.reste.toLocaleString("fr-FR")} ${f.devise}`).join("\n");
    const titre = `Rappel : factures de ${moisLibelle}`;
    const texteEmail =
      `Bonjour,\n\nNous vous rappelons que les factures suivantes concernant ${eleveNom} pour ${moisLibelle} ne sont pas encore réglées :\n\n${lignes}\n\n` +
      `Total restant dû : ${total.toLocaleString("fr-FR")} ${devise}.\n\nMerci de procéder au règlement auprès de l'établissement.\n\nCordialement,\n${ecoleNom}`;
    const texteSms = `${ecoleNom} : rappel, ${lot.length > 1 ? `${lot.length} factures` : `la facture ${lot[0].numero}`} de ${eleveNom} pour ${moisLibelle} (${total} ${devise}) ne ${lot.length > 1 ? "sont" : "est"} pas encore réglée${lot.length > 1 ? "s" : ""}.`;

    const canaux: string[] = [];
    try {
      if (emails.length > 0) {
        const r = await sendEmail(emails, `[${ecoleNom}] ${titre}`, renderNotificationEmail(ecoleNom, titre, texteEmail), texteEmail, { type: "rappel_mensuel" });
        if (r.success) canaux.push("email");
      }
      if (phones.length > 0) {
        const r = await sendSMS(phones, texteSms);
        if (r.success) canaux.push("sms");
      }
    } catch (err) {
      console.error(`[rappels] envoi échoué pour ${eleveNom}:`, err);
    }

    if (canaux.length === 0) {
      bilan.echecs++;
      continue;
    }
    await prisma.relance.createMany({
      data: lot.map((f) => ({
        tenantId,
        factureId: f.id,
        niveau: NIVEAU_RAPPEL_MENSUEL,
        canal: canaux.join("+"),
        message: canaux.includes("sms") ? texteSms : texteEmail,
      })),
    });
    bilan.envoyes++;
  }
  return bilan;
}
