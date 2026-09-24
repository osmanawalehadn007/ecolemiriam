import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/security/rateLimit";
import { checkPermission } from "@/lib/rbac";
import { uploadPublicImage } from "@/lib/storage/r2";

// Téléverse un logo, une signature ou un cachet dans le bucket public R2 et
// renvoie son URL. Ces images sont ensuite stockées en base sous forme d'URL
// et non de base64 : voir l'en-tête de @/lib/storage/r2 pour la panne que ce
// choix corrige.
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "parametres:write");
    // Même permission que `PUT /api/parametres/signature-cachet` : la signature
    // et le cachet sont les mentions officielles de l'établissement. Le refus
    // est journalisé (contrairement à l'ancien contrôle de rôle inline).
    const denied = checkPermission(session.user.role, "etablissement:write");
    if (denied) return denied;

    const ip = getClientIP(req);
    const rl = rateLimit({ max: 10, windowSec: 60, key: `upload-sig:${session.user.id}:${ip}` });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Trop de requêtes. Réessayez dans un instant." },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const type = formData.get("type") as string | null;

    if (!file) {
      return NextResponse.json({ error: "Aucun fichier" }, { status: 400 });
    }
    if (type !== "signature" && type !== "cachet" && type !== "logo") {
      return NextResponse.json({ error: "Type invalide" }, { status: 400 });
    }

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: "Format non supporté. Utilisez JPG, PNG, WebP ou GIF." }, { status: 400 });
    }

    const maxSize = 2 * 1024 * 1024; // 2MB
    if (file.size > maxSize) {
      return NextResponse.json({ error: "L'image ne doit pas dépasser 2 Mo" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await uploadPublicImage({
      buffer,
      contentType: file.type,
      path: `tenants/${session.user.tenantId}/${type}`,
    });

    return NextResponse.json({ url });
  } catch (error) {
    console.error("[API/parametres/upload-signature]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
