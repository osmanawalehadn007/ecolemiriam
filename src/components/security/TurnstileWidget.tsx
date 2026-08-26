"use client";

/**
 * École Miriam — Widget Cloudflare Turnstile (client-side)
 * ============================================================
 * Composant React qui charge le script Turnstile et affiche le widget.
 *
 * Le token `cf-turnstile-response` est stocké dans un champ caché et
 * automatiquement soumis avec le formulaire.
 *
 * Si `NEXT_PUBLIC_TURNSTILE_SITE_KEY` n'est pas défini, le widget ne
 * s'affiche pas (mode dégradé — utile en dev local).
 *
 * @see https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
 */

import { useEffect, useRef, useState, useCallback } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

interface TurnstileWidgetProps {
  /** Action associée au widget (ex: "login", "register"). */
  action?: string;
  /** Callback appelé quand le token est généré. */
  onToken?: (token: string) => void;
  /** Callback appelé quand le widget expire ou est réinitialisé. */
  onExpire?: () => void;
  /** Callback appelé en cas d'erreur. */
  onError?: () => void;
  /** Classe CSS additionnelle. */
  className?: string;
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
let scriptLoaded = false;
let scriptLoadPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (scriptLoaded) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      scriptLoaded = true;
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      scriptLoaded = true;
      resolve();
    };
    script.onerror = () => {
      scriptLoadPromise = null;
      reject(new Error("Failed to load Turnstile script"));
    };
    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

export function TurnstileWidget({
  action,
  onToken,
  onExpire,
  onError,
  className,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [siteKey] = useState<string | null>(
    () => process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null
  );

  const renderWidget = useCallback(() => {
    if (!containerRef.current || !window.turnstile || !siteKey) return;

    // Nettoyer l'ancien widget s'il existe
    if (widgetIdRef.current) {
      try {
        window.turnstile.remove(widgetIdRef.current);
      } catch {
        // Ignorer si déjà supprimé
      }
      widgetIdRef.current = null;
    }

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      action: action ?? "turnstile-spin-v2",
      theme: "light",
      size: "normal",
      callback: (token: string) => onToken?.(token),
      "expired-callback": () => onExpire?.(),
      "error-callback": () => onError?.(),
    });
  }, [action, onToken, onExpire, onError, siteKey]);

  useEffect(() => {
    if (!siteKey) return;

    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled) return;
        // Petit délai pour s'assurer que le container est dans le DOM
        requestAnimationFrame(renderWidget);
      })
      .catch((err) => {
        console.error("[Turnstile] Failed to load script:", err);
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // Ignorer
        }
      }
    };
  }, [renderWidget, siteKey]);

  // Si pas de site key, ne rien afficher (mode dégradé)
  if (!siteKey) {
    return null;
  }

  return <div ref={containerRef} className={className} data-action={action ?? "turnstile-spin-v2"} />;
}

/**
 * Hook pour réinitialiser le widget Turnstile (utile après un échec de formulaire).
 */
export function useTurnstileReset() {
  return useCallback(() => {
    if (window.turnstile) {
      window.turnstile.reset();
    }
  }, []);
}
