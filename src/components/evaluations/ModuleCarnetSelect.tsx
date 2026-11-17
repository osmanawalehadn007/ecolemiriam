"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MODULES } from "@/lib/carnet-primaire/referentiel";

/**
 * Module du carnet du primaire auquel une évaluation (ou un devoir) est rattachée.
 * « Hors carnet » : ses notes n'alimentent pas le carnet.
 */
export function ModuleCarnetSelect({ evaluationId, moduleCarnet }: { evaluationId: string; moduleCarnet: number | null }) {
  const router = useRouter();
  const [valeur, setValeur] = useState<string>(moduleCarnet === null ? "" : String(moduleCarnet));
  const [enCours, setEnCours] = useState(false);

  async function changer(nouvelle: string) {
    const precedente = valeur;
    setValeur(nouvelle);
    setEnCours(true);
    try {
      const res = await fetch(`/api/evaluations/${evaluationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleCarnet: nouvelle === "" ? null : Number(nouvelle) }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Erreur");
      toast.success(nouvelle === "" ? "Retirée du carnet" : `Rattachée au module ${nouvelle} du carnet`);
      router.refresh();
    } catch (e) {
      setValeur(precedente);
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <select
      value={valeur}
      onChange={(e) => void changer(e.target.value)}
      disabled={enCours}
      aria-label="Module du carnet"
      className="mt-1 h-7 rounded-md border border-input bg-background px-1.5 text-xs font-normal text-foreground"
    >
      <option value="">Hors carnet</option>
      {MODULES.map((m) => (
        <option key={m} value={m}>
          Carnet · module {m}
        </option>
      ))}
    </select>
  );
}
