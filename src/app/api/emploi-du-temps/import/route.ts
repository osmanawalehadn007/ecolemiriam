import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForModel } from "@/lib/site-scope";
import { mergeFilters } from "@/lib/site-scope";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { fuzzyFind, fuzzyFindStrict, normalizeText } from "@/lib/text-match";
import { overlaps } from "@/lib/emploi-du-temps/suggest";
import {
  parseScheduleFile,
  snapCreneauToGrid,
  gridStepForStructure,
  type Jour,
  type RawCreneau,
  type DocxMetadata,
} from "@/lib/emploi-du-temps/import-parser";

/** Convertit "HH:MM" en minutes depuis minuit. */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Durée maximale de cours par jour : 12h45 = 765 minutes. */
const MAX_DAILY_MINUTES = 765;

/**
 * Extrait un suffixe numérique de niveau d'une matière brute.
 * Ex: "Lecture 1" → { nom: "Lecture", niveau: "1" }
 *     "Graphisme" → { nom: "Graphisme", niveau: null }
 */
function parseMatiereNiveau(raw: string): { nom: string; niveau: string | null } {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.+?)\s+(\d+)$/);
  if (match) {
    return { nom: match[1].trim(), niveau: match[2] };
  }
  return { nom: trimmed, niveau: null };
}

/**
 * POST /api/emploi-du-temps/import
 *
 * Corps : multipart/form-data
 *   - file      : fichier .xlsx ou .csv
 *   - classeId  : classe cible (les créneaux seront rattachés à cette classe)
 *
 * Réponse : un aperçu (preview) — AUCUNE écriture en base.
 *   {
 *     format, creneaux: [creneauPreview], unmatched, conflicts, stats
 *   }
 *
 * L'écriture effective se fait ensuite par le client via
 * /api/emploi-du-temps/bulk-apply (qui remplace l'emploi du temps de la classe).
 */

interface CreneauPreview {
  jour: Jour;
  heureDebut: string;
  heureFin: string;
  /** Durée du créneau en minutes (calculée depuis heureDebut/heureFin). */
  dureeMinutes: number;
  matiereId: string | null;
  matiereNom: string;
  matiereMatched: boolean;
  /** True si la matière a été auto-créée dans la DB lors de l'import. */
  matiereCreated: boolean;
  enseignantId: string | null;
  enseignantNom: string | null;
  enseignantMatched: boolean;
  salle: string | null;
  sourceLine: number;
  warnings: string[];
  status: "ok" | "warning" | "error";
  /** True si ce créneau est une évaluation/examen (pas un cours de matière). */
  isEvaluation: boolean;
}

