"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Page Error]", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
      <h2 className="text-xl font-semibold mb-2">Une erreur est survenue</h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-md">
        {error.message || "Une erreur inattendue s'est produite. Veuillez réessayer."}
      </p>
      {error.digest && (
        <p className="text-xs text-muted-foreground mb-4">Référence : {error.digest}</p>
      )}
      <div className="flex gap-3">
        <Button onClick={reset} variant="default">
          Réessayer
        </Button>
        <Button onClick={() => window.location.href = "/dashboard"} variant="outline">
          Retour au tableau de bord
        </Button>
      </div>
    </div>
  );
}
