"use server";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { revalidatePath, revalidateTag } from "next/cache";
import { checkPermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { getAnneeCourante, getAnneeCouranteLibelle, setAnneeCourante, invalidateAnneeCourante } from "@/lib/annee-scolaire";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { mergeFilters } from "@/lib/site-scope";
import { siteFilterForModel } from "@/lib/site-scope";
import { niveauSuivant } from "@/lib/niveau-suivant";
import { notifyDirection } from "@/lib/notifications/notify-direction";
import { reserverNumerosFacture } from "@/lib/facture-numero";
import type { Role } from "@prisma/client";

// ============================================================
// RÉINSCRIPTION — PROCÉDURE UNIFIÉE DE FIN D'ANNÉE
// ============================================================
//
// Workflow en 4 étapes :
//  1. Activer la nouvelle année scolaire
//  2. Promouvoir les élèves (changement de classe automatique)
//  3. Générer les frais de renouvellement
//  4. Générer les mensualités du premier mois
//
// Chaque étape peut être exécutée indépendamment ou enchaînée.
// L'UI présente un wizard step-by-step avec aperçu avant action.

// ────────────────────────────────────────────────────────────
// Helpers : mapping des niveaux pour la promotion automatique
// ────────────────────────────────────────────────────────────
// niveauSuivant() est dans src/lib/niveau-suivant.ts (fonction synchrone
// non-exportable depuis un module "use server")

// ────────────────────────────────────────────────────────────
// Étape 0 : Préparation — collecter les données pour l'aperçu
// ────────────────────────────────────────────────────────────

export interface ApercuReinscription {
  anneeCourante: { id: string; libelle: string; dateDebut: Date; dateFin: Date } | null;
  anneesDisponibles: { id: string; libelle: string; dateDebut: Date; dateFin: Date; isCurrent: boolean }[];
  totalElevesActifs: number;
  elevesParNiveau: { niveau: string; count: number; niveauSuivant: string | null | undefined }[];
  classesParNiveau: { niveau: string; classes: { id: string; nom: string; siteNom: string | null }[] }[];
  tarifsConfigures: { niveau: string; mensualite: number; fraisRenouvellement: number }[];
  // Élèves qui ne peuvent pas être promus automatiquement
  elevesSansPromotion: { id: string; nom: string; prenom: string; matricule: string; niveau: string; classeNom: string }[];
  // Élèves qui seront diplomés
  elevesDiplomes: { id: string; nom: string; prenom: string; matricule: string; classeNom: string }[];
}

export async function preparerApercuReinscription(): Promise<ApercuReinscription> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "eleves:write");
  if (denied) throw new Error("Accès refusé");

  const tenantId = session.user.tenantId;

  // 1. Année courante + années disponibles
  const [anneeCourante, anneesDisponibles] = await Promise.all([
    getAnneeCourante(tenantId),
    prisma.anneesScolaires.findMany({
      where: { tenantId },
      orderBy: { dateDebut: "desc" },
    }),
  ]);

  // 2. Tous les élèves actifs avec leur classe
  const siteFilter = siteFilterForModel("eleve", session.user);
   
  const eleves = await prisma.eleve.findMany({
    where: { tenantId, statut: "ACTIF", deletedAt: null, ...siteFilter },
    include: { classe: { select: { id: true, nom: true, niveau: true, site: { select: { nom: true } } } } },
  });

  // 3. Classes d'accueil : celles de l'année courante, qui sert de référence
  //    pour projeter la promotion. Sans cette borne, l'aperçu comptait aussi
  //    les classes des années révolues et annonçait des places inexistantes.
  const classeSiteFilter = siteFilterForModel("classe", session.user);
  const anneeReference = anneeCourante?.libelle ?? null;
   
  const classes = await prisma.classe.findMany({
    where: mergeFilters(
      { tenantId },
      classeSiteFilter,
      anneeFilterForModel("classe", anneeReference),
    ),
    select: { id: true, nom: true, niveau: true, site: { select: { nom: true } } },
  });

  // 4. Tarifs configurés pour l'année suivante
  const anneeSuivanteLibelle = anneeCourante
    ? incrementerAnnee(anneeCourante.libelle)
    : null;
  const tarifs = anneeSuivanteLibelle
    ? await prisma.tarifNiveau.findMany({
        where: { tenantId, annee: anneeSuivanteLibelle, actif: true },
      })
    : [];

  // 5. Grouper les élèves par niveau
  const parNiveau = new Map<string, number>();
  for (const e of eleves) {
    const niveau = e.classe?.niveau ?? "Inconnu";
    parNiveau.set(niveau, (parNiveau.get(niveau) ?? 0) + 1);
  }

  const elevesParNiveau = Array.from(parNiveau.entries())
    .map(([niveau, count]) => ({
      niveau,
      count,
      niveauSuivant: niveauSuivant(niveau),
    }))
    .sort((a, b) => a.niveau.localeCompare(b.niveau));

  // 6. Grouper les classes par niveau
  const classesParNiveauMap = new Map<string, { id: string; nom: string; siteNom: string | null }[]>();
  for (const c of classes) {
    const arr = classesParNiveauMap.get(c.niveau) ?? [];
    arr.push({ id: c.id, nom: c.nom, siteNom: c.site?.nom ?? null });
    classesParNiveauMap.set(c.niveau, arr);
  }
  const classesParNiveau = Array.from(classesParNiveauMap.entries())
    .map(([niveau, classes]) => ({ niveau, classes }))
    .sort((a, b) => a.niveau.localeCompare(b.niveau));

  // 7. Identifier les élèves sans promotion auto et les diplomés
  const elevesSansPromotion: ApercuReinscription["elevesSansPromotion"] = [];
  const elevesDiplomes: ApercuReinscription["elevesDiplomes"] = [];

  for (const e of eleves) {
    const niveau = e.classe?.niveau ?? "Inconnu";
    const suivant = niveauSuivant(niveau);
    if (suivant === null) {
      // Terminale → diplomé
      elevesDiplomes.push({
        id: e.id,
        nom: e.nom,
        prenom: e.prenom,
        matricule: e.matricule,
        classeNom: e.classe?.nom ?? "Sans classe",
      });
    } else if (suivant === undefined) {
      // Niveau non reconnu → promotion manuelle
      elevesSansPromotion.push({
        id: e.id,
        nom: e.nom,
        prenom: e.prenom,
        matricule: e.matricule,
        niveau,
        classeNom: e.classe?.nom ?? "Sans classe",
      });
    }
  }

  return {
    anneeCourante: anneeCourante
      ? {
          id: anneeCourante.id,
          libelle: anneeCourante.libelle,
          dateDebut: anneeCourante.dateDebut,
          dateFin: anneeCourante.dateFin,
        }
      : null,
    anneesDisponibles: anneesDisponibles.map((a) => ({
      id: a.id,
      libelle: a.libelle,
      dateDebut: a.dateDebut,
      dateFin: a.dateFin,
      isCurrent: a.isCurrent,
    })),
    totalElevesActifs: eleves.length,
    elevesParNiveau,
    classesParNiveau,
    tarifsConfigures: tarifs.map((t) => ({
      niveau: t.niveau,
      mensualite: t.mensualite,
      fraisRenouvellement: t.fraisRenouvellement,
    })),
    elevesSansPromotion,
    elevesDiplomes,
  };
}

