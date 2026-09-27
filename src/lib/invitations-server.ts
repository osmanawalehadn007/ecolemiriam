// Client Prisma SANS RLS (prisma-base) — CHOIX VOLONTAIRE :
// cette page est PUBLIQUE (aucune session), donc aucun contexte tenant n'existe.
// Le client de @/lib/prisma est fail-closed et lèverait « contexte tenant
// manquant » (HTTP 500). La recherche par empreinte de jeton est de toute façon
// cross-tenant par nature : le jeton est le secret. Même choix que auth.ts,
// tenant-claims.ts (deriveClaims) et audit.ts.
import prisma from "@/lib/prisma-base";
import { hashInvitationToken, isInvitationExpired } from "@/lib/invitations";

/**
 * Lectures serveur liées aux invitations (jamais importées par un composant
 * client : ce module touche Prisma).
 */

/** Vue publique et minimale d'une invitation — aucune donnée sensible. */
export interface PublicInvitationView {
  tenantName: string;
  email: string;
  name: string | null;
  role: string;
  expiresAt: Date;
  status: "PENDING" | "ACCEPTED" | "REVOKED";
  isExpired: boolean;
  canAccept: boolean;
}

/**
 * Retrouve une invitation par son jeton BRUT (celui du lien email). Le jeton est
 * re-haché en SHA-256 pour interroger la base — le clair n'est jamais stocké.
 */
export async function getInvitationByToken(
  token: string | null | undefined
): Promise<PublicInvitationView | null> {
  if (!token || token.length < 16) return null;

  // Lecture par empreinte de jeton : la session n'existe pas encore (page
  // publique), la recherche est donc nécessairement transnationale/tenant-blind
  // — mais elle ne peut aboutir qu'avec le jeton secret.
  // eslint-disable-next-line ecolemiriam/require-tenant-id
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    select: {
      email: true,
      name: true,
      role: true,
      status: true,
      expiresAt: true,
      tenant: { select: { name: true } },
    },
  });

  if (!invitation) return null;

  const isExpired = isInvitationExpired(invitation.expiresAt);

  return {
    tenantName: invitation.tenant.name,
    email: invitation.email,
    name: invitation.name,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    status: invitation.status,
    isExpired,
    canAccept: invitation.status === "PENDING" && !isExpired,
  };
}
