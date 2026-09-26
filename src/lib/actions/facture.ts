"use server";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { revalidatePath, revalidateTag } from "next/cache";
import { PAYMENT_METHOD_IDS } from "@/lib/payment-methods";
import { siteFilterForModel, personalScopeFilter } from "@/lib/site-scope";
import { getTarifPourEleve } from "@/lib/actions/facturation-avancee";
import { estViolationUnicite } from "@/lib/factures/mensualites";
import { z } from "zod";

const FactureSchema = z
  .object({
    eleveId: z.string().min(1, "L'élève est requis"),
    libelle: z.string().min(1, "Le libellé est requis"),
    montant: z.number().min(0, "Le montant doit être positif"),
    devise: z.string().default("DJF"),
    echeance: z.string().optional(),
    // Absent = montant saisi librement. Sinon, `createFacture` relit le montant
    // dans la grille tarifaire du niveau de la classe de l'élève : le montant
    // transmis par le formulaire n'est qu'un aperçu, jamais une source de vérité.
    typeFrais: z.enum(["MENSUALITE", "INSCRIPTION", "RENOUVELLEMENT"]).optional(),
  })
  .refine((v) => v.typeFrais !== undefined || v.montant >= 0.01, {
    message: "Le montant doit être positif",
    path: ["montant"],
  });

export type FactureFormData = z.infer<typeof FactureSchema>;

const PaiementSchema = z.object({
  montant: z.number().min(0.01, "Le montant doit être positif"),
  methode: z.enum(PAYMENT_METHOD_IDS as [string, ...string[]], {
    message: "Le moyen de paiement est invalide",
  }),
  reference: z.string().optional(),
});

export type PaiementFormData = z.infer<typeof PaiementSchema>;

