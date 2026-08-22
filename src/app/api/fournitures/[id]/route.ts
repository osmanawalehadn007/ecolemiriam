import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { authorize } from "@/lib/rbac";
import { siteFilterForModel } from "@/lib/site-scope";
import type { FournitureStatut } from "@prisma/client";

// ---------------------------------------------------------------
// Schéma de validation pour mise à jour
// ---------------------------------------------------------------

const FournitureItemSchema = z.object({
  id: z.string().optional(),
  nom: z.string().min(1, "Le nom est requis"),
  type: z.enum(["LIVRE", "CAHIER", "INSTRUMENT", "AUTRE"]),
  quantite: z.number().int().min(1, "La quantité doit être ≥ 1"),
  format: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  marque: z.string().optional().nullable(),
  ordre: z.number().int().optional(),
});

const UpdateListeSchema = z.object({
  niveau: z.string().min(1).optional(),
  annee: z.string().min(1).optional(),
  matiereId: z.string().nullable().optional(),
  commentaireEnseignant: z.string().optional().nullable(),
  commentaireSecretariat: z.string().optional().nullable(),
  items: z.array(FournitureItemSchema).optional(),
});

// ---------------------------------------------------------------
// GET — Détail d'une liste
// ---------------------------------------------------------------
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await authorize({ permission: "fournitures:read" });
  if (!gate.ok) return gate.response;
  const { tenantId, role } = gate;
  const { id } = await params;

  const siteFilter = siteFilterForModel("fournitureListe", gate.session.user);

  const liste = await prisma.fournitureListe.findFirst({
    where: { id, tenantId, ...siteFilter },
    include: {
      matiere: { select: { id: true, nom: true, code: true } },
      enseignant: {
        select: {
          id: true,
          user: { select: { id: true, name: true } },
        },
      },
      valideePar: { select: { id: true, name: true } },
      items: { orderBy: { ordre: "asc" } },
    },
  });

  if (!liste) {
    return NextResponse.json({ error: "Liste introuvable" }, { status: 404 });
  }

  // Les parents/élèves ne peuvent voir que les listes PUBLIEES
  if ((role === "PARENT" || role === "STUDENT") && liste.statut !== "PUBLIEE") {
    return NextResponse.json({ error: "Liste introuvable" }, { status: 404 });
  }

  return NextResponse.json(liste);
}

// ---------------------------------------------------------------
// PUT — Mise à jour d'une liste (items + champs)
// ---------------------------------------------------------------
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await authorize({ permission: "fournitures:write" });
  if (!gate.ok) return gate.response;
  const { tenantId, role } = gate;
  const { id } = await params;

  const siteFilter = siteFilterForModel("fournitureListe", gate.session.user);

  // Vérifier que la liste existe et appartient au tenant
  const existing = await prisma.fournitureListe.findFirst({
    where: { id, tenantId, ...siteFilter },
    select: { id: true, statut: true, enseignantId: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "Liste introuvable" }, { status: 404 });
  }

  // Une liste SOUMISE/VALIDEE/PUBLIEE ne peut plus être modifiée par l'enseignant
  // Le secrétariat peut modifier une liste SOUMISE (compilation)
  const canEdit =
    role === "SUPER_ADMIN" ||
    role === "TENANT_ADMIN" ||
    role === "PRINCIPAL" ||
    role === "SECRETARY" ||
    existing.statut === "BROUILLON" ||
    existing.statut === "REJETEE";

  if (!canEdit) {
    return NextResponse.json(
      { error: "Cette liste ne peut plus être modifiée (statut: " + existing.statut + ")." },
      { status: 403 }
    );
  }

  try {
    const json = await request.json();
    const data = UpdateListeSchema.parse(json);

    // Mise à jour des champs de la liste
    const updateData: Record<string, unknown> = {};
    if (data.niveau !== undefined) updateData.niveau = data.niveau;
    if (data.annee !== undefined) updateData.annee = data.annee;
    if (data.matiereId !== undefined) updateData.matiereId = data.matiereId;
    if (data.commentaireEnseignant !== undefined) updateData.commentaireEnseignant = data.commentaireEnseignant;
    if (data.commentaireSecretariat !== undefined) updateData.commentaireSecretariat = data.commentaireSecretariat;

    // Si des items sont fournis, on remplace tous les items (stratégie simple)
    if (data.items !== undefined) {
      await prisma.fournitureItem.deleteMany({ where: { listeId: id } });
      if (data.items.length > 0) {
        await prisma.fournitureItem.createMany({
          data: data.items.map((item, idx) => ({
            listeId: id,
            nom: item.nom,
            type: item.type,
            quantite: item.quantite,
            format: item.format ?? null,
            description: item.description ?? null,
            marque: item.marque ?? null,
            ordre: item.ordre ?? idx,
          })),
        });
      }
    }

    const updated = await prisma.fournitureListe.update({
      where: { id },
      data: updateData,
      include: {
        matiere: { select: { id: true, nom: true, code: true } },
        items: { orderBy: { ordre: "asc" } },
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    console.error("[Fournitures PUT] Erreur:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

// ---------------------------------------------------------------
// DELETE — Suppression d'une liste (brouillon uniquement)
// ---------------------------------------------------------------
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await authorize({ permission: "fournitures:write" });
  if (!gate.ok) return gate.response;
  const { tenantId, role } = gate;
  const { id } = await params;

  const siteFilter = siteFilterForModel("fournitureListe", gate.session.user);

  const liste = await prisma.fournitureListe.findFirst({
    where: { id, tenantId, ...siteFilter },
    select: { id: true, statut: true },
  });

  if (!liste) {
    return NextResponse.json({ error: "Liste introuvable" }, { status: 404 });
  }

  // Seuls les brouillons/rejetés peuvent être supprimés (ou un admin)
  const canDelete =
    role === "SUPER_ADMIN" ||
    role === "TENANT_ADMIN" ||
    liste.statut === "BROUILLON" ||
    liste.statut === "REJETEE";

  if (!canDelete) {
    return NextResponse.json(
      { error: "Seules les listes en brouillon ou rejetées peuvent être supprimées." },
      { status: 403 }
    );
  }

  await prisma.fournitureListe.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
