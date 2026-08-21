import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/rbac";
import { rateLimit, getClientIP } from "@/lib/security/rateLimit";

// ------------------------------------------------------------
// POST /api/cahier-de-texte/upload
// Upload de fichiers .doc, .docx, .pdf, .odt attachés au cahier de texte
// Stockage : base64 data URL (même pattern que upload-photo)
// ------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "cahier-texte:write");
    if (denied) return denied;

    // Rate limit: 10 uploads per minute per user
    const ip = getClientIP(req);
    const rl = rateLimit({ max: 10, windowSec: 60, key: `upload-cahier:${session.user.id}:${ip}` });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Trop de requêtes. Réessayez dans un instant." },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "Aucun fichier" }, { status: 400 });
    }

    // Whitelist MIME types pour documents
    const allowedTypes = [
      "application/msword",                                                     // .doc
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
      "application/pdf",                                                        // .pdf
      "application/vnd.oasis.opendocument.text",                                // .odt
      "text/plain",                                                             // .txt
    ];

    // Vérification par extension aussi (certains navigateurs envoient application/octet-stream)
    const allowedExtensions = [".doc", ".docx", ".pdf", ".odt", ".txt"];
    const fileName = file.name.toLowerCase();
    const hasValidExtension = allowedExtensions.some((ext) => fileName.endsWith(ext));

    if (!allowedTypes.includes(file.type) && !hasValidExtension) {
      return NextResponse.json(
        { error: "Format non supporté. Utilisez .doc, .docx, .pdf, .odt ou .txt." },
        { status: 400 }
      );
    }

    // Taille max : 5 Mo
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "Le fichier ne doit pas dépasser 5 Mo" },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${file.type || "application/octet-stream"};base64,${base64}`;

    return NextResponse.json({
      nom: file.name,
      type: file.type || "application/octet-stream",
      taille: file.size,
      dataUrl,
    });
  } catch (error) {
    console.error("[API/cahier-de-texte/upload]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