// ────────────────────────────────────────────────────────────
// Étape 1 : Activer la nouvelle année scolaire
// ────────────────────────────────────────────────────────────

export async function activerAnneePourReinscription(anneeId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "parametres:write");
  if (denied) throw new Error("Accès refusé");

  await setAnneeCourante(session.user.tenantId, anneeId);

  await audit({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    action: "reinscription.activer_annee",
    verdict: "ALLOWED",
    resource: "annees_scolaires",
    resourceId: anneeId,
    reason: "Activation année scolaire via procédure de réinscription",
  });

  revalidatePath("/reinscription");
  revalidatePath("/parametres");
  return { success: true };
}

// ────────────────────────────────────────────────────────────
// Étape 2 : Promouvoir les élèves (changement de classe auto)
// ────────────────────────────────────────────────────────────

export interface ResultatPromotion {
  promus: number;
  diplomes: number;
  sansChangement: number; // niveau non reconnu ou classe suivante introuvable
  details: Array<{
    eleveId: string;
    nom: string;
    prenom: string;
    ancienneClasse: string;
    nouvelleClasse: string | null;
    action: "PROMU" | "DIPLOME" | "MANUEL";
  }>;
}

export async function promouvoirEleves(): Promise<ResultatPromotion> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "eleves:write");
  if (denied) throw new Error("Accès refusé");

  const tenantId = session.user.tenantId;
  const siteFilter = siteFilterForModel("eleve", session.user);

  // 1. Charger tous les élèves actifs + classes
   
  const eleves = await prisma.eleve.findMany({
    where: { tenantId, statut: "ACTIF", deletedAt: null, ...siteFilter },
    include: { classe: { select: { id: true, nom: true, niveau: true, siteId: true } } },
  });

  // 2. Charger les classes d'ACCUEIL (pour trouver la classe du niveau suivant).
  //    La promotion vise l'année scolaire nouvellement activée : sans cette
  //    borne, un élève pouvait être promu vers une classe homonyme d'une
  //    année révolue restée en base — exactement le défaut qui avait rattaché
  //    des inscriptions 2026-2027 à des structures 2025-2026.
  const classeSiteFilter = siteFilterForModel("classe", session.user);
  const anneeCible = await getAnneeCouranteLibelle(tenantId);
   
  const allClasses = await prisma.classe.findMany({
    where: mergeFilters(
      { tenantId },
      classeSiteFilter,
      anneeFilterForModel("classe", anneeCible),
    ),
    select: { id: true, nom: true, niveau: true, siteId: true },
  });

  // Indexer les classes par (niveau + siteId) pour trouver la classe suivante
  // On privilégie la classe du même site, sinon on prend la première du niveau
  const classesByNiveauSite = new Map<string, typeof allClasses>();
  for (const c of allClasses) {
    const key = `${c.niveau.toLowerCase()}|${c.siteId ?? "null"}`;
    const arr = classesByNiveauSite.get(key) ?? [];
    arr.push(c);
    classesByNiveauSite.set(key, arr);
  }

  // 3. Calculer les promotions en mémoire
  const updates: Array<{ eleveId: string; nouvelleClasseId: string | null; statut: "ACTIF" | "DIPLOME" }> = [];
  const details: ResultatPromotion["details"] = [];

  for (const eleve of eleves) {
    const niveau = eleve.classe?.niveau ?? "Inconnu";
    const siteId = eleve.classe?.siteId ?? eleve.siteId ?? null;
    const suivant = niveauSuivant(niveau);

    if (suivant === null) {
      // Terminale → diplomé
      updates.push({ eleveId: eleve.id, nouvelleClasseId: null, statut: "DIPLOME" });
      details.push({
        eleveId: eleve.id,
        nom: eleve.nom,
        prenom: eleve.prenom,
        ancienneClasse: eleve.classe?.nom ?? "Sans classe",
        nouvelleClasse: null,
        action: "DIPLOME",
      });
    } else if (suivant === undefined || !eleve.classe) {
      // Niveau non reconnu ou sans classe → pas de changement
      details.push({
        eleveId: eleve.id,
        nom: eleve.nom,
        prenom: eleve.prenom,
        ancienneClasse: eleve.classe?.nom ?? "Sans classe",
        nouvelleClasse: null,
        action: "MANUEL",
      });
    } else {
      // Trouver la classe du niveau suivant (même site en priorité)
      const key = `${suivant.toLowerCase()}|${siteId ?? "null"}`;
      let classesSuivantes = classesByNiveauSite.get(key);
      if (!classesSuivantes || classesSuivantes.length === 0) {
        // Fallback : n'importe quelle classe du niveau suivant
        const fallbackKey = `${suivant.toLowerCase()}|null`;
        classesSuivantes = classesByNiveauSite.get(fallbackKey);
      }

      if (classesSuivantes && classesSuivantes.length > 0) {
        // Prendre la première classe disponible du niveau suivant
        const nouvelleClasse = classesSuivantes[0];
        updates.push({ eleveId: eleve.id, nouvelleClasseId: nouvelleClasse.id, statut: "ACTIF" });
        details.push({
          eleveId: eleve.id,
          nom: eleve.nom,
          prenom: eleve.prenom,
          ancienneClasse: eleve.classe.nom,
          nouvelleClasse: nouvelleClasse.nom,
          action: "PROMU",
        });
      } else {
        // Classe du niveau suivant introuvable → manuel
        details.push({
          eleveId: eleve.id,
          nom: eleve.nom,
          prenom: eleve.prenom,
          ancienneClasse: eleve.classe.nom,
          nouvelleClasse: null,
          action: "MANUEL",
        });
      }
    }
  }

  // 4. Exécuter les mises à jour en batch (transaction)
  // On groupe par (nouvelleClasseId, statut) pour faire des updateMany
  const promus = updates.filter((u) => u.statut === "ACTIF" && u.nouvelleClasseId);
  const diplomes = updates.filter((u) => u.statut === "DIPLOME");

  await prisma.$transaction(async (tx) => {
    // Diplômés : retirer de la classe + changer statut
    if (diplomes.length > 0) {
      await tx.eleve.updateMany({
        where: { id: { in: diplomes.map((d) => d.eleveId) } },
        data: { classeId: null, statut: "DIPLOME" },
      });
    }

    // Promus : changer de classe (un par un car updateMany ne supporte pas
    // des valeurs différentes par ligne — mais c'est une seule transaction)
    for (const u of promus) {
      await tx.eleve.update({
        where: { id: u.eleveId },
        data: { classeId: u.nouvelleClasseId },
      });
    }
  });

  const promusCount = promus.length;
  const diplomesCount = diplomes.length;
  const sansChangement = eleves.length - promusCount - diplomesCount;

  await audit({
    tenantId,
    userId: session.user.id,
    action: "reinscription.promouvoir",
    verdict: "ALLOWED",
    resource: "eleves",
    reason: `Promotion automatique: ${promusCount} promus, ${diplomesCount} diplômés, ${sansChangement} manuels`,
    metadata: { promus: promusCount, diplomes: diplomesCount, manuels: sansChangement },
  });

  // Notifier la direction de la promotion effectuée
  await notifyDirection({
    tenantId,
    titre: "Promotion des élèves effectuée",
    contenu: `La promotion automatique a été effectuée par ${session.user.name ?? "un utilisateur"}.\n\nRésumé :\n• ${promusCount} élève(s) promu(s) au niveau supérieur\n• ${diplomesCount} élève(s) diplômé(s)\n• ${sansChangement} élève(s) en promotion manuelle`,
    envoyeParId: session.user.id,
  });

  revalidatePath("/eleves");
  revalidatePath("/reinscription");
  revalidateTag("eleves-stats", "max");
  revalidateTag("dashboard-data", "max");

  return { promus: promusCount, diplomes: diplomesCount, sansChangement, details };
}

