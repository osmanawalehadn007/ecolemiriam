"use client";

import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";

/**
 * Fournit le contexte de session NextAuth aux composants client qui
 * utilisent useSession(). Sans ce provider, useSession() retourne
 * toujours { data: null, status: "loading" } — les composants qui en
 * dépendent (Security2FA, page audit, page sauvegardes) ne fonctionnent pas.
 *
 * La session est récupérée côté serveur (dans layout.tsx via auth()) et
 * passée en prop. Sans cela, useSession() reste bloqué sur "loading"
 * et les composants affichent un spinner infini ou rien du tout.
 */
export function AuthProvider({
  children,
  session,
}: {
  children: React.ReactNode;
  session?: Session | null;
}) {
  return <SessionProvider session={session}>{children}</SessionProvider>;
}
