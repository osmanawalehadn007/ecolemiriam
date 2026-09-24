import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/rbac";
import { rateLimit, getClientIP } from "@/lib/security/rateLimit";
import { PIECES_JUSTIFICATIVES } from "@/lib/admissions/pieces-justificatives";

/**
 * Upload d'une pièce justificative pour une candidature.
 * Accepte les images (JPG, PNG, WebP) et les PDFs.
 * Retourne une data URL base64 (même stratégie que upload-photo).
 *
 * Accessible aux utilisateurs authentifiés avec admissions:write
 * ET au formulaire public (sans auth) avec rate-limit renforcé.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = getClientIP(req);
    const rl = rateLimit({ max: 10, windowSec: 60, key: `upload-admission:${ip}` });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Trop de requêtes. Réessayez dans un instant." },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }

    // Auth optionnelle : le formulaire public peut uploader sans session
    const session = await auth();
    if (session?.user) {
      const denied = checkPermission(session.user.role, "admissions:write");
      // Si l'utilisateur est connecté mais n'a pas la permission, on refuse
      if (denied) return denied;
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const pieceId = formData.get("pieceId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "Aucun fichier fourni" }, { status: 400 });
    }

    if (!pieceId) {
      return NextResponse.json({ error: "Type de pièce non spécifié" }, { status: 400 });
    }

    // Vérifier que la pièce est dans la liste définie
    const piece = PIECES_JUSTIFICATIVES.find((p) => p.id === pieceId);
    if (!piece) {
      return NextResponse.json({ error: "Type de pièce invalide" }, { status: 400 });
    }

    // Valider le type MIME
    if (!piece.accept.includes(file.type)) {
      return NextResponse.json(
        { error: `Format non supporté pour ${piece.label}. Formats acceptés: ${piece.accept.join(", ")}` },
        { status: 400 }
      );
    }

    // Valider la taille
    if (file.size > piece.maxSize) {
      const maxMB = Math.round(piece.maxSize / (1024 * 1024));
      return NextResponse.json(
        { error: `Le fichier ne doit pas dépasser ${maxMB} Mo` },
        { status: 400 }
      );
    }

    // Convertir en data URL base64
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${file.type};base64,${base64}`;

    return NextResponse.json({
      url: dataUrl,
      nom: piece.id,
      label: piece.label,
      type: file.type,
    });
  } catch (error) {
    console.error("[API/admissions/upload-document]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
