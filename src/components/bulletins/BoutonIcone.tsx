"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> & {
  /** Texte de l'info-bulle et du lecteur d'écran : le bouton n'a pas d'autre libellé. */
  titre: string;
  couleur?: "neutre" | "principal" | "whatsapp";
  children: ReactNode;
};

const COULEURS = {
  neutre: "border-gray-300 bg-white text-gray-700 hover:bg-gray-100",
  principal: "border-green-600 bg-green-600 text-white hover:bg-green-700",
  whatsapp: "border-gray-300 bg-white text-[#25D366] hover:bg-green-50",
} as const;

/** Bouton carré à icône seule, de la barre d'outils du bulletin. */
export function BoutonIcone({ titre, couleur = "neutre", className = "", children, ...reste }: Props) {
  return (
    <button
      type="button"
      title={titre}
      aria-label={titre}
      {...reste}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border shadow-sm transition-colors disabled:cursor-wait disabled:opacity-60 ${COULEURS[couleur]} ${className}`}
    >
      {children}
    </button>
  );
}
