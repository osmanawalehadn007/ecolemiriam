import { guardPage } from "@/lib/guard-page";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

/**
 * Source unique d'inscription.
 *
 * L'inscription d'un élève passe désormais exclusivement par le workflow
 * d'admissions (candidature → dossier → admission → facture → paiement →
 * création automatique de la fiche élève). L'ancienne saisie directe est
 * conservée uniquement comme redirection pour ne pas casser les liens/URL
 * existants.
 */
export default function NouveauElevePage() {
  redirect("/admissions");
export default async function NouveauElevePage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");
  guardPage(session, "eleves:write");

  const classes = await getClassesForTenant();
  const sites = await getSitesForUser();
  const currentSiteId = (session.user as { siteId?: string | null }).siteId ?? null;
  const tenantHasSites = (session.user as { tenantHasSites?: boolean }).tenantHasSites ?? false;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title="Inscrire un élève"
        subtitle="Créer une nouvelle fiche élève"
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <EleveForm
          classes={classes}
          sites={sites}
          currentSiteId={currentSiteId}
          tenantHasSites={tenantHasSites}
          submitAction={createEleve}
          submitLabel="Créer"
          title="Inscrire un élève"
          backHref="/eleves"
        />
      </div>
    </div>
  );
}
