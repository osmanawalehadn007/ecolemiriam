"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { telechargerBulletinPdf } from "@/lib/bulletins/pdf-client";
import { BoutonIcone } from "@/components/bulletins/BoutonIcone";

/** Icône « Enregistrer / Télécharger » : photographie le bulletin affiché (#bulletin-document) en PDF. */
export function TelechargerBulletin({ nomFichier }: { nomFichier: string }) {
  const [encours, setEncours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function telecharger() {
    const element = document.getElementById("bulletin-document");
    if (!element) return;
    setEncours(true);
    setErreur(null);
    try {
      await telechargerBulletinPdf(element, nomFichier);
    } catch {
      setErreur("Le PDF n'a pas pu être créé. Utilisez Imprimer, puis « Enregistrer au format PDF ».");
    } finally {
      setEncours(false);
    }
  }

  return (
    <>
      <BoutonIcone titre={encours ? "Création du PDF…" : "Enregistrer / Télécharger (PDF)"} onClick={telecharger} disabled={encours}>
        {encours ? <Loader2 size={20} className="animate-spin" /> : <Download size={20} />}
      </BoutonIcone>
      {erreur && (
        <span role="alert" className="self-center text-xs text-red-700">
          {erreur}
        </span>
      )}
    </>
  );
}
