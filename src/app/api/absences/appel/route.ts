import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { sendAbsenceAlert } from "@/lib/sms/africasTalking";
import { sendEmail, renderNotificationEmail } from "@/lib/notifications/email";
import { sendAbsenceWhatsApp, sendRetardWhatsApp } from "@/lib/notifications/whatsapp";
import { sendAbsenceTelegram, sendRetardTelegram } from "@/lib/notifications/telegram";
import { siteFilterForModel } from "@/lib/site-scope";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { mergeFilters } from "@/lib/site-scope";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";
import type { Role } from "@prisma/client";
import { revalidateTag } from "next/cache";

const AppelSchema = z.object({
  classeId: z.string().min(1),
  date: z.string().datetime(),
  heureDebut: z.string().regex(/^\d{2}:\d{2}$/),
  heureFin: z.string().regex(/^\d{2}:\d{2}$/),
  presences: z.record(z.string(), z.enum(["present", "absent", "retard"])),
  retardsHeureArrivee: z.record(z.string(), z.string().regex(/^\d{2}:\d{2}$/)).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "absences:write");
    if (denied) return denied;

    const body = await req.json();
    const parsed = AppelSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Données invalides", details: parsed.error.flatten() }, { status: 400 });
    }

    const { classeId, date, heureDebut, heureFin, presences, retardsHeureArrivee } = parsed.data;
    const tenantId = session.user.tenantId;
    const appelDate = new Date(date);
    const dateStr = appelDate.toISOString().split("T")[0];

    // Vérifier que la classe appartient au tenant, au site ET à l'année en
    // cours : on ne fait pas l'appel dans une classe d'une année révolue.
    const classe = await prisma.classe.findFirst({
      where: mergeFilters(
        { id: classeId, tenantId },
        siteFilterForModel("classe", session.user),
        anneeFilterForModel("classe", await getAnneeCouranteLibelle(tenantId)),
      ),
    });
    if (!classe) {
      return NextResponse.json({ error: "Classe introuvable pour l'année en cours" }, { status: 404 });
    }

    // Vérification du périmètre enseignant : un TEACHER/CLASS_TEACHER ne
    // peut faire l'appel que dans une classe qui lui est assignée (emploi du
    // temps, prof principal ou affectation explicite). Sans ce contrôle, un
    // enseignant pouvait forger un classeId hors de son scope.
    if (isTeacherRole(session.user.role as Role)) {
      const scope = await getTeacherScope(tenantId!, session.user.id, session.user.role as Role);
      if (scope.isRestricted && !scope.classeIds.includes(classeId)) {
        return NextResponse.json({ error: "Vous n'êtes pas assigné à cette classe" }, { status: 403 });
      }
    }

    // Validation que tous les élèves saisis appartiennent bien à la classe
    // sélectionnée. Sans ce contrôle, un utilisateur pouvait passer des
    // eleveId arbitraires et créer des absences pour des élèves d'autres
    // classes/tenants.
    const eleveIds = Object.keys(presences);
    if (eleveIds.length > 0) {
      // eslint-disable-next-line ecolemiriam/require-site-filter -- eleveId scoping via classeId + tenantId : la classe a déjà été vérifiée ci-dessus
      const validEleves = await prisma.eleve.findMany({
        where: {
          id: { in: eleveIds },
          tenantId,
          classeId,
          statut: "ACTIF",
        },
        select: { id: true },
      });
      const validIds = new Set(validEleves.map((e) => e.id));
      const invalidIds = eleveIds.filter((id) => !validIds.has(id));
      if (invalidIds.length > 0) {
        return NextResponse.json(
          { error: "Certains élèves n'appartiennent pas à cette classe", count: invalidIds.length },
          { status: 400 },
        );
      }
    }

    // Créer les absences pour les absents et retards.
    // L'ID inclut le créneau (heureDebut) pour qu'un même élève puisse avoir
    // des absences distinctes sur plusieurs créneaux d'une même journée.
    // Pour un retard, heureFin = heure d'arrivée de l'élève ; pour une
    // absence, heureFin = fin du créneau.
    const operations = Object.entries(presences)
      .filter(([, status]) => status !== "present")
      .map(([eleveId, status]) => {
        const isRetard = status === "retard";
        const heureArrivee = isRetard ? (retardsHeureArrivee?.[eleveId] ?? heureFin) : heureFin;
        const absenceId = `appel-${classeId}-${eleveId}-${dateStr}-${heureDebut}`;
        return prisma.absence.upsert({
          where: { id: absenceId },
          update: {
            motif: "INJUSTIFIE",
            statut: "EN_ATTENTE",
            isRetard,
            heureDebut,
            heureFin: heureArrivee,
          },
          create: {
            id: absenceId,
            tenantId,
            eleveId,
            date: appelDate,
            motif: "INJUSTIFIE",
            statut: "EN_ATTENTE",
            isRetard,
            heureDebut,
            heureFin: heureArrivee,
            saisieParId: session.user.id,
          },
        });
      });

    await prisma.$transaction(operations);

    // Compter les absents
    const absentsCount = Object.values(presences).filter((p) => p === "absent").length;
    const retardsCount = Object.values(presences).filter((p) => p === "retard").length;

    // --- Notifications automatiques aux parents (absents + retards) ---
    const signaleEleveIds = Object.entries(presences)
      .filter(([, status]) => status === "absent" || status === "retard")
      .map(([eleveId, status]) => ({ eleveId, status: status as "absent" | "retard" }));

    let notifSent = 0;
    let notifRecorded = 0;
    if (signaleEleveIds.length > 0) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true },
      });
      const ecoleNom = tenant?.name ?? "École Miriam";
      const dateStr = appelDate.toLocaleDateString("fr-FR");

      // Récupérer les élèves signalés avec leurs parents (tous les parents liés, pas seulement le gardien)
      const elevesSignales = await prisma.eleve.findMany({
        where: { id: { in: signaleEleveIds.map((e) => e.eleveId) }, tenantId, ...siteFilterForModel("eleve", session.user) },
        select: {
          id: true,
          nom: true,
          prenom: true,
          parents: {
            include: {
              parent: {
                select: {
                  id: true, nom: true, prenom: true,
                  phone: true, email: true, userId: true,
                  telegramChatId: true,
                },
              },
            },
          },
        },
      });

      // Toutes les notifications (enregistrement + SMS/WhatsApp/Telegram/Email) sont envoyées
      // en parallèle plutôt qu'en boucle séquentielle, pour ne pas bloquer la réponse HTTP
      // le temps de dizaines d'appels réseau successifs vers des API externes.
      type NotifTask = { kind: "record" | "sent"; run: () => Promise<void> };
      const tasks: NotifTask[] = [];

      for (const eleve of elevesSignales) {
        const statutInfo = signaleEleveIds.find((s) => s.eleveId === eleve.id);
        const isRetard = statutInfo?.status === "retard";
        const typeLabel = isRetard ? "retard" : "absence";
        const eleveNom = `${eleve.prenom} ${eleve.nom}`;

        // Préparer le contenu du message selon le type
        const titreNotif = isRetard
          ? `Retard signalé - ${eleveNom}`
          : `Absence signalée - ${eleveNom}`;
        const contenuNotif = isRetard
          ? `Bonjour,\n\nNous vous informons que ${eleveNom} a été signalé(e) en retard le ${dateStr}.\n\nVeuillez contacter l'établissement pour plus d'informations.\n\nCordialement,\n${ecoleNom}`
          : `Bonjour,\n\nNous vous informons que ${eleveNom} a été signalé(e) absent(e) le ${dateStr}.\n\nVeuillez contacter l'établissement pour régulariser cette absence.\n\nCordialement,\n${ecoleNom}`;

        // Enregistrer dans la signalétique (table Notification)
        tasks.push({
          kind: "record",
          run: async () => {
            await prisma.notification.create({
              data: {
                tenantId,
                titre: titreNotif,
                contenu: contenuNotif,
                canal: "IN_APP",
                cible: "PARENTS",
                envoyeParId: session.user.id,
                nbDestinataires: eleve.parents.length,
                nbDelivres: eleve.parents.length,
                statut: "ENVOYEE",
                envoyeeAt: new Date(),
              },
            });
          },
        });

        // Notifier chaque parent lié à l'élève
        for (const ep of eleve.parents) {
          const tuteur = ep.parent;
          if (!tuteur) continue;

          if (tuteur.phone) {
            tasks.push({
              kind: "sent",
              run: () => sendAbsenceAlert(tuteur.phone!, eleveNom, dateStr, ecoleNom).then(() => {}),
            });
            tasks.push({
              kind: "sent",
              run: () =>
                (isRetard
                  ? sendRetardWhatsApp(tuteur.phone!, eleveNom, dateStr, ecoleNom)
                  : sendAbsenceWhatsApp(tuteur.phone!, eleveNom, dateStr, ecoleNom)
                ).then(() => {}),
            });
          }

          if (tuteur.telegramChatId) {
            tasks.push({
              kind: "sent",
              run: () =>
                (isRetard
                  ? sendRetardTelegram(tuteur.telegramChatId!, eleveNom, dateStr, ecoleNom)
                  : sendAbsenceTelegram(tuteur.telegramChatId!, eleveNom, dateStr, ecoleNom)
                ).then(() => {}),
            });
          }

          if (tuteur.email) {
            tasks.push({
              kind: "sent",
              run: () => {
                const html = renderNotificationEmail(ecoleNom, titreNotif, contenuNotif);
                return sendEmail(
                  [tuteur.email!],
                  `[${ecoleNom}] ${typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)} de ${eleveNom}`,
                  html
                ).then(() => {});
              },
            });
          }
        }
      }

      const results = await Promise.allSettled(tasks.map((t) => t.run()));
      results.forEach((r, i) => {
        if (r.status === "fulfilled") {
          if (tasks[i].kind === "record") notifRecorded++;
          else notifSent++;
        } else {
          console.error(`[Appel] Notification (${tasks[i].kind}) échouée:`, r.reason);
        }
      });
    }

    revalidateTag("dashboard-data", "max");

    return NextResponse.json({
      success: true,
      message: `Appel enregistré : ${absentsCount} absent(s), ${retardsCount} retard(s)${notifSent > 0 ? `, ${notifSent} notification(s) envoyée(s)` : ""}${notifRecorded > 0 ? `, ${notifRecorded} notification(s) enregistrée(s)` : ""}`,
    });
  } catch (error) {
    console.error("[API/appel]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
