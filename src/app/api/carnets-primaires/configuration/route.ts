import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkPermission } from "@/lib/rbac";
import { CARNETS, NIVEAUX_CARNET, estNiveauCarnet } from "@/lib/carnet-primaire/referentiel";
import { definitionEffective, validerDomaines } from "@/lib/carnet-primaire/configuration";

/** Les cinq niveaux avec leur définition effective et le modèle par défaut. */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "parametres:read");
    if (denied) return denied;

    const configurations = await prisma.carnetConfiguration.findMany({
      where: { tenantId: session.user.tenantId },
      select: { niveau: true, domaines: true },
    });
    const parNiveau = new Map(configurations.map((c) => [c.niveau, c.domaines]));

    const niveaux = NIVEAUX_CARNET.map((niveau) => {
      const personnalisee = parNiveau.get(niveau);
      const definition = definitionEffective(niveau, personnalisee);
      return {
        niveau,
        format: definition.format,
        domaines: definition.domaines,
        defaut: CARNETS[niveau].domaines,
        // Une personnalisation invalide est ignorée : le modèle par défaut s'applique.
        personnalise: personnalisee != null && validerDomaines(niveau, personnalisee).ok,
      };
    });
    return NextResponse.json({ niveaux });
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
    await prisma.carnetConfiguration.upsert({
      where: { tenantId_niveau: { tenantId, niveau: corps.niveau } },
      create: { tenantId, niveau: corps.niveau, domaines: validation.domaines },
      update: { domaines: validation.domaines },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[carnets-primaires/configuration PUT]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

/** Réinitialise un niveau : supprime la personnalisation et rétablit le modèle par défaut. */
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
    await prisma.carnetConfiguration.deleteMany({
      where: { tenantId: session.user.tenantId, niveau },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[carnets-primaires/configuration DELETE]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
