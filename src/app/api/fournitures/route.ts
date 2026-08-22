import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { authorize } from "@/lib/rbac";
import { siteFilterForModel } from "@/lib/site-scope";
import type { FournitureStatut } from "@prisma/client";

// ---------------------------------------------------------------
// Schéma de validation Zod
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

const FournitureListeSchema = z.object({
  niveau: z.string().min(1, "Le niveau est requis"),
  annee: z.string().min(1, "L'année est requise"),
  matiereId: z.string().nullable().optional(),
  commentaireEnseignant: z.string().optional().nullable(),
  items: z.array(FournitureItemSchema).min(1, "Au moins un item est requis"),
});

// ---------------------------------------------------------------
// GET — Liste des fournitures (filtrée par rôle)
// ---------------------------------------------------------------
export async function GET(request: NextRequest) {
  const gate = await authorize({ permission: "fournitures:read" });
  if (!gate.ok) return gate.response;
  const { tenantId, role } = gate;

  const { searchParams } = new URL(request.url);
  const niveau = searchParams.get("niveau");
  const annee = searchParams.get("annee");
  const matiereId = searchParams.get("matiereId");
  const statut = searchParams.get("statut");
  const enseignantId = searchParams.get("enseignantId");

  // Les parents/élèves ne voient que les listes PUBLIEES
  const statutFilter: FournitureStatut | undefined =
    role === "PARENT" || role === "STUDENT"
      ? "PUBLIEE"
      : (statut as FournitureStatut | null) ?? undefined;

  const siteFilter = siteFilterForModel("fournitureListe", gate.session.user);

  const listes = await prisma.fournitureListe.findMany({
    where: {
      tenantId,
      ...siteFilter,
      ...(niveau ? { niveau } : {}),
      ...(annee ? { annee } : {}),
      ...(matiereId ? { matiereId } : {}),
      ...(statutFilter ? { statut: statutFilter } : {}),
      ...(enseignantId ? { enseignantId } : {}),
    },
    include: {
      matiere: { select: { id: true, nom: true, code: true } },
      enseignant: {
        select: {
          id: true,
          user: { select: { id: true, name: true } },
        },
      },
      items: { orderBy: { ordre: "asc" } },
    },
    orderBy: [{ niveau: "asc" }, { annee: "desc" }, { matiere: { nom: "asc" } }],
  });

  return NextResponse.json({ listes });
}

// ---------------------------------------------------------------
// POST — Création d'une liste (enseignant ou secrétariat)
// ---------------------------------------------------------------
export async function POST(request: NextRequest) {
  const gate = await authorize({ permission: "fournitures:write" });
  if (!gate.ok) return gate.response;
  const { tenantId, userId, role } = gate;

  try {
    const json = await request.json();
    const data = FournitureListeSchema.parse(json);

    // Vérifier l'unicité : une seule liste par niveau/année/matière
    const existing = await prisma.fournitureListe.findFirst({
      where: {
        tenantId,
        niveau: data.niveau,
        annee: data.annee,
        matiereId: data.matiereId ?? null,
      },
      select: { id: true },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Une liste existe déjà pour ce niveau, cette année et cette matière." },
        { status: 409 }
      );
    }

    // Récupérer l'enseignant lié à l'utilisateur courant (si applicable)
    let enseignantId: string | null = null;
    if (role === "TEACHER" || role === "CLASS_TEACHER") {
      const enseignantSiteFilter = siteFilterForModel("enseignant", gate.session.user);
      const enseignant = await prisma.enseignant.findFirst({
        where: { userId, tenantId, ...enseignantSiteFilter },
        select: { id: true },
      });
      enseignantId = enseignant?.id ?? null;
    }

    const siteId = (gate.session.user as { siteId?: string | null }).siteId ?? null;

    const liste = await prisma.fournitureListe.create({
      data: {
        tenantId,
        siteId: siteId || null,
        niveau: data.niveau,
        annee: data.annee,
        matiereId: data.matiereId ?? null,
        enseignantId,
        commentaireEnseignant: data.commentaireEnseignant ?? null,
        statut: "BROUILLON",
        items: {
          create: data.items.map((item, idx) => ({
            nom: item.nom,
            type: item.type,
            quantite: item.quantite,
            format: item.format ?? null,
            description: item.description ?? null,
            marque: item.marque ?? null,
            ordre: item.ordre ?? idx,
          })),
        },
      },
      include: {
        matiere: { select: { id: true, nom: true, code: true } },
        items: { orderBy: { ordre: "asc" } },
      },
    });

    return NextResponse.json(liste, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    console.error("[Fournitures POST] Erreur:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