export async function getFacturesForTenant(filters?: { statut?: string; eleveId?: string }) {
  const session = await auth();
  if (!session?.user?.tenantId) return [];

  return prisma.facture.findMany({
    // `Facture` porte une colonne `siteId` : sans ce filtre, la facturation
    // d'un autre site du même établissement restait consultable.
    // `personalScopeFilter` borne en plus PARENT/STUDENT à leurs propres
    // enfants (neutre pour le personnel) : défense en profondeur si cette
    // action est un jour appelée hors de l'écran gardé `/facturation`.
    where: {
      tenantId: session.user.tenantId,
      ...siteFilterForModel("facture", session.user),
      ...personalScopeFilter(session.user),
      ...(filters?.statut && filters.statut !== "ALL" ? { statut: filters.statut as never } : {}),
      ...(filters?.eleveId ? { eleveId: filters.eleveId } : {}),
    },
    include: {
      eleve: { select: { id: true, nom: true, prenom: true, matricule: true, classeId: true, classe: { select: { nom: true } } } },
      // Enfants de la facture déjà bornée par le `where` ci-dessus ; `Paiement`
      // n'a de site que par sa facture.
      // eslint-disable-next-line ecolpro/require-site-filter
      paiements: { include: { enregistrePar: { select: { id: true, name: true } } } },
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getFactureForDetail(id: string) {
  const session = await auth();
  if (!session?.user?.tenantId) return null;

  const facture = await prisma.facture.findFirst({
    where: {
      id,
      tenantId: session.user.tenantId,
      ...siteFilterForModel("facture", session.user),
      // PARENT/STUDENT : uniquement la facture de leurs propres enfants.
      ...personalScopeFilter(session.user),
    },
    include: {
      eleve: {
        select: {
          id: true,
          nom: true,
          prenom: true,
          matricule: true,
          classe: { select: { nom: true, niveau: true } },
          parents: { include: { parent: true }, where: { isGardien: true }, take: 1 },
        },
      },
      // eslint-disable-next-line ecolpro/require-site-filter
      paiements: { orderBy: { date: "desc" }, include: { enregistrePar: { select: { id: true, name: true } } } },
      createdBy: { select: { id: true, name: true } },
    },
  });

  return facture;
}

export async function createFacture(data: FactureFormData) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");

  const tenantId = session.user.tenantId;
  const parsed = FactureSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const values = parsed.data;
  // La numérotation `FAC-<année>-<n>` doit rester unique à l'échelle de
  // l'établissement : le compteur est donc volontairement tenant-wide. Seul un
  // NOMBRE est lu, aucune donnée d'un autre site n'est exposée.
  // eslint-disable-next-line ecolpro/require-site-filter
  const count = await prisma.facture.count({ where: { tenantId } });
  const numero = `FAC-${new Date().getFullYear()}-${String(count + 1).padStart(5, "0")}`;

  // `eleveId` vient du formulaire : l'élève doit appartenir au MÊME tenant et au
  // périmètre de sites. Sans ce contrôle, on pouvait créer une facture pour un
  // élève d'un autre établissement (la clé étrangère `Eleve` est globale).
  const eleve = await prisma.eleve.findFirst({
    where: { id: values.eleveId, tenantId, ...siteFilterForModel("eleve", session.user) },
    select: { siteId: true },
  });
  if (!eleve) throw new Error("Élève introuvable ou hors de votre périmètre");
  const factureSiteId = eleve.siteId ?? null;

  // Montant : adossé à la grille tarifaire (`typeFrais`) ou saisi librement.
  // Dans le premier cas il est relu ICI, côté serveur, depuis le niveau de la
  // classe de l'élève (tarif du site, sinon tarif global) : le montant envoyé
  // par le formulaire n'est qu'un aperçu affiché à l'utilisateur.
  let montant = values.montant;
  let devise = values.devise || "DJF";

  if (values.typeFrais) {
    const tarif = await getTarifPourEleve(values.eleveId, values.typeFrais);
    if (!tarif) {
      throw new Error(
        "Aucun tarif défini pour le niveau de la classe de cet élève. Complétez la grille dans Paramètres → Tarifs, ou choisissez un montant libre."
      );
    }
    if (tarif.montant <= 0) {
      throw new Error("Le tarif de ce niveau est à zéro : complétez-le dans Paramètres → Tarifs.");
    }
    montant = tarif.montant;
    devise = tarif.devise;
  }

  // Type de facture et mois de rattachement. Pour une mensualité, le mois est
  // déduit de l'échéance (« 2026-10-31 » → « 2026-10 ») : le verrou d'unicité
  // mensuel s'applique donc aussi à la saisie manuelle.
  const typeFacture = values.typeFrais ?? "LIBRE";
  const moisFacture =
    values.typeFrais === "MENSUALITE" && values.echeance ? values.echeance.slice(0, 7) : null;

  let factureId: string;
  try {
    const facture = await prisma.facture.create({
      data: {
        tenantId,
        siteId: factureSiteId,
        eleveId: values.eleveId,
        numero,
        libelle: values.libelle,
        montant,
        devise,
        statut: "EN_ATTENTE",
        type: typeFacture,
        mois: moisFacture,
        echeance: values.echeance ? new Date(values.echeance) : null,
        createdById: session.user.id,
      },
    });
    factureId = facture.id;
  } catch (e) {
    // Index unique partiel `factures_unicite_mensuelle` : une seule facture de
    // scolarité par élève et par mois. Une facture déjà payée bloque elle aussi
    // la création d'une seconde facture pour le même mois.
    if (estViolationUnicite(e)) {
      throw new Error(
        moisFacture
          ? `Une facture de scolarité existe déjà pour cet élève sur ${moisFacture}. Modifiez ou annulez-la plutôt que d'en créer une seconde.`
          : "Une facture identique existe déjà pour cet élève."
      );
    }
    throw e;
  }

  revalidatePath("/facturation");
  revalidateTag("dashboard-data");
  return { success: true, id: factureId };
}

export async function getFactureByNumero(numero: string) {
  const session = await auth();
  if (!session?.user?.tenantId) return null;

  if (!numero || numero.trim().length === 0) return null;

  return prisma.facture.findFirst({
    where: {
      numero: numero.trim(),
      tenantId: session.user.tenantId,
      ...siteFilterForModel("facture", session.user),
    },
    select: {
      id: true,
      numero: true,
      libelle: true,
      montant: true,
      devise: true,
      statut: true,
      echeance: true,
      eleve: {
        select: {
          id: true,
          nom: true,
          prenom: true,
          matricule: true,
          classe: { select: { nom: true } },
        },
      },
    },
  });
}

export async function enregistrerPaiement(factureId: string, data: PaiementFormData) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");

  if (!factureId || factureId.trim().length === 0) {
    throw new Error("Numéro de facture requis : aucun paiement ne peut être enregistré sans facture");
  }

  const parsed = PaiementSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const values = parsed.data;
  // Écriture : `factureId` vient de l'appelant — la facture doit appartenir au
  // site de l'utilisateur, sinon on pouvait encaisser sur la facture d'un autre
  // site du même établissement.
  const facture = await prisma.facture.findFirst({
    where: {
      id: factureId,
      tenantId: session.user.tenantId,
      ...siteFilterForModel("facture", session.user),
    },
    include: { paiements: true },
  });
  if (!facture) throw new Error("Facture non trouvée");

  if (facture.statut === "ANNULEE") {
    throw new Error("Impossible d'encaisser sur une facture annulée");
  }

  const totalDejaPaye = facture.paiements.reduce((sum, p) => sum + p.montant, 0);
  const restant = facture.montant - totalDejaPaye;

  if (restant <= 0) {
    throw new Error("Cette facture est déjà soldée");
  }

  if (values.montant > restant) {
    throw new Error(`Le montant ne peut pas dépasser le solde restant (${restant} ${facture.devise})`);
  }

  const paiement = await prisma.paiement.create({
    data: {
      factureId,
      montant: values.montant,
      devise: facture.devise,
      methode: values.methode,
      reference: values.reference || null,
      enregistreParId: session.user.id,
    },
  });

  const totalPaye = totalDejaPaye + values.montant;
  let newStatut: typeof facture.statut = facture.statut;

  if (totalPaye >= facture.montant) {
    newStatut = "PAYEE";
  } else if (facture.echeance && new Date() > facture.echeance && totalPaye < facture.montant) {
    newStatut = "EN_RETARD";
  }

  await prisma.facture.update({
    where: { id: factureId },
    data: { statut: newStatut },
  });

  revalidatePath("/facturation");
  revalidatePath(`/facturation/${factureId}`);
  revalidateTag("dashboard-data");
  return { success: true, id: paiement.id };
}

export async function annulerFacture(factureId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");

  const facture = await prisma.facture.findFirst({
    where: {
      id: factureId,
      tenantId: session.user.tenantId,
      ...siteFilterForModel("facture", session.user),
    },
  });
  if (!facture) throw new Error("Facture non trouvée");

  if (facture.statut === "PAYEE") {
    throw new Error("Impossible d'annuler une facture déjà payée");
  }

  // eslint-disable-next-line ecolpro/require-site-filter -- comptage par factureId déjà vérifié tenant et via la relation facture
  const nbPaiements = await prisma.paiement.count({
    where: { factureId },
  });
  if (nbPaiements > 0) {
    throw new Error("Impossible d'annuler une facture ayant déjà des paiements");
  }

  await prisma.facture.update({
    where: { id: factureId },
    data: { statut: "ANNULEE" },
  });

  revalidatePath("/facturation");
  revalidatePath(`/facturation/${factureId}`);
  revalidateTag("dashboard-data");
  return { success: true };
}
