import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkPermission } from "@/lib/rbac";
import { NIVEAUX_CARNET, estNiveauCarnet } from "@/lib/carnet-primaire/referentiel";
import { definitionEffective, domainesStockes, validerDomaines } from "@/lib/carnet-primaire/configuration";
import { ecrireModele, initialiserCarnets } from "@/lib/carnet-primaire/initialiser";
import { modeleNiveau } from "@/lib/carnet-primaire/modeles";
import { siteFilterForModel } from "@/lib/site-scope";

/** Les cinq niveaux avec leur définition effective et le modèle par défaut. */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "parametres:read");
    if (denied) return denied;

    await initialiserCarnets(session.user.tenantId);
    const configurations = await prisma.carnetConfiguration.findMany({
      where: { tenantId: session.user.tenantId },
      select: { niveau: true, domaines: true },
    });
    const parNiveau = new Map(configurations.map((c) => [c.niveau, c.domaines]));
    const competences = await prisma.competence.findMany({
      where: { tenantId: session.user.tenantId },
      select: { niveau: true, domaine: true, ordre: true, libelle: true },
    });

    const niveaux = NIVEAUX_CARNET.map((niveau) => {
      const personnalisee = parNiveau.get(niveau);
      const definition = definitionEffective(niveau, personnalisee, competences.filter((c) => c.niveau === niveau));
      return {
        niveau,
        format: definition.format,
        domaines: definition.domaines,
        // Différent du modèle de l'école (amorçage) ?
        personnalise: JSON.stringify(definition.domaines) !== JSON.stringify(modeleNiveau(niveau)),
      };
    });

    // Matières proposables pour relier un domaine à ses notes (le carnet les filtre par niveau).
    const matieres = await prisma.matiere.findMany({
      where: { tenantId: session.user.tenantId, ...siteFilterForModel("matiere", session.user) },
      select: { id: true, nom: true, niveau: true },
      orderBy: { nom: "asc" },
    });
    return NextResponse.json({ niveaux, matieres });
  } catch (err) {
    console.error("[carnets-primaires/configuration GET]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "parametres:write");
    if (denied) return denied;

    const corps = (await req.json()) as { niveau?: string; domaines?: unknown };
    if (!corps.niveau || !estNiveauCarnet(corps.niveau)) {
      return NextResponse.json({ error: "Niveau invalide (1ère à 5ème)" }, { status: 400 });
    }
    const validation = validerDomaines(corps.niveau, corps.domaines);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.erreur }, { status: 400 });
    }

    const tenantId = session.user.tenantId;
    const niveau = corps.niveau;
    // La table `competences` fait foi pour les lignes : on la resynchronise avec la configuration.
    await prisma.$transaction([
      prisma.carnetConfiguration.upsert({
        where: { tenantId_niveau: { tenantId, niveau } },
        create: { tenantId, niveau, domaines: JSON.parse(JSON.stringify(domainesStockes(validation.domaines))) },
        update: { domaines: JSON.parse(JSON.stringify(domainesStockes(validation.domaines))) },
      }),
      prisma.competence.deleteMany({ where: { tenantId, niveau } }),
      prisma.competence.createMany({
        data: validation.domaines.flatMap((d) =>
          d.lignes.map((libelle, ordre) => ({ tenantId, niveau, domaine: d.code, ordre, libelle }))
        ),
      }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[carnets-primaires/configuration PUT]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

/** Réinitialise un niveau : réécrit en base le modèle de l'école. */
export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "parametres:write");
    if (denied) return denied;

    const niveau = new URL(req.url).searchParams.get("niveau") ?? "";
    if (!estNiveauCarnet(niveau)) {
      return NextResponse.json({ error: "Niveau invalide (1ère à 5ème)" }, { status: 400 });
    }
    await ecrireModele(session.user.tenantId, niveau);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[carnets-primaires/configuration DELETE]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