// ────────────────────────────────────────────────────────────
// Étape 3 : Générer les frais de renouvellement
// ────────────────────────────────────────────────────────────

export async function genererFraisRenouvellement(annee: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "finance:write");
  if (denied) throw new Error("Accès refusé");

  const tenantId = session.user.tenantId;
  const siteFilter = siteFilterForModel("eleve", session.user);

  // 1. Tous les élèves actifs
   
  const eleves = await prisma.eleve.findMany({
    where: { tenantId, statut: "ACTIF", deletedAt: null, ...siteFilter },
    include: { classe: { select: { niveau: true } } },
  });

  // 2. Tarifs pour l'année cible
  // Indexation à deux niveaux : tarifs site-spécifique (prioritaires) + tarifs globaux
  // Clé: `${niveau}|${siteId}` → un tarif global a siteId=null
  const tarifs = await prisma.tarifNiveau.findMany({
    where: { tenantId, annee, actif: true },
  });
  const tarifByNiveauSite = new Map<string, typeof tarifs[0]>();
  const tarifByNiveauGlobal = new Map<string, typeof tarifs[0]>();
  for (const t of tarifs) {
    if (t.siteId) {
      tarifByNiveauSite.set(`${t.niveau.toLowerCase()}|${t.siteId}`, t);
    } else {
      tarifByNiveauGlobal.set(t.niveau.toLowerCase(), t);
    }
  }
  // Lookup : tarif site-spécifique en priorité, fallback sur global
  function findTarif(niveau: string, siteId: string | null) {
    const key = `${niveau.toLowerCase()}|${siteId}`;
    return tarifByNiveauSite.get(key) ?? tarifByNiveauGlobal.get(niveau.toLowerCase());
  }

  const libelle = `Frais de renouvellement ${annee}`;
  const echeance = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // 3. Batch : vérifier les factures existantes
  const elevesAvecTarif = eleves.filter((e) => {
    const niveau = e.classe?.niveau ?? "Inconnu";
    return findTarif(niveau, e.siteId ?? null) !== undefined;
  });

  // eslint-disable-next-line ecolemiriam/require-site-filter -- bulk check, tenantId dans le where
  const existing = await prisma.facture.findMany({
    where: {
      tenantId,
      eleveId: { in: elevesAvecTarif.map((e) => e.id) },
      type: "RENOUVELLEMENT",
      mois: null,
    },
    select: { eleveId: true },
  });
  const existingSet = new Set(existing.map((f) => f.eleveId));

  const anneePrefix = annee.split("-")[0];

  const toCreate: Array<{
    tenantId: string;
    eleveId: string;
    libelle: string;
    montant: number;
    devise: string;
    statut: "EN_ATTENTE";
    type: "RENOUVELLEMENT";
    echeance: Date;
    siteId: string | null;
    createdById: string;
  }> = [];

  for (const eleve of elevesAvecTarif) {
    if (existingSet.has(eleve.id)) continue;
    const niveau = eleve.classe?.niveau ?? "Inconnu";
    const tarif = findTarif(niveau, eleve.siteId ?? null)!;

    toCreate.push({
      tenantId,
      eleveId: eleve.id,
      libelle,
      montant: tarif.fraisRenouvellement,
      devise: tarif.devise,
      statut: "EN_ATTENTE",
      type: "RENOUVELLEMENT",
      echeance,
      siteId: eleve.siteId ?? null,
      createdById: session.user.id,
    });
  }

  // 4. Numérotation atomique, réservée en un seul bloc
  if (toCreate.length > 0) {
    const numeros = await reserverNumerosFacture(tenantId, anneePrefix, toCreate.length);
    await prisma.facture.createMany({ data: toCreate.map((f, i) => ({ ...f, numero: numeros[i] })) });
  }

  await audit({
    tenantId,
    userId: session.user.id,
    action: "reinscription.frais_renouvellement",
    verdict: "ALLOWED",
    resource: "factures",
    reason: `Génération frais de renouvellement ${annee}: ${toCreate.length} factures`,
    metadata: { annee, generated: toCreate.length, skipped: eleves.length - toCreate.length },
  });

  // Notifier la direction de la génération des frais
  await notifyDirection({
    tenantId,
    titre: `Frais de renouvellement générés — ${annee}`,
    contenu: `Les frais de renouvellement pour l'année ${annee} ont été générés par ${session.user.name ?? "un utilisateur"}.\n\nRésumé :\n• ${toCreate.length} facture(s) créée(s)\n• ${eleves.length - toCreate.length} élève(s) sans tarif configuré (ignorés)\n\nLes factures sont visibles dans le module Facturation.`,
    envoyeParId: session.user.id,
  });

  revalidatePath("/facturation");
  revalidateTag("dashboard-data", "max");

  return { generated: toCreate.length, skipped: eleves.length - toCreate.length };
}

