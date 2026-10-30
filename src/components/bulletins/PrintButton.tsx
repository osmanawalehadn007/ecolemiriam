"use client";

import { Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { BoutonIcone } from "@/components/bulletins/BoutonIcone";

export function PrintButton() {
  const t = useTranslations("bulletins");
  return (
    <BoutonIcone titre={t("printPdf")} couleur="principal" onClick={() => window.print()}>
      <Printer size={20} />
    </BoutonIcone>
  );
}
