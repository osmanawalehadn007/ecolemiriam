import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { calculerMoyenne } from "@/lib/utils";
import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForModel } from "@/lib/site-scope";
import { appreciationBareme, rangsCompetition } from "@/lib/bulletins/bareme";

const Schema = z.object({
  classeId: z.string().min(1),
  periodeId: z.string().min(1),
});

// Textes automatiques des anciennes versions : ils ne comptent pas comme une saisie du conseil de classe.
const APPRECIATIONS_AUTO_HISTORIQUES = new Set([
  "Travail à évaluer.",
  "Non noté",
  "Excellent trimestre. Résultats remarquables, continuez ainsi.",
  "Très bons résultats. Élève sérieux et appliqué.",
  "Bons résultats. Peut encore progresser avec plus d'efforts.",
  "Résultats satisfaisants. Des efforts supplémentaires sont attendus.",
  "Résultats moyens. Un travail plus régulier s'impose.",
  "Résultats insuffisants. Des difficultés persistantes nécessitent un suivi.",
  "Résultats très insuffisants. Un soutien scolaire est fortement recommandé.",
]);

type RegleAppreciation = { contexte: string; seuilMin: number; seuilMax: number; libelle: string };

// Cherche une règle configurée pour le contexte donné ; sinon retombe sur les seuils par défaut.
function genererAppréciation(
  moyenne: number | null,
  contexte: "NOTE_MATIERE" | "BULLETIN_PERIODE",
  regles: RegleAppreciation[]
): string {
  if (moyenne === null || moyenne === undefined) return "";
  const regle = regles.find(
    (r) => r.contexte === contexte && moyenne >= r.seuilMin && moyenne <= r.seuilMax
  );
  if (regle) return regle.libelle;
  return appreciationBareme(moyenne);
}

