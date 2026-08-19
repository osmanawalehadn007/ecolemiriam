"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Global Error]", error);
  }, [error]);

  return (
    <html lang="fr">
      <body>
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          padding: "2rem",
          textAlign: "center",
          fontFamily: "system-ui, sans-serif",
        }}>
          <AlertTriangle size={48} color="#f59e0b" />
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginTop: "1rem" }}>
            Erreur critique
          </h2>
          <p style={{ color: "#666", marginTop: "0.5rem", maxWidth: "400px" }}>
            {error.message || "Une erreur critique s'est produite."}
          </p>
          {error.digest && (
            <p style={{ color: "#999", fontSize: "0.75rem", marginTop: "0.5rem" }}>
              Référence : {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              padding: "0.5rem 1.5rem",
              background: "#6366f1",
              color: "white",
              border: "none",
              borderRadius: "0.5rem",
              cursor: "pointer",
            }}
          >
            Réessayer
          </button>
        </div>
      </body>
    </html>
  );
}
