import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendSMS } from "@/lib/sms/africasTalking";
import { sendEmail, renderNotificationEmail } from "@/lib/notifications/email";

/**
 * Cron — Relances automatiques de paiement.
 * ============================================================
 * Détecte les factures EN_ATTENTE ou EN_RETARD dont l'échéance est dépassée
 * et envoie des relances escaladées :
 *   - Niveau 1 : J+3 après échéance (rappel amical)
 *   - Niveau 2 : J+10 après échéance (relance ferme)
 *   - Niveau 3 : J+20 après échéance (mise en demeure)
 *
 * Protégé par CRON_SECRET. À appeler quotidiennement.
 * Planifié via vercel.json (une fois par jour à 8h00 UTC).
 */
async function handler(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization");
  if (!secret || provided !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const now = new Date();
  const results: Array<{
    factureId: string;
    eleve: string;
    niveau: number;
    canal: string;
    success: boolean;
    error?: string;
  }> = [];

  // Définir les paliers de relance
  const paliers = [
    { niveau: 1, joursApresEcheance: 3, delaiJours: 10 }, // niveau 1 à J+3, fenêtre de 10j avant niveau 2
    { niveau: 2, joursApresEcheance: 10, delaiJours: 10 },
    { niveau: 3, joursApresEcheance: 20, delaiJours: 999 }, // dernier niveau
  ];

  for (const palier of paliers) {
    const dateDebut = new Date(now);
    dateDebut.setDate(dateDebut.getDate() - palier.joursApresEcheance - palier.delaiJours);
    const dateFin = new Date(now);
    dateFin.setDate(dateFin.getDate() - palier.joursApresEcheance);

    // Factures en retard dont l'échéance tombe dans la fenêtre du palier
    // eslint-disable-next-line ecolpro/require-tenant-id, ecolpro/require-site-filter -- cron cross-tenant : traite toutes les factures en retard, protégé par CRON_SECRET
    const factures = await prisma.facture.findMany({
      where: {
        statut: { in: ["EN_ATTENTE", "EN_RETARD"] },
        echeance: {
          gte: dateDebut,
          lt: dateFin,
        },
      },
      include: {
        eleve: {
          select: {
            id: true,
            nom: true,
            prenom: true,
            parents: {
              include: {
                parent: {
                  select: {
                    id: true,
                    nom: true,
                    prenom: true,
                    phone: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
        tenant: { select: { id: true, name: true } },
        relances: { select: { id: true, niveau: true } },
      },
      take: 200,
    });

    for (const facture of factures) {
      // Vérifier si une relance de ce niveau a déjà été envoyée
      const dejaRelance = facture.relances.some((r) => r.niveau >= palier.niveau);
      if (dejaRelance) continue;

      const eleveNom = `${facture.eleve.prenom} ${facture.eleve.nom}`;
      const ecoleNom = facture.tenant.name;
      const montant = facture.montant;
      const numero = facture.numero;
      const echeanceStr = facture.echeance
        ? new Date(facture.echeance).toLocaleDateString("fr-FR")
        : "—";

      const messages = buildRelanceMessage(palier.niveau, eleveNom, numero, montant, echeanceStr, ecoleNom);

      // Collecter les contacts des parents
      const phones: string[] = [];
      const emails: string[] = [];
      for (const ep of facture.eleve.parents) {
        if (ep.parent.phone) phones.push(ep.parent.phone);
        if (ep.parent.email) emails.push(ep.parent.email);
      }

      let success = true;
      let errorMsg: string | undefined;

      try {
        // Envoi SMS
        if (phones.length > 0) {
          const smsResult = await sendSMS(phones, messages.sms);
          if (!smsResult.success) {
            success = false;
            errorMsg = `SMS: ${smsResult.error}`;
          }
        }

        // Envoi Email
        if (emails.length > 0) {
          const html = renderNotificationEmail(ecoleNom, messages.titre, messages.email);
          const emailResult = await sendEmail(emails, `[${ecoleNom}] ${messages.titre}`, html);
          if (!emailResult.success) {
            if (success) {
              success = false;
              errorMsg = `Email: ${emailResult.error}`;
            }
          }
        }

        // Enregistrer la relance en base
        const canal = phones.length > 0 ? "sms" : emails.length > 0 ? "email" : "courrier";
        await prisma.relance.create({
          data: {
            tenantId: facture.tenantId,
            factureId: facture.id,
            niveau: palier.niveau,
            canal,
            message: messages.sms,
          },
        });

        // Marquer la facture comme EN_RETARD si pas déjà fait
        if (facture.statut === "EN_ATTENTE") {
          // eslint-disable-next-line ecolpro/require-tenant-id -- facture.id provient de la requête ci-dessus
          await prisma.facture.update({
            where: { id: facture.id },
            data: { statut: "EN_RETARD" },
          });
        }
      } catch (err) {
        success = false;
        errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[Cron relance] Erreur facture ${facture.id}:`, err);
      }

      results.push({
        factureId: facture.id,
        eleve: eleveNom,
        niveau: palier.niveau,
        canal: phones.length > 0 ? "sms" : "email",
        success,
        error: errorMsg,
      });
    }
  }

  // Résumé
  const sent = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return NextResponse.json({
    processed: results.length,
    sent,
    failed,
    results,
  });
}

function buildRelanceMessage(
  niveau: number,
  eleveNom: string,
  numero: string,
  montant: number,
  echeanceStr: string,
  ecoleNom: string
): { titre: string; sms: string; email: string } {
  if (niveau === 1) {
    return {
      titre: "Rappel de paiement",
      sms: `Bonjour, nous vous rappelons que la facture ${numero} de ${eleveNom} d'un montant de ${montant} ${echeanceStr} est échue. Merci de régulariser. ${ecoleNom}`,
      email: `Bonjour,\n\nNous vous rappelons que la facture ${numero} concernant ${eleveNom}, d'un montant de ${montant}, échéance du ${echeanceStr}, n'a pas encore été réglée.\n\nNous vous prions de bien vouloir procéder au règlement dans les meilleurs délais.\n\nCordialement,\n${ecoleNom}`,
    };
  }
  if (niveau === 2) {
    return {
      titre: "Relance de paiement (2ème)",
      sms: `2ème relance: la facture ${numero} de ${eleveNom} (${montant}) est en retard. Merci de régulariser rapidement pour éviter des frais supplémentaires. ${ecoleNom}`,
      email: `Bonjour,\n\nMalgré notre précédent rappel, la facture ${numero} concernant ${eleveNom}, d'un montant de ${montant}, échéance du ${echeanceStr}, reste impayée.\n\nNous vous demandons de bien vouloir régulariser cette situation dans les plus brefs délais pour éviter l'application de frais de retard.\n\nCordialement,\n${ecoleNom}`,
    };
  }
  return {
    titre: "Mise en demeure de paiement (3ème relance)",
    sms: `URGENT: 3ème relance pour la facture ${numero} de ${eleveNom} (${montant}). Une mise en demeure a été émise. Merci de contacter l'établissement immédiatement. ${ecoleNom}`,
    email: `Bonjour,\n\nLa facture ${numero} concernant ${eleveNom}, d'un montant de ${montant}, échéance du ${echeanceStr}, n'a pas été réglée malgré nos deux précédentes relances.\n\nNous vous mettons par la présente en demeure de procéder au règlement intégral sous 8 jours, faute de quoi des mesures supplémentaires pourront être prises (suspension des services, frais de recouvrement).\n\nNous restons à votre disposition pour tout arrangement.\n\nCordialement,\n${ecoleNom}`,
  };
}

export const GET = handler;
export const POST = handler;
