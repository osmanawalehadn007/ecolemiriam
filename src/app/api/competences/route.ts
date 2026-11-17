import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkPermission } from "@/lib/rbac";
import { NIVEAUX_CARNET, estNiveauCarnet } from "@/lib/carnet-primaire/referentiel";
import { MAX_LIGNES, definitionEffective } from "@/lib/carnet-primaire/configuration";
import { initialiserCarnets } from "@/lib/carnet-primaire/initialiser";
import { modeleDomaine } from "@/lib/carnet-primaire/modeles";

/** Domaines d'un niveau avec leurs compétences (table `competences`, sinon modèle par défaut). */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    const denied = checkPermission(session.user.role, "matieres:read");
    if (denied) return denied;

    const tenantId = session.user.tenantId;
    await initialiserCarnets(tenantId);
    const [configurations, competences] = await Promise.all([
      prisma.carnetConfiguration.findMany({ where: { tenantId }, select: { niveau: true, domaines: true } }),
      prisma.competence.findMany({ where: { tenantId }, select: { niveau: true, domaine: true, ordre: true, libelle: true } }),
    ]);
    const parNiveau = new Map(configurations.map((c) => [c.niveau, c.domaines]));
    const niveaux = NIVEAUX_CARNET.map((niveau) => {
      const def = definitionEffective(niveau, parNiveau.get(niveau), competences.filter((c) => c.niveau === niveau));
      return {
        niveau,
        domaines: def.domaines.map((d) => ({
          code: d.code,
          libelle: d.libelle,
          lignes: d.lignes,
          personnalise: JSON.stringify(d.lignes) !== JSON.stringify(modeleDomaine(niveau, d.code)),
        })),
      };
    });
    return NextResponse.json({ niveaux });
  } catch (err) {
    console.error("[competences GET]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

const CorpsSchema = z.object({
  niveau: z.string(),
  domaine: z.string().regex(/^[A-Z0-9_]{1,30}$/),
  lignes: z
    .array(z.string().trim().min(1, "Une compétence ne peut pas être vide").max(400))
    .min(1, "Au moins une compétence")
    .max(MAX_LIGNES),
});

/** Remplace les compétences d'un domaine. Ajouter à la fin ne déplace aucune saisie existante. */
export async function PUT(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    const denied = checkPermission(session.user.role, "matieres:write");
    if (denied) return denied;

    const analyse = CorpsSchema.safeParse(await req.json());
    if (!analyse.success) {
      return NextResponse.json({ error: analyse.error.issues[0]?.message ?? "Données invalides" }, { status: 400 });
    }
    const { niveau, domaine, lignes } = analyse.data;
    if (!estNiveauCarnet(niveau)) return NextResponse.json({ error: "Niveau invalide (1ère à 5ème)" }, { status: 400 });

    const tenantId = session.user.tenantId;
    const configuration = await prisma.carnetConfiguration.findFirst({ where: { tenantId, niveau }, select: { domaines: true } });
    const def = definitionEffective(niveau, configuration?.domaines);
    if (!def.domaines.some((d) => d.code === domaine)) {
      return NextResponse.json({ error: "Domaine inconnu pour ce niveau" }, { status: 400 });
    }

    await prisma.$transaction([
      prisma.competence.deleteMany({ where: { tenantId, niveau, domaine } }),
      prisma.competence.createMany({ data: lignes.map((libelle, ordre) => ({ tenantId, niveau, domaine, ordre, libelle })) }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[competences PUT]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

/** Rétablit en base les compétences du modèle de l'école pour un domaine. */
export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    const denied = checkPermission(session.user.role, "matieres:write");
    if (denied) return denied;

    const params = new URL(req.url).searchParams;
    const niveau = params.get("niveau") ?? "";
    const domaine = params.get("domaine") ?? "";
    const modele = estNiveauCarnet(niveau) ? modeleDomaine(niveau, domaine) : null;
    if (!modele) return NextResponse.json({ error: "Pas de modèle pour ce domaine" }, { status: 400 });
    const tenantId = session.user.tenantId;
    await prisma.$transaction([
      prisma.competence.deleteMany({ where: { tenantId, niveau, domaine } }),
      prisma.competence.createMany({ data: modele.map((libelle, ordre) => ({ tenantId, niveau, domaine, ordre, libelle })) }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[competences DELETE]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
