/**
 * École Miriam — Stockage des fichiers publics sur Cloudflare R2
 * ==============================================================
 *
 * Les images d'identité de l'établissement (logo, signature, cachet) étaient
 * historiquement stockées en base sous forme de data URL base64. Le logo de
 * 485 Ko a fini par gonfler le cookie de session au-delà de la limite d'en-tête
 * HTTP (307 200 octets), ce qui renvoyait un 502 sur toute l'application. Le
 * base64 en base reste par ailleurs coûteux : il est retransporté à chaque
 * génération de bulletin, de facture ou d'attestation.
 *
 * On stocke donc les octets dans R2 et seule l'URL publique va en base.
 *
 * La clé est adressée par contenu (`<nom>-<empreinte>.<ext>`) : remplacer une
 * image produit une clé différente, donc une URL différente. Aucun cache CDN
 * ni navigateur ne peut servir une version périmée, et l'objet peut être
 * déclaré `immutable` avec une durée de vie maximale.
 */

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function config() {
  const {
    R2_ACCOUNT_ID: accountId,
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
    R2_BUCKET_NAME: bucket,
    NEXT_PUBLIC_R2_PUBLIC_URL: publicUrl,
  } = process.env;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket, publicUrl };
}

export function isR2Configured(): boolean {
  return config() !== null;
}

// Le client est réutilisé entre les requêtes : l'instancier à chaque appel
// rouvrirait un pool de connexions à chaque téléversement.
let client: S3Client | null = null;

function getClient(cfg: NonNullable<ReturnType<typeof config>>): S3Client {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }
  return client;
}

/**
 * Téléverse une image dans le bucket public et renvoie son URL.
 *
 * En l'absence de configuration R2, on retombe sur une data URL base64 —
 * uniquement hors production, pour qu'un poste de développement sans
 * identifiants R2 reste utilisable. En production, l'absence de
 * configuration est une erreur : un repli silencieux réintroduirait le
 * base64 en base, c'est-à-dire précisément le bug que ce module corrige.
 */
export async function uploadPublicImage(opts: {
  buffer: Buffer;
  contentType: string;
  /** Chemin logique sans extension, ex. `tenants/<tenantId>/logo`. */
  path: string;
}): Promise<string> {
  const { buffer, contentType, path } = opts;

  const extension = EXTENSIONS[contentType];
  if (!extension) throw new Error(`Type d'image non supporté : ${contentType}`);

  const cfg = config();
  if (!cfg) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Stockage R2 non configuré : R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, " +
          "R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME et NEXT_PUBLIC_R2_PUBLIC_URL sont requis."
      );
    }
    console.warn("[storage/r2] Non configuré — repli sur une data URL base64 (hors production).");
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  }

  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 8);
  const key = `${path}-${hash}.${extension}`;

  await getClient(cfg).send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );

  return `${cfg.publicUrl.replace(/\/$/, "")}/${key}`;
}