// ────────────────────────────────────────────────────────────
// Étape 4 : Générer les mensualités du premier mois
// ────────────────────────────────────────────────────────────

export async function genererPremieresMensualites(params: {
  annee: string;
  mois: number;
  inclureCantine?: boolean;
  inclureTransport?: boolean;
}) {
  // Délègue à la fonction optimisée de facturation-avancee.ts
  const { genererMensualites } = await import("./facturation-avancee");
  const result = await genererMensualites(params);

  const session = await auth();
  if (session?.user?.tenantId) {
    await audit({
      tenantId: session.user.tenantId,
      userId: session.user.id,
      action: "reinscription.mensualites",
      verdict: "ALLOWED",
      resource: "factures",
      reason: `Génération mensualités ${params.mois}/${params.annee} via réinscription`,
      metadata: params,
    });
  }

  return result;
}

// ────────────────────────────────────────────────────────────
// Workflow complet : exécuter toutes les étapes enchaînées
// ────────────────────────────────────────────────────────────

export interface ResultatReinscriptionComplete {
  anneeActive: boolean;
  promotion: { promus: number; diplomes: number; sansChangement: number } | null;
  fraisRenouvellement: { generated: number; skipped: number } | null;
  mensualites: { generated: number; skipped: number } | null;
  erreurs: string[];
}

