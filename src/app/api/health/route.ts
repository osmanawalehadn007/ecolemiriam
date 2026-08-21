import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    // Health check public : on ne divulgue aucune information sur le
    // contenu de la base (nombre d'utilisateurs, etc.). On se contente
    // de vérifier que la connexion DB est vivante.
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false },
      { status: 500 }
    );
  }
}
