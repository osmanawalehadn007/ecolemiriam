"""
EcolPro / LEARNOS — Microservice OCR
====================================
FastAPI + pytesseract. Reçoit une image (multipart), retourne le texte
extrait et des lignes structurées. Accès restreint par secret partagé
(header `x-ocr-secret`), jamais exposé publiquement.
"""

import io
import os
import secrets

import pytesseract
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from PIL import Image

OCR_SECRET = os.environ.get("OCR_SERVICE_SECRET", "")
DEFAULT_LANG = os.environ.get("OCR_LANG", "fra")

app = FastAPI(title="LEARNOS OCR Service", docs_url=None, redoc_url=None)


def check_secret(x_ocr_secret: str | None) -> None:
    if not OCR_SECRET:
        raise HTTPException(status_code=500, detail="OCR_SERVICE_SECRET non configuré")
    if not x_ocr_secret or not secrets.compare_digest(x_ocr_secret, OCR_SECRET):
        raise HTTPException(status_code=401, detail="Non autorisé")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/ocr")
async def ocr(
    file: UploadFile = File(...),
    lang: str = DEFAULT_LANG,
    x_ocr_secret: str | None = Header(default=None),
) -> dict:
    check_secret(x_ocr_secret)

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Fichier vide")
    if len(content) > 15 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Fichier trop volumineux (max 15 Mo)")

    try:
        image = Image.open(io.BytesIO(content))
    except Exception:
        raise HTTPException(status_code=400, detail="Image invalide") from None

    try:
        text = pytesseract.image_to_string(image, lang=lang)
    except pytesseract.TesseractError as exc:
        raise HTTPException(status_code=500, detail=f"Erreur OCR : {exc}") from None

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return {
        "text": text.strip(),
        "lines": lines,
        "lineCount": len(lines),
        "lang": lang,
        "filename": file.filename,
    }
