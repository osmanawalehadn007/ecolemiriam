"use client";

import { Printer } from "lucide-react";
import { BoutonIcone } from "@/components/bulletins/BoutonIcone";

export function PrintBulletinButton() {
  return (
    <BoutonIcone titre="Imprimer / Enregistrer en PDF" couleur="principal" onClick={() => window.print()}>
      <Printer size={20} />
    </BoutonIcone>
  );
}
