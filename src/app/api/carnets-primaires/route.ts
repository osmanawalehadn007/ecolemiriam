import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForModel, type SessionSiteClaims } from "@/lib/site-scope";
import { estNiveauCarnet } from "@/lib/carnet-primaire/referentiel";
import { chargerDefinition } from "@/lib/carnet-primaire/charger-definition";
import { erreursDomaines, type SaisieCarnet } from "@/lib/carnet-primaire/notation";
import { genererCarnetHtml } from "@/lib/carnet-primaire/html";

const ANNEE_RE = /^\d{4}-\d{4}$/;

const SaisieModuleSchema = z.object({
  competences: z.record(z.string(), z.enum(["A", "EVA", "NA"])).optional(),
  domaines: z.record(z.string(), z.number().min(0)).optional(),
  note: z.number().min(0).max(10).nullable().optional(),
});

const SaveSchema = z.object({
  eleveId: z.string().min(1),
  annee: z.string().regex(ANNEE_RE, "Année scolaire attendue au format 2026-2027"),
  saisie: z.record(z.string().regex(/^[1-4]$/), SaisieModuleSchema),
  appreciations: z.string().max(2000).nullable().optional(),
  decision: z.string().max(200).nullable().optional(),
});

/** Refuse l'accès aux comptes parent et élève : le carnet est un outil de l'équipe pédagogique. */
function accesRefuse(role: string | undefined): NextResponse | null {
  if (role === "PARENT" || role === "STUDENT") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }
  return null;
}

/** Charge l'élève dans le tenant de la session et son niveau de carnet. */
async function chargerEleve(eleveId: string, user: SessionSiteClaims & { tenantId?: string | null }) {
  const siteFilter = siteFilterForModel("eleve", user);
  const eleve = await prisma.eleve.findFirst({
    where: { id: eleveId, tenantId: user.tenantId!, ...siteFilter },
    select: {
      id: true,
      nom: true,
      prenom: true,
      matricule: true,
      classe: { select: { niveau: true } },
    },
  });
  if (!eleve) return { erreur: NextResponse.json({ error: "Élève introuvable" }, { status: 404 }) };

  const niveau = eleve.classe?.niveau ?? "";
  if (!estNiveauCarnet(niveau)) {
    return {
      erreur: NextResponse.json(
        { error: "Cet élève n'est pas dans un niveau de l'enseignement fondamental (1ère à 5ème)" },
        { status: 422 }
      ),
    };
  }
  return { eleve: { ...eleve, niveau } };
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "bulletins:read") ?? accesRefuse(session.user.role);
    if (denied) return denied;

    const { searchParams } = new URL(req.url);
    const eleveId = searchParams.get("eleveId");
    const annee = searchParams.get("annee");
    if (!eleveId || !annee || !ANNEE_RE.test(annee)) {
      return NextResponse.json({ error: "eleveId et annee (2026-2027) sont requis" }, { status: 400 });
    }

    const charge = await chargerEleve(eleveId, session.user);
    if ("erreur" in charge) return charge.erreur;

    const definition = await chargerDefinition(session.user.tenantId, charge.eleve.niveau);
    const carnet = await prisma.carnetPrimaire.findFirst({
      where: { eleveId, annee, tenantId: session.user.tenantId },
      select: { saisie: true, appreciations: true, decision: true, updatedAt: true },
    });

    if (searchParams.get("format") === "html") {
      const tenant = await prisma.tenant.findUnique({
        where: { id: session.user.tenantId },
        select: { name: true },
      });
      const html = genererCarnetHtml({
        ecole: tenant?.name ?? "",
        annee,
        niveau: charge.eleve.niveau,
        definition,
        eleve: { nom: charge.eleve.nom, prenom: charge.eleve.prenom, matricule: charge.eleve.matricule ?? "" },
        saisie: (carnet?.saisie ?? {}) as SaisieCarnet,
        appreciations: carnet?.appreciations,
        decision: carnet?.decision,
      });
      return NextResponse.json({ html });
    }

    return NextResponse.json({
      eleve: charge.eleve,
      niveau: charge.eleve.niveau,
      definition,
      saisie: (carnet?.saisie ?? {}) as SaisieCarnet,
      appreciations: carnet?.appreciations ?? "",
      decision: carnet?.decision ?? "",
      updatedAt: carnet?.updatedAt ?? null,
    });
  } catch (err) {
    console.error("[carnets-primaires GET]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "bulletins:write") ?? accesRefuse(session.user.role);
    if (denied) return denied;

    const corps = SaveSchema.safeParse(await req.json());
    if (!corps.success) {
      return NextResponse.json({ error: corps.error.issues[0]?.message ?? "Données invalides" }, { status: 400 });
    }
    const { eleveId, annee, saisie, appreciations, decision } = corps.data;

    const charge = await chargerEleve(eleveId, session.user);
    if ("erreur" in charge) return charge.erreur;
    const niveau = charge.eleve.niveau;

    // Vérifie les barèmes de chaque module (format points) avant d'enregistrer.
    const definition = await chargerDefinition(session.user.tenantId, niveau);
    for (const [module, contenu] of Object.entries(saisie)) {
      if (!contenu.domaines) continue;
      const erreurs = erreursDomaines(definition, contenu.domaines);
      if (erreurs.length > 0) {
        return NextResponse.json({ error: `Module ${module} : ${erreurs.join(" ")}` }, { status: 400 });
      }
    }

    const tenantId = session.user.tenantId;
    await prisma.carnetPrimaire.upsert({
      where: { eleveId_annee: { eleveId, annee } },
      create: {
        tenantId,
        eleveId,
        annee,
        niveau,
        saisie,
        appreciations: appreciations ?? null,
        decision: decision ?? null,
      },
      update: {
        niveau,
        saisie,
        appreciations: appreciations ?? null,
        decision: decision ?? null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[carnets-primaires PUT]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
