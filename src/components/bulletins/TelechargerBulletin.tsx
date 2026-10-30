"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { telechargerBulletinPdf } from "@/lib/bulletins/pdf-client";

/** Bouton « Enregistrer en PDF » : photographie le bulletin affiché (#bulletin-document). */
export function TelechargerBulletin({ nomFichier, style }: { nomFichier: string; style?: React.CSSProperties }) {
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
      <button
        type="button"
        onClick={telecharger}
        disabled={encours}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          border: "1px solid #d1d5db",
          background: "#fff",
          color: "#111827",
          borderRadius: 6,
          padding: "6px 12px",
          fontSize: 14,
          whiteSpace: "nowrap",
          cursor: encours ? "wait" : "pointer",
          ...style,
        }}
      >
        {encours ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        {encours ? "Création du PDF…" : "Enregistrer / Télécharger"}
      </button>
      {erreur && (
        <span role="alert" style={{ color: "#b91c1c", fontSize: 12, alignSelf: "center" }}>
          {erreur}
        </span>
      )}
    </>
  );
}
