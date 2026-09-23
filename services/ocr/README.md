# LEARNOS — Microservice OCR

FastAPI + pytesseract. Extrait le texte de copies/évaluations scannées pour
alimenter `LearnosEvidence` (source `OCR`).

## Lancement

```bash
cd services/ocr
OCR_SERVICE_SECRET=un-secret-long docker compose up --build
```

Le service écoute sur `127.0.0.1:8100` (jamais exposé publiquement).

## Variables

- `OCR_SERVICE_SECRET` (requis) : secret partagé avec l'app Next.js
- `OCR_LANG` (défaut `fra`) : langue Tesseract

## API

- `GET /health` → `{ "status": "ok" }`
- `POST /ocr` (multipart, champ `file`, header `x-ocr-secret`) →
  `{ text, lines, lineCount, lang, filename }`

Côté Next.js, configurer `OCR_SERVICE_URL=http://127.0.0.1:8100` et le même
`OCR_SERVICE_SECRET`. L'appelle passe par `POST /api/learnos/ocr`.