function calculateHours(heureDebut: string | null, heureFin: string | null): number {
  if (!heureDebut || !heureFin) return 4; // Demi-journée par défaut
  try {
    const [h1, m1] = heureDebut.split(':').map(Number);
    const [h2, m2] = heureFin.split(':').map(Number);
    let diff = (h2 + m2 / 60) - (h1 + m1 / 60);
    return diff > 0 ? diff : 4;
  } catch {
    return 4;
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "bulletins:write");
    if (denied) return denied;

    const body = await req.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Données invalides" }, { status: 400 });
    }

    const { classeId, periodeId } = parsed.data;
    const tenantId = session.user.tenantId;

    console.log("[generer] step 1: fetching classe");
    // eslint-disable-next-line ecolemiriam/require-annee-filter -- régénération possible sur une année révolue (correction d'archives) ; la période choisie porte l'année
    const classe = await prisma.classe.findFirst({
      where: { id: classeId, tenantId, ...siteFilterForModel("classe", session.user) },
      include: {
        eleves: { where: { statut: "ACTIF", ...siteFilterForModel("eleve", session.user) } },
      },
    });
    if (!classe) return NextResponse.json({ error: "Classe introuvable" }, { status: 404 });
    console.log("[generer] step 2: classe found", classe.nom, "eleves:", classe.eleves.length);

    const periode = await prisma.periode.findFirst({
      where: { id: periodeId, annee: { tenantId } },
    });
    if (!periode) return NextResponse.json({ error: "Période introuvable" }, { status: 404 });
    console.log("[generer] step 3: periode found", periode.nom);

    // Règles d'appréciation configurées pour ce tenant (repli sur les seuils par défaut si vide)
    console.log("[generer] step 4: fetching reglesAppreciation");
    const reglesAppreciation = await prisma.reglesAppreciation.findMany({
      where: { tenantId, ...siteFilterForModel("reglesAppreciation", session.user), contexte: { in: ["NOTE_MATIERE", "BULLETIN_PERIODE"] } },
      select: { contexte: true, seuilMin: true, seuilMax: true, libelle: true },
    }).catch((e: unknown) => {
      console.log("[generer] reglesAppreciation error (non-fatal):", e instanceof Error ? e.message : e);
      return [] as RegleAppreciation[];
    });
    console.log("[generer] step 5: reglesAppreciation fetched", reglesAppreciation.length);

    console.log("[generer] step 6: fetching notes");
    const allNotes = await prisma.note.findMany({
      where: { tenantId, ...siteFilterForModel("note", session.user), classeId, periodeId },
      include: { matiere: true },
    });
    console.log("[generer] step 7: notes fetched", allNotes.length);

    // Dispenses de matière : une matière dispensée est exclue du calcul de la moyenne.
    // Une dispense sans période (periodeId null) s'applique à toutes les périodes.
    console.log("[generer] step 8: fetching dispenses");
    const dispenses = await prisma.dispenseMatiere.findMany({
      where: { tenantId, ...siteFilterForModel("dispenseMatiere", session.user),
        eleveId: { in: classe.eleves.map((e) => e.id) },
        OR: [{ periodeId }, { periodeId: null }],
      },
      select: { eleveId: true, matiereId: true },
    }).catch((e: unknown) => {
      console.log("[generer] dispenses error (non-fatal):", e instanceof Error ? e.message : e);
      return [] as { eleveId: string; matiereId: string }[];
    });
    const dispenseSet = new Set(dispenses.map((d) => `${d.eleveId}:${d.matiereId}`));
    console.log("[generer] step 9: dispenses fetched", dispenses.length);

    console.log("[generer] step 10: fetching absences");
    const absences = await prisma.absence.findMany({
      where: { tenantId, ...siteFilterForModel("absence", session.user),
        eleveId: { in: classe.eleves.map(e => e.id) },
        date: { gte: periode.dateDebut, lte: periode.dateFin }
      }
    });
    console.log("[generer] step 11: absences fetched", absences.length);

    // Enseignant de chaque matière dans cette classe (affiché sous la matière du bulletin)
    const affectations = await prisma.enseignantAffectation.findMany({
      where: { tenantId, classeId, matiereId: { not: null } },
      include: { enseignant: { include: { user: { select: { name: true } } } } },
      orderBy: { createdAt: "asc" },
    }).catch(() => []);
    const profParMatiere = new Map<string, string>();
    for (const a of affectations) {
      if (a.matiereId && !profParMatiere.has(a.matiereId) && a.enseignant.user.name) {
        profParMatiere.set(a.matiereId, a.enseignant.user.name);
      }
    }

    // 1. Averages per subject per student
    const matieresMap = new Map<string, any>();
    const eleveMatiereMoyennes: Record<string, Record<string, number>> = {};
    const matiereStats: Record<string, { max: number, min: number }> = {};

    for (const note of allNotes) {
      if (!matieresMap.has(note.matiereId)) {
        matieresMap.set(note.matiereId, note.matiere);
        eleveMatiereMoyennes[note.matiereId] = {};
      }
    }

    for (const [matiereId, matiere] of matieresMap.entries()) {
      let max = -1, min = 21;
      for (const eleve of classe.eleves) {
        if (dispenseSet.has(`${eleve.id}:${matiereId}`)) continue; // élève dispensé : exclu des stats/rang
        const notesEleve = allNotes.filter(n => n.eleveId === eleve.id && n.matiereId === matiereId);
        if (notesEleve.length > 0) {
          const moy = calculerMoyenne(notesEleve.map(n => ({ valeur: n.valeur, noteMax: n.noteMax, coefficient: n.coefficient })));
          if (moy !== null) {
            eleveMatiereMoyennes[matiereId][eleve.id] = moy;
            if (moy > max) max = moy;
            if (moy < min) min = moy;
          }
        }
      }
      matiereStats[matiereId] = { max: max === -1 ? 0 : max, min: min === 21 ? 0 : min };
    }

    // 2. Generate bulletins for each student (sequential to avoid connection pool exhaustion)
    console.log("[generer] step 12: generating bulletins for", classe.eleves.length, "students");
    // Bulletins déjà générés : on conserve l'appréciation saisie au conseil de classe et
    // on dépublie un bulletin publié dont la moyenne change.
    const existants = new Map(
      (await prisma.bulletin.findMany({
        where: { tenantId, ...siteFilterForModel("bulletin", session.user), periodeId, eleveId: { in: classe.eleves.map((e) => e.id) } },
        select: { eleveId: true, appreciation: true, moyenneGenerale: true, isPublie: true },
      })).map((b) => [b.eleveId, b])
    );
    let depublies = 0;
    const bulletinsGlobalAverages: { eleveId: string; moyenne: number | null }[] = [];
    for (const eleve of classe.eleves) {
      const absEleve = absences.filter(a => a.eleveId === eleve.id);
      const heuresAbsence = Math.round(absEleve.reduce((acc, a) => acc + calculateHours(a.heureDebut, a.heureFin), 0));

      let totalCoef = 0;
      let totalPoints = 0;
      const matieresToSave: {
        matiereId: string;
        nomProfesseur: string;
        coefficient: number;
        moyenneEleve: number | null;
        rang: number | null;
        moyenneMax: number;
        moyenneMin: number;
        appreciation: string;
      }[] = [];

      for (const [matiereId, matiere] of matieresMap.entries()) {
        const isDispense = dispenseSet.has(`${eleve.id}:${matiereId}`);
        const moy = isDispense ? null : (eleveMatiereMoyennes[matiereId]?.[eleve.id] ?? null);

        // Matière dispensée : exclue de la moyenne générale, ligne conservée avec la mention "Dispensé(e)"
        if (isDispense) {
          matieresToSave.push({
            matiereId,
            nomProfesseur: profParMatiere.get(matiereId) ?? "",
            coefficient: matiere.coefficient,
            moyenneEleve: null,
            rang: null,
            moyenneMax: matiereStats[matiereId].max,
            moyenneMin: matiereStats[matiereId].min,
            appreciation: "Dispensé(e)",
          });
          continue;
        }

        if (moy !== null) {
          totalPoints += moy * matiere.coefficient;
          totalCoef += matiere.coefficient;
        }

        // Rang de l'élève dans cette matière
        let rangMatiere = null;
        if (moy !== null) {
          rangMatiere = 1 + Object.values(eleveMatiereMoyennes[matiereId] || {}).filter((o) => o > moy).length;
        }

        matieresToSave.push({
          matiereId,
          nomProfesseur: profParMatiere.get(matiereId) ?? "",
          coefficient: matiere.coefficient,
          moyenneEleve: moy,
          rang: rangMatiere,
          moyenneMax: matiereStats[matiereId].max,
          moyenneMin: matiereStats[matiereId].min,
          appreciation: moy !== null ? genererAppréciation(moy, "NOTE_MATIERE", reglesAppreciation) : ""
        });
      }

      const moyenneGenerale = totalCoef > 0 ? Number((totalPoints / totalCoef).toFixed(2)) : null;
      const appreciation = genererAppréciation(moyenneGenerale, "BULLETIN_PERIODE", reglesAppreciation);

      const existant = existants.get(eleve.id);
      // Appréciation saisie à la main : elle diffère de celle que le barème donnait à l'ancienne moyenne.
      const appreciationManuelle =
        existant?.appreciation && !APPRECIATIONS_AUTO_HISTORIQUES.has(existant.appreciation) && existant.appreciation !== genererAppréciation(existant.moyenneGenerale, "BULLETIN_PERIODE", reglesAppreciation)
          ? existant.appreciation
          : null;
      const doitDepublier = !!existant?.isPublie && existant.moyenneGenerale !== moyenneGenerale;
      if (doitDepublier) depublies++;

      // Save bulletin
      const bulletin = await prisma.bulletin.upsert({
        where: { eleveId_periodeId: { eleveId: eleve.id, periodeId } },
        update: {
          moyenneGenerale,
          heuresAbsence,
          appreciation: appreciationManuelle ?? appreciation,
          effectifClasse: classe.eleves.length,
          ...(doitDepublier ? { isPublie: false, publishedAt: null } : {}),
        },
        create: {
          tenantId,
          eleveId: eleve.id,
          periodeId,
          moyenneGenerale,
          heuresAbsence,
          appreciation,
          effectifClasse: classe.eleves.length,
        },
      });

      // Update BulletinMatieres
      await prisma.bulletinMatiere.deleteMany({ where: { bulletinId: bulletin.id, tenantId } });
      if (matieresToSave.length > 0) {
        await prisma.bulletinMatiere.createMany({
          data: matieresToSave.map(m => ({
            ...m,
            bulletinId: bulletin.id,
            tenantId,
          }))
        });
      }

      bulletinsGlobalAverages.push({ eleveId: eleve.id, moyenne: moyenneGenerale });
    }

    // 3. Update global rankings and class averages
    console.log("[generer] step 13: computing rankings");
    const validMoyennes = bulletinsGlobalAverages.filter(b => b.moyenne !== null).map(b => b.moyenne as number);
    const moyenneClasse = validMoyennes.length > 0 ? Number((validMoyennes.reduce((a, b) => a + b, 0) / validMoyennes.length).toFixed(2)) : null;
    const moyennePremier = validMoyennes.length > 0 ? Math.max(...validMoyennes) : null;

    const rangs = rangsCompetition(bulletinsGlobalAverages.map((b) => b.moyenne));

    console.log("[generer] step 14: updating bulletins with rankings");
    for (let i = 0; i < bulletinsGlobalAverages.length; i++) {
      const b = bulletinsGlobalAverages[i];
      // `updateMany` plutôt qu'`update` : la contrainte unique (eleveId,
      // periodeId) désigne la même ligne, mais le `where` accepte ici
      // `tenantId`, ce qui interdit d'écrire sur le bulletin d'un autre
      // établissement si un identifiant venait à être forgé.
      await prisma.bulletin.updateMany({
        where: { eleveId: b.eleveId, periodeId, tenantId },
        data: {
          rang: rangs[i],
          moyenneClasse,
          moyennePremier
        }
      });
    }

    console.log("[generer] step 15: done, count:", classe.eleves.length);
    return NextResponse.json({ success: true, count: classe.eleves.length, depublies });
  } catch (error) {
    console.error("[API/bulletins/generer]", error);
    const message = error instanceof Error ? error.message : "Erreur inconnue";
    return NextResponse.json({ error: "Erreur serveur", detail: message }, { status: 500 });
  }
}