export async function procederReinscriptionComplete(params: {
  anneeId: string;
  promouvoir: boolean;
  genererFrais: boolean;
  genererMensualites: boolean;
  moisMensualites?: number;
  inclureCantine?: boolean;
  inclureTransport?: boolean;
}): Promise<ResultatReinscriptionComplete> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");

  const tenantId = session.user.tenantId;
  const erreurs: string[] = [];
  let anneeActive = false;
  let promotion: ResultatReinscriptionComplete["promotion"] = null;
  let fraisRenouvellement: ResultatReinscriptionComplete["fraisRenouvellement"] = null;
  let mensualites: ResultatReinscriptionComplete["mensualites"] = null;

  // Étape 1 : Activer l'année
  try {
    await setAnneeCourante(tenantId, params.anneeId);
    anneeActive = true;
  } catch (e) {
    erreurs.push(`Activation année: ${e instanceof Error ? e.message : "erreur"}`);
  }

  const anneeLibelle = await getAnneeCouranteLibelle(tenantId);

  // Étape 2 : Promouvoir
  if (params.promouvoir && anneeLibelle) {
    try {
      const result = await promouvoirEleves();
      promotion = { promus: result.promus, diplomes: result.diplomes, sansChangement: result.sansChangement };
    } catch (e) {
      erreurs.push(`Promotion: ${e instanceof Error ? e.message : "erreur"}`);
    }
  }

  // Étape 3 : Frais de renouvellement
  if (params.genererFrais && anneeLibelle) {
    try {
      fraisRenouvellement = await genererFraisRenouvellement(anneeLibelle);
    } catch (e) {
      erreurs.push(`Frais renouvellement: ${e instanceof Error ? e.message : "erreur"}`);
    }
  }

  // Étape 4 : Mensualités
  if (params.genererMensualites && anneeLibelle) {
    try {
      mensualites = await genererPremieresMensualites({
        annee: anneeLibelle,
        mois: params.moisMensualites ?? new Date().getMonth() + 1,
        inclureCantine: params.inclureCantine,
        inclureTransport: params.inclureTransport,
      });
    } catch (e) {
      erreurs.push(`Mensualités: ${e instanceof Error ? e.message : "erreur"}`);
    }
  }

  await audit({
    tenantId,
    userId: session.user.id,
    action: "reinscription.complete",
    verdict: "ALLOWED",
    resource: "reinscription",
    resourceId: params.anneeId,
    reason: `Procédure de réinscription complète (${erreurs.length} erreurs)`,
    metadata: { anneeActive, promotion, fraisRenouvellement, mensualites, erreurs },
  });

  // Notifier la direction du résultat de la procédure complète
  const resumeParts: string[] = [];
  if (anneeActive) resumeParts.push("Année scolaire activée");
  if (promotion) resumeParts.push(`${promotion.promus} promus, ${promotion.diplomes} diplômés`);
  if (fraisRenouvellement) resumeParts.push(`${fraisRenouvellement.generated} factures de renouvellement`);
  if (mensualites) resumeParts.push(`${mensualites.generated} mensualités générées`);
  if (erreurs.length > 0) resumeParts.push(`${erreurs.length} erreur(s)`);

  await notifyDirection({
    tenantId,
    titre: "Procédure de réinscription terminée",
    contenu: `La procédure de réinscription a été exécutée par ${session.user.name ?? "un utilisateur"}.\n\nRésumé :\n• ${resumeParts.join("\n• ")}${erreurs.length > 0 ? `\n\nErreurs :\n${erreurs.map((e) => `• ${e}`).join("\n")}` : ""}`,
    envoyeParId: session.user.id,
  });

  await invalidateAnneeCourante(tenantId);
  revalidatePath("/reinscription");
  revalidatePath("/eleves");
  revalidatePath("/facturation");
  revalidatePath("/parametres");
  revalidateTag("dashboard-data", "max");
  revalidateTag("eleves-stats", "max");

  return { anneeActive, promotion, fraisRenouvellement, mensualites, erreurs };
}

// ────────────────────────────────────────────────────────────
// Utilitaires
// ────────────────────────────────────────────────────────────

/**
 * Incrémente une année scolaire "2025-2026" → "2026-2027"
 */
function incrementerAnnee(libelle: string): string {
  const parts = libelle.split("-");
  if (parts.length !== 2) return libelle;
  const debut = parseInt(parts[0], 10);
  if (isNaN(debut)) return libelle;
  return `${debut + 1}-${debut + 2}`;
}
