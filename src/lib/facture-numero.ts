import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

/**
 * Numérotation atomique des factures.
 *
 * Les numéros étaient calculés par `prisma.facture.count() + 1`. Deux défauts :
 *   - la requête passe par RLS : un utilisateur rattaché à un site ne compte
 *     que les factures de son site, donc chaque site repartait de sa propre
 *     séquence (65 numéros en double ou en triple constatés le 2026-09-27) ;
 *   - « compter puis ajouter 1 » n'est pas atomique : deux créations
 *     simultanées obtiennent le même numéro, et une suppression fait
 *     réattribuer un numéro déjà émis.
 *
 * Le compteur vit désormais en base (table `facture_sequences`) et n'est
 * accessible qu'à travers la fonction SQL `next_facture_numeros`, en
 * SECURITY DEFINER : elle voit toutes les factures du tenant quel que soit
 * le site de l'utilisateur, et réserve le bloc de numéros sous verrou.
 * Voir scripts/migrate-numerotation-factures.ts.
 *
 * Appelée dans une transaction interactive, la réservation est annulée avec
 * elle ; appelée hors transaction, un échec de création laisse un trou dans
 * la séquence, mais jamais de doublon.
 */

type RawClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export function formatNumeroFacture(prefixe: string | number, sequence: number): string {
  return `FAC-${prefixe}-${String(sequence).padStart(5, "0")}`;
}

export async function reserverNumerosFacture(
  tenantId: string,
  prefixe: string | number,
  nombre: number,
  client: RawClient = prisma,
): Promise<string[]> {
  if (nombre <= 0) return [];
  const rows = await client.$queryRaw<{ premier: number }[]>`
    SELECT next_facture_numeros(${tenantId}, ${String(prefixe)}, ${nombre}::int) AS premier`;
  const premier = Number(rows[0]?.premier);
  if (!Number.isInteger(premier) || premier < 1) {
    throw new Error("Numérotation des factures indisponible");
  }
  return Array.from({ length: nombre }, (_, i) => formatNumeroFacture(prefixe, premier + i));
}

export async function reserverNumeroFacture(
  tenantId: string,
  prefixe: string | number,
  client: RawClient = prisma,
): Promise<string> {
  const [numero] = await reserverNumerosFacture(tenantId, prefixe, 1, client);
  return numero;
}
