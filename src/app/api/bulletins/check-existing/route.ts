import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import { siteFilterForModel } from "@/lib/site-scope";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "bulletins:read");
    if (denied) return denied;

    const { searchParams } = new URL(req.url);
    const classeId = searchParams.get("classeId");
    const periodeId = searchParams.get("periodeId");

    if (!classeId || !periodeId) {
      return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });
    }

    const siteFilter = siteFilterForModel("bulletin", session.user);

    const count = await prisma.bulletin.count({
      where: {
        eleve: { classeId },
        periodeId,
        tenantId: session.user.tenantId,
        ...siteFilter,
      },
    });

    if (count === 0) {
      return NextResponse.json({ exists: false, published: false });
    }

    const publishedCount = await prisma.bulletin.count({
      where: {
        eleve: { classeId },
        periodeId,
        tenantId: session.user.tenantId,
        isPublie: true,
        ...siteFilter,
      },
    });

    return NextResponse.json({
      exists: true,
      published: publishedCount > 0,
      count,
    });
  } catch (error) {
    console.error("[API/bulletins/check-existing]", error);
    return NextResponse.json({ exists: false, published: false });
  }
}
