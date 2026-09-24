import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import { siteFilterForModel } from "@/lib/site-scope";

/**
 * GET /api/bulletins/stats-classe?classeId=...&periodeId=...
 *
 * Statistiques de classe :
 * - Taux de réussite global et par matière
 * - Moyenne de classe, médiane, écart-type
 * - Évolution des moyennes entre périodes
 * - Classement des élèves
 * - Répartition des décisions
 * - Top/bottom élèves
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const denied = checkPermission(session.user.role, "bulletins:read");
  if (denied) return denied;
  // Les routes agrégées par classe exposent les données de tous les élèves :
  // restreindre aux rôles administratifs/pédagogiques. Les PARENT/STUDENT
  // passent par /api/bulletins/list et /api/bulletins/preview qui filtrent
  // par filiation.
  if (session.user.role === "PARENT" || session.user.role === "STUDENT") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const classeId = searchParams.get("classeId");
  const periodeId = searchParams.get("periodeId");

  if (!classeId || !periodeId) {
    return NextResponse.json({ error: "classeId et periodeId requis" }, { status: 400 });
  }

  const tenantId = session.user.tenantId;

  // 1. Bulletins de la classe pour la période
  const bulletins = await prisma.bulletin.findMany({
    where: {
      eleve: { classeId, tenantId },
      periodeId,
      tenantId,
      ...siteFilterForModel("bulletin", session.user),
    },
    include: {
      eleve: { select: { id: true, nom: true, prenom: true, matricule: true } },
      // eslint-disable-next-line ecolemiriam/require-site-filter -- include filtré par le where parent (tenantId sur la table racine)
      matieres: { include: { matiere: { select: { id: true, nom: true, code: true } } } },
    },
  });

  if (bulletins.length === 0) {
    return NextResponse.json({ error: "Aucun bulletin trouvé" }, { status: 404 });
  }

  // 2. Toutes les périodes pour l'évolution
  const periodes = await prisma.periode.findMany({
    where: { annee: { tenantId } },
    orderBy: { numero: "asc" },
    select: { id: true, nom: true, numero: true },
  });

  // 3. Stats globales
  const moyennes = bulletins
    .map((b) => b.moyenneGenerale)
    .filter((m): m is number => m !== null);

  const moyenneClasse = moyennes.length > 0 ? moyennes.reduce((a, b) => a + b, 0) / moyennes.length : 0;
  const mediane = moyennes.length > 0 ? median(moyennes) : 0;
  const ecartType = moyennes.length > 0 ? stdDev(moyennes, moyenneClasse) : 0;
  const tauxReussite = moyennes.length > 0 ? (moyennes.filter((m) => m >= 10).length / moyennes.length) * 100 : 0;
  const meilleureNote = moyennes.length > 0 ? Math.max(...moyennes) : 0;
  const plusBasseNote = moyennes.length > 0 ? Math.min(...moyennes) : 0;

  // 4. Taux de réussite par matière
  const matiereStats = new Map<string, { nom: string; code: string; moyennes: number[]; tauxReussite: number; moyenne: number; effectif: number }>();
  for (const b of bulletins) {
    for (const bm of b.matieres) {
      if (bm.moyenneEleve === null) continue;
      const key = bm.matiere.id;
      if (!matiereStats.has(key)) {
        matiereStats.set(key, { nom: bm.matiere.nom, code: bm.matiere.code, moyennes: [], tauxReussite: 0, moyenne: 0, effectif: 0 });
      }
      const ms = matiereStats.get(key)!;
      ms.moyennes.push(bm.moyenneEleve);
      ms.effectif++;
    }
  }
  const matieresStats = Array.from(matiereStats.entries()).map(([id, ms]) => ({
    id,
    nom: ms.nom,
    code: ms.code,
    moyenne: ms.moyennes.reduce((a, b) => a + b, 0) / ms.moyennes.length,
    tauxReussite: (ms.moyennes.filter((m) => m >= 10).length / ms.moyennes.length) * 100,
    effectif: ms.effectif,
    meilleure: Math.max(...ms.moyennes),
    plusBasse: Math.min(...ms.moyennes),
  }));

  // 5. Classement
  const classement = bulletins
    .filter((b) => b.moyenneGenerale !== null)
    .sort((a, b) => (b.moyenneGenerale ?? 0) - (a.moyenneGenerale ?? 0))
    .map((b, idx) => ({
      rang: idx + 1,
      eleveId: b.eleve.id,
      nom: `${b.eleve.prenom} ${b.eleve.nom}`,
      matricule: b.eleve.matricule,
      moyenne: b.moyenneGenerale,
      decision: b.decision,
    }));

  // 6. Répartition des décisions
  const decisions = {
    FELICITATIONS: bulletins.filter((b) => b.decision === "FELICITATIONS").length,
    ENCOURAGEMENTS: bulletins.filter((b) => b.decision === "ENCOURAGEMENTS").length,
    PASSAGE: bulletins.filter((b) => b.decision === "PASSAGE").length,
    AVERTISSEMENT: bulletins.filter((b) => b.decision === "AVERTISSEMENT").length,
    REDOUBLEMENT: bulletins.filter((b) => b.decision === "REDOUBLEMENT").length,
    NON_RENSEIGNE: bulletins.filter((b) => !b.decision).length,
  };

  // 7. Évolution entre périodes (moyenne de classe par période)
  const evolution: Array<{ periodeId: string; periodeNom: string; moyenne: number; effectif: number }> = [];
  for (const periode of periodes) {
    const buls = await prisma.bulletin.findMany({
      where: {
        eleve: { classeId, tenantId },
        periodeId: periode.id,
        tenantId,
        ...siteFilterForModel("bulletin", session.user),
      },
      select: { moyenneGenerale: true },
    });
    const moys = buls.map((b) => b.moyenneGenerale).filter((m): m is number => m !== null);
    if (moys.length > 0) {
      evolution.push({
        periodeId: periode.id,
        periodeNom: periode.nom,
        moyenne: moys.reduce((a, b) => a + b, 0) / moys.length,
        effectif: moys.length,
      });
    }
  }

  // 8. Top 5 et bottom 5
  const top5 = classement.slice(0, 5);
  const bottom5 = classement.slice(-5).reverse();

  return NextResponse.json({
    effectif: bulletins.length,
    moyenneClasse: round2(moyenneClasse),
    mediane: round2(mediane),
    ecartType: round2(ecartType),
    tauxReussite: round2(tauxReussite),
    meilleureNote: round2(meilleureNote),
    plusBasseNote: round2(plusBasseNote),
    matieresStats: matieresStats.map((m) => ({
      ...m,
      moyenne: round2(m.moyenne),
      tauxReussite: round2(m.tauxReussite),
      meilleure: round2(m.meilleure),
      plusBasse: round2(m.plusBasse),
    })),
    classement,
    decisions,
    evolution: evolution.map((e) => ({ ...e, moyenne: round2(e.moyenne) })),
    top5,
    bottom5,
  });
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stdDev(arr: number[], mean: number): number {
  const variance = arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
