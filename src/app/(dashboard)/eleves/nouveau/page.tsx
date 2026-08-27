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
}