interface ImportPreview {
  format: string;
  classeNom: string;
  creneaux: CreneauPreview[];
  unmatched: {
    matieres: { raw: string; suggestions: string[] }[];
    enseignants: { raw: string; suggestions: string[] }[];
  };
  conflicts: string[];
  stats: {
    total: number;
    ok: number;
    warning: number;
    error: number;
  };
  /** Total des heures de cours par jour (en minutes), hors récréation. */
  dailyTotals: { jour: Jour; totalMinutes: number; creneauCount: number }[];
  /** Avertissements sur le total horaire (ex: dépassement 12h45). */
  durationWarnings: string[];
  /** Matières auto-créées lors de l'import. */
  createdMatieres: { nom: string; code: string }[];
  /** Métadonnées extraites d'un .docx (classe détectée dans le texte, année, etc.). */
  docxMetadata?: DocxMetadata;
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "emploi-du-temps:write");
    if (denied) return denied;

    const formData = await req.formData();
    const file = formData.get("file");
    const classeId = formData.get("classeId");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });
    }
    if (!classeId || typeof classeId !== "string") {
      return NextResponse.json({ error: "classeId requis" }, { status: 400 });
    }

    const tenantId = session.user.tenantId;
    const siteFilter = siteFilterForModel("classe", session.user);

    // Vérifier que la classe existe et appartient au tenant/site de l'utilisateur
    const classe = await prisma.classe.findFirst({
      where: mergeFilters(
        { id: classeId, tenantId, ...siteFilter },
        anneeFilterForModel("classe", await getAnneeCouranteLibelle(tenantId)),
      ),
      select: {
        id: true,
        nom: true,
        structure: { select: { type: true } },
      },
    });
    if (!classe) {
      return NextResponse.json({ error: "Classe introuvable pour l'année en cours" }, { status: 404 });
    }

    // ── Parsing du fichier ──────────────────────────────────
    const buffer = Buffer.from(await file.arrayBuffer());
    const parseResult = await parseScheduleFile(buffer, file.name);

    if (parseResult.errors.length > 0) {
      return NextResponse.json({ error: parseResult.errors.join(" · ") }, { status: 400 });
    }
    if (parseResult.rawCreneaux.length === 0) {
      return NextResponse.json({ error: "Aucun créneau détecté dans le fichier" }, { status: 400 });
    }

    // ── Chargement des entités du tenant pour le matching ──
    const [matieres, enseignants, salles] = await Promise.all([
      prisma.matiere.findMany({
        where: { tenantId, ...siteFilterForModel("matiere", session.user) },
        select: { id: true, nom: true, code: true, couleur: true, niveau: true },
      }),
      prisma.enseignant.findMany({
        where: { tenantId, ...siteFilterForModel("enseignant", session.user) },
        include: { user: { select: { name: true } } },
      }),
      prisma.salle.findMany({
        where: { tenantId, ...siteFilterForModel("salle", session.user) },
        select: { id: true, nom: true },
      }),
    ]);

    // Index de recherche pour les matières (par nom, nom+niveau, ET par code)
    const matiereByNorm = new Map<string, { id: string; nom: string }>();
    for (const m of matieres) {
      matiereByNorm.set(normalizeText(m.nom), { id: m.id, nom: m.nom });
      if (m.niveau) matiereByNorm.set(`${normalizeText(m.nom)}::${m.niveau}`, { id: m.id, nom: m.nom });
      if (m.code) matiereByNorm.set(normalizeText(m.code), { id: m.id, nom: m.nom });
    }
    const matiereCandidates = matieres.map((m) => ({ id: m.id, nom: m.nom }));

    // Index pour les enseignants (par nom d'utilisateur)
    const enseignantByNorm = new Map<string, { id: string; nom: string }>();
    for (const e of enseignants) {
      const nom = e.user.name ?? "";
      if (nom) enseignantByNorm.set(normalizeText(nom), { id: e.id, nom });
    }
    const enseignantCandidates = enseignants
      .map((e) => ({ id: e.id, nom: e.user.name ?? "" }))
      .filter((e) => e.nom);

    // Index pour les salles
    const salleByNorm = new Map<string, string>();
    for (const s of salles) salleByNorm.set(normalizeText(s.nom), s.nom);

    // ── Snapping à la grille de la classe ──────────────────
    const stepMinutes = gridStepForStructure(classe.structure?.type);

    // ── Matching + snapping de chaque créneau brut ─────────
    const unmatchedMatieresMap = new Map<string, { raw: string; suggestions: string[] }>();
    const unmatchedEnseignantsMap = new Map<string, { raw: string; suggestions: string[] }>();
    const createdMatieresMap = new Map<string, { id: string; nom: string; code: string }>();

    // Helper : auto-créer une matière inconnue dans la DB
    async function autoCreateMatiere(nom: string, niveau: string | null = null): Promise<{ id: string; nom: string; code: string } | null> {
      const cacheKey = `${normalizeText(nom)}::${niveau ?? ""}`;
      // Vérifier le cache d'abord (peut avoir été créé dans une itération précédente)
      const cached = createdMatieresMap.get(cacheKey);
      if (cached) return cached;

      // Générer un code : 4 premières lettres du nom normalisé, en majuscules
      const norm = normalizeText(nom);
      const code = norm.substring(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, "X").padEnd(4, "0");

      try {
        const created = await prisma.matiere.create({
          data: {
            tenantId,
            nom,
            code,
            coefficient: 1,
            ...(niveau ? { niveau } : {}),
          },
        });
        const entry = { id: created.id, nom: created.nom, code: created.code };
        createdMatieresMap.set(cacheKey, entry);
        // Mettre à jour les index pour les itérations suivantes
        matiereByNorm.set(cacheKey, { id: created.id, nom: created.nom });
        matiereByNorm.set(norm, { id: created.id, nom: created.nom });
        matiereCandidates.push({ id: created.id, nom: created.nom });
        return entry;
      } catch {
        return null;
      }
    }

    // Helper : récupérer ou créer la matière "Évaluation" pour les créneaux d'évaluation
    let evaluationMatiereId: string | null = null;
    async function getOrCreateEvaluationMatiere(): Promise<string | null> {
      if (evaluationMatiereId) return evaluationMatiereId;
      // Chercher d'abord dans les matières existantes
      const norm = normalizeText("Évaluation");
      const existing = matiereByNorm.get(norm);
      if (existing) {
        evaluationMatiereId = existing.id;
        return evaluationMatiereId;
      }
      // Sinon, créer
      const created = await autoCreateMatiere("Évaluation");
      if (created) {
        evaluationMatiereId = created.id;
        // Retirer des "createdMatieres" pour ne pas l'afficher comme auto-créée
        // (c'est une matière système, pas une matière du fichier importé)
        createdMatieresMap.delete(norm);
        return evaluationMatiereId;
      }
      return null;
    }

    const creneaux: CreneauPreview[] = [];
    for (const raw of parseResult.rawCreneaux) {
      const warnings = [...raw.warnings];

      // Snapping grille
      const snapped = snapCreneauToGrid(raw.heureDebut, raw.heureFin, stepMinutes);
      warnings.push(...snapped.warnings);

      // Calcul de la durée en minutes
      const dureeMinutes = timeToMinutes(snapped.heureFin) - timeToMinutes(snapped.heureDebut);

      // ── Évaluation : utiliser une matière "Évaluation" dédiée ──
      if (raw.isEvaluation) {
        const evalMatiereId = await getOrCreateEvaluationMatiere();
        creneaux.push({
          jour: raw.jour,
          heureDebut: snapped.heureDebut,
          heureFin: snapped.heureFin,
          dureeMinutes,
          matiereId: evalMatiereId,
          matiereNom: "Évaluation",
          matiereMatched: !!evalMatiereId,
          matiereCreated: false,
          enseignantId: null,
          enseignantNom: raw.enseignant ?? null,
          enseignantMatched: false,
          salle: raw.salle ?? null,
          sourceLine: raw.sourceLine,
          warnings: evalMatiereId ? warnings : [...warnings, "Impossible de créer la matière Évaluation"],
          status: evalMatiereId ? (warnings.length > 0 ? "warning" : "ok") : "error",
          isEvaluation: true,
        });
        continue;
      }

      // ── Matching matière (avec auto-création si inconnue) ──
      let matiereId: string | null = null;
      let matiereNom = raw.matiere;
      let matiereMatched = false;
      let matiereCreated = false;
      if (raw.matiere) {
        const parsed = parseMatiereNiveau(raw.matiere);
        const normFull = normalizeText(raw.matiere);     // "lecture 1"
        const normBase = normalizeText(parsed.nom);       // "lecture"
        const normWithNiveau = parsed.niveau ? `${normBase}::${parsed.niveau}` : normBase;

        // 1) Recherche exacte d'abord : nom complet ("Lecture 1"), puis nom+niveau, puis nom base
        const exact = matiereByNorm.get(normFull)
          ?? matiereByNorm.get(normWithNiveau)
          ?? matiereByNorm.get(normBase);
        if (exact) {
          matiereId = exact.id;
          matiereNom = exact.nom;
          matiereMatched = true;
        } else {
          // 2) Fuzzy strict sur le nom SANS le suffixe numérique (fallback)
          //    — fuzzyFindStrict évite les faux positifs (préfixe ≥ 5 chars,
          //      needle ≥ 4 chars). "Graphisme" ne matchera pas "Écriture".
          const fuzzy = fuzzyFindStrict(matiereCandidates, parsed.nom);
          if (fuzzy.length === 1) {
            matiereId = fuzzy[0].id;
            matiereNom = fuzzy[0].nom;
            matiereMatched = true;
          } else if (fuzzy.length > 1) {
            // Plusieurs candidats : on prend le premier mais on avertit
            matiereId = fuzzy[0].id;
            matiereNom = fuzzy[0].nom;
            matiereMatched = true;
            warnings.push(`Matière « ${raw.matiere} » ambiguë → « ${fuzzy[0].nom} » (${fuzzy.length} correspondances)`);
          } else {
            // ── Auto-création de la matière inconnue ──
            // Préserver le nom complet (avec numéro de séance) si présent
            const created = await autoCreateMatiere(
              parsed.niveau ? raw.matiere : parsed.nom,
              parsed.niveau,
            );
            if (created) {
              matiereId = created.id;
              matiereNom = created.nom;
              matiereMatched = true;
              matiereCreated = true;
              warnings.push(`Matière « ${raw.matiere} » créée automatiquement (code: ${created.code})`);
            } else {
              if (!unmatchedMatieresMap.has(normWithNiveau)) {
                unmatchedMatieresMap.set(normWithNiveau, {
                  raw: raw.matiere,
                  suggestions: matieres.slice(0, 5).map((m) => m.nom),
                });
              }
              warnings.push(`Matière « ${raw.matiere} » introuvable et impossible à créer`);
            }
          }
        }
      } else {
        warnings.push("Matière manquante");
      }

      // Matching enseignant (optionnel)
      let enseignantId: string | null = null;
      let enseignantNom: string | null = raw.enseignant;
      let enseignantMatched = false;
      if (raw.enseignant) {
        const norm = normalizeText(raw.enseignant);
        const exact = enseignantByNorm.get(norm);
        if (exact) {
          enseignantId = exact.id;
          enseignantNom = exact.nom;
          enseignantMatched = true;
        } else {
          const fuzzy = fuzzyFind(enseignantCandidates, raw.enseignant);
          if (fuzzy.length >= 1) {
            enseignantId = fuzzy[0].id;
            enseignantNom = fuzzy[0].nom;
            enseignantMatched = true;
            if (fuzzy.length > 1) {
              warnings.push(`Enseignant « ${raw.enseignant} » ambigu → « ${fuzzy[0].nom} »`);
            }
          } else {
            if (!unmatchedEnseignantsMap.has(norm)) {
              unmatchedEnseignantsMap.set(norm, {
                raw: raw.enseignant,
                suggestions: enseignantCandidates.slice(0, 5).map((e) => e.nom),
              });
            }
            warnings.push(`Enseignant « ${raw.enseignant} » introuvable (sera non assigné)`);
          }
        }
      }

      // Matching salle (optionnel) — on garde le nom texte, pas d'ID requis
      let salle: string | null = raw.salle;
      if (salle) {
        const norm = normalizeText(salle);
        // Si la salle existe en base, on normalise vers son nom officiel
        const official = salleByNorm.get(norm);
        if (official) salle = official;
      }

      // Statut : les évaluations n'ont pas besoin de matière
      const hasError = !matiereId && !raw.isEvaluation;
      const status: CreneauPreview["status"] = hasError ? "error" : warnings.length > 0 ? "warning" : "ok";

      creneaux.push({
        jour: raw.jour,
        heureDebut: snapped.heureDebut,
        heureFin: snapped.heureFin,
        dureeMinutes,
        matiereId,
        matiereNom,
        matiereMatched,
        matiereCreated,
        enseignantId,
        enseignantNom,
        enseignantMatched,
        salle,
        sourceLine: raw.sourceLine,
        warnings,
        status,
        isEvaluation: raw.isEvaluation,
      });
    }

    // ── Détection des conflits internes au lot importé ────
    const conflicts: string[] = [];
    const validCreneaux = creneaux.filter((c) => c.matiereId);
    for (let i = 0; i < validCreneaux.length; i++) {
      for (let j = i + 1; j < validCreneaux.length; j++) {
        const a = validCreneaux[i];
        const b = validCreneaux[j];
        if (a.jour !== b.jour) continue;
        if (!overlaps(a.heureDebut, a.heureFin, b.heureDebut, b.heureFin)) continue;
        if (a.enseignantId && a.enseignantId === b.enseignantId) {
          conflicts.push(
            `Lignes ${a.sourceLine}/${b.sourceLine} : enseignant « ${a.enseignantNom} » en double le ${a.jour} (${a.heureDebut}-${a.heureFin}).`,
          );
        }
        if (a.salle && a.salle === b.salle) {
          conflicts.push(
            `Lignes ${a.sourceLine}/${b.sourceLine} : salle « ${a.salle} » en double le ${a.jour} (${a.heureDebut}-${a.heureFin}).`,
          );
        }
        // Conflit de classe = chevauchement sur la même classe (toujours vrai ici
        // puisque l'import cible une seule classe) → on signale les doublons horaire.
        conflicts.push(
          `Lignes ${a.sourceLine}/${b.sourceLine} : chevauchement horaire le ${a.jour} (${a.heureDebut}-${a.heureFin} vs ${b.heureDebut}-${b.heureFin}).`,
        );
      }
    }

    // ── Conflits avec les créneaux existants des AUTRES classes ──
    const annee = await getAnneeCouranteLibelle(tenantId);
    if (annee) {
      // EmploiTemps n'a pas de siteId direct : le filtre site doit passer par
      // la relation `classe` (SITE_PATHS["emploiTemps"] = { one: "classe" }).
      const emploiSiteFilter = siteFilterForModel("emploiTemps", session.user);
      const autres = await prisma.emploiTemps.findMany({
        where: { tenantId, ...emploiSiteFilter, annee, classeId: { not: classeId } },
        select: { jour: true, heureDebut: true, heureFin: true, enseignantId: true, salle: true },
      });
      for (const c of validCreneaux) {
        for (const a of autres) {
          if (a.jour !== c.jour) continue;
          if (!overlaps(a.heureDebut, a.heureFin, c.heureDebut, c.heureFin)) continue;
          if (c.enseignantId && a.enseignantId === c.enseignantId) {
            conflicts.push(
              `Ligne ${c.sourceLine} : enseignant « ${c.enseignantNom} » déjà engagé ailleurs le ${c.jour} (${c.heureDebut}).`,
            );
          }
          if (c.salle && a.salle === c.salle) {
            conflicts.push(
              `Ligne ${c.sourceLine} : salle « ${c.salle} » déjà occupée ailleurs le ${c.jour} (${c.heureDebut}).`,
            );
          }
        }
      }
    }

    const stats = {
      total: creneaux.length,
      ok: creneaux.filter((c) => c.status === "ok").length,
      warning: creneaux.filter((c) => c.status === "warning").length,
      error: creneaux.filter((c) => c.status === "error").length,
    };

    // ── Calcul des totaux horaires par jour (hors récréation) ──
    const JOURS_ORDER: Jour[] = ["DIMANCHE", "LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI"];
    const dailyMinutes = new Map<Jour, { totalMinutes: number; creneauCount: number }>();
    for (const c of creneaux) {
      const entry = dailyMinutes.get(c.jour) ?? { totalMinutes: 0, creneauCount: 0 };
      entry.totalMinutes += c.dureeMinutes;
      entry.creneauCount += 1;
      dailyMinutes.set(c.jour, entry);
    }
    const dailyTotals = JOURS_ORDER
      .filter((j) => dailyMinutes.has(j))
      .map((jour) => ({
        jour,
        totalMinutes: dailyMinutes.get(jour)!.totalMinutes,
        creneauCount: dailyMinutes.get(jour)!.creneauCount,
      }));

    // ── Avertissements de durée (max 12h45 = 765 min par jour) ──
    const durationWarnings: string[] = [];
    for (const dt of dailyTotals) {
      if (dt.totalMinutes > MAX_DAILY_MINUTES) {
        const excess = dt.totalMinutes - MAX_DAILY_MINUTES;
        const totalH = Math.floor(dt.totalMinutes / 60);
        const totalM = dt.totalMinutes % 60;
        const maxH = Math.floor(MAX_DAILY_MINUTES / 60);
        const maxM = MAX_DAILY_MINUTES % 60;
        durationWarnings.push(
          `${dt.jour} : ${totalH}h${String(totalM).padStart(2, "0")} de cours (dépasse la limite de ${maxH}h${String(maxM).padStart(2, "0")} de ${excess} min).`,
        );
      }
    }

    const preview: ImportPreview = {
      format: parseResult.format,
      classeNom: classe.nom,
      creneaux,
      unmatched: {
        matieres: [...unmatchedMatieresMap.values()],
        enseignants: [...unmatchedEnseignantsMap.values()],
      },
      conflicts,
      stats,
      dailyTotals,
      durationWarnings,
      createdMatieres: [...createdMatieresMap.values()].map((m) => ({ nom: m.nom, code: m.code })),
      docxMetadata: parseResult.docxMetadata,
    };

    return NextResponse.json(preview);
  } catch (error) {
    console.error("[API/emploi-du-temps/import]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
