"use client";

import { Building2, LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";

interface NoTenantAccessProps {
  userName: string;
}

/**
 * Affiché quand un utilisateur authentifié n'a aucune adhésion à un
 * établissement (UserTenant). Sans cette page, /select-tenant redirigeait
 * vers /dashboard qui redirigeait vers /login → boucle infinie.
 */
export function NoTenantAccess({ userName }: NoTenantAccessProps) {
  const t = useTranslations("login");

  return (
    <div className="w-full max-w-md text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-950 mb-4 shadow-lg">
        <Building2 className="w-8 h-8 text-amber-600 dark:text-amber-400" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight mb-2">
        {t("title") === "Sign In" ? "No establishment linked" : "Aucun établissement rattaché"}
      </h1>
      <p className="text-muted-foreground text-sm mb-6">
        {t("title") === "Sign In"
          ? `Your account (${userName}) is not linked to any establishment. Please contact your administrator to get access.`
          : `Votre compte (${userName}) n'est rattaché à aucun établissement. Veuillez contacter votre administrateur pour obtenir un accès.`}
      </p>
      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <LogOut className="w-4 h-4" />
        {t("switchAccount") ?? "Changer de compte"}
      </button>
    </div>
  );
}
