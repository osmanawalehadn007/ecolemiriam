/**
 * EcolPro / LEARNOS — Proxy OCR
 * ==============================
 * Reçoit une image (multipart), l'authentifie, et la transmet au
 * microservice OCR (FastAPI + Tesseract) via `OCR_SERVICE_URL` avec le
 * secret partagé `OCR_SERVICE_SECRET`. Le service OCR n'est jamais
 * exposé publiquement.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/rbac";
import { rateLimit } from "@/lib/security/rate-limit";
import { emitLearnosEvent } from "@/lib/learnos/events";

const MAX_FILE_BYTES = 15 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const gate = await authorize();
  if (!gate.ok) return gate.response;

  const limited = await rateLimit(req, {
    keyPrefix: "learnos-ocr",
    limit: 10,
    windowSeconds: 60,
  });
  if (limited) return limited;

  const serviceUrl = process.env.OCR_SERVICE_URL;
  const serviceSecret = process.env.OCR_SERVICE_SECRET;
  if (!serviceUrl || !serviceSecret) {
    return NextResponse.json(
      { error: "Service OCR non configuré (OCR_SERVICE_URL / OCR_SERVICE_SECRET)" },
      { status: 503 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Multipart/form-data attendu" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Champ `file` requis" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "Fichier trop volumineux (max 15 Mo)" }, { status: 413 });
  }

  const upstream = new FormData();
  upstream.set("file", file, file.name);

  let res: Response;
  try {
    res = await fetch(`${serviceUrl.replace(/\/$/, "")}/ocr`, {
      method: "POST",
      headers: { "x-ocr-secret": serviceSecret },
      body: upstream,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return NextResponse.json({ error: "Service OCR indisponible" }, { status: 503 });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return NextResponse.json(
      { error: "Échec OCR", detail: detail.slice(0, 500) },
      { status: res.status === 401 ? 502 : res.status }
    );
  }

  const result = (await res.json()) as {
    text: string;
    lines: string[];
    lineCount: number;
    lang: string;
    filename?: string;
  };

  // Trace l'événement sur le bus (alimente les moteurs LEARNOS).
  try {
    await emitLearnosEvent({
      tenantId: gate.tenantId,
      siteId: null,
      aggregateType: "ocr",
      aggregateId: crypto.randomUUID(),
      eventType: "ocr.completed",
      payload: {
        userId: gate.userId,
        filename: result.filename ?? file.name,
        lineCount: result.lineCount,
      },
    });
  } catch (error) {
    console.error("[LEARNOS/OCR] event emit failed", error);
  }

  return NextResponse.json(result);
}
