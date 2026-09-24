"use client";

/**
 * École Miriam — Widget Cloudflare Turnstile (client-side)
 * ============================================================
 * Charge le script Turnstile et affiche le widget. Le token obtenu est
 * remonté au parent via `onToken`.
 *
 * DEUX BOGUES CORRIGÉS ICI
 * ------------------------
 * 1. `renderWidget` dépendait de `onToken`/`onExpire`/`onError`. La page de
 *    login passe des fonctions fléchées inline, recréées à CHAQUE rendu :
 *    l'effet se relançait donc à chaque frappe clavier et détruisait puis
 *    recréait le widget, annulant tout token déjà obtenu. Les callbacks sont
 *    désormais conservées dans des refs, si bien que le widget n'est monté
 *    qu'une fois. C'est la cause du « le mot de passe est bon mais rien ne
 *    se passe ».
 *
 * 2. Un token Turnstile est à USAGE UNIQUE et expire au bout de 5 minutes.
 *    Après un échec de connexion, l'ancien token était resoumis et Cloudflare
 *    répondait `timeout-or-duplicate` — la deuxième tentative échouait donc
 *    toujours, quel que soit le mot de passe. La prop `resetSignal` permet au
 *    parent de redemander un token neuf après chaque échec.
 *
 * Si `NEXT_PUBLIC_TURNSTILE_SITE_KEY` n'est pas défini, le widget ne s'affiche
 * pas (mode dégradé — dev local).
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
  /** Callback appelé en cas d'erreur (script bloqué, challenge échoué…). */
  onError?: () => void;
  /**
   * Incrémenter cette valeur redemande un token neuf. À faire après chaque
   * tentative de connexion échouée : le token précédent est consommé.
   */
  resetSignal?: number;
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
  resetSignal = 0,
  className,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [siteKey] = useState<string | null>(
    () => process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null
  );

  // Les callbacks sont gardées dans des refs : le widget ne doit JAMAIS être
  // remonté parce que le parent a re-rendu. Turnstile appelle toujours la
  // version la plus récente via `.current`.
  const onTokenRef = useRef(onToken);
  const onExpireRef = useRef(onExpire);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onTokenRef.current = onToken;
    onExpireRef.current = onExpire;
    onErrorRef.current = onError;
  });

  const renderWidget = useCallback(() => {
    if (!containerRef.current || !window.turnstile || !siteKey) return;
    if (widgetIdRef.current) return; // déjà monté

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      action: action ?? "turnstile-spin-v2",
      theme: "auto",
      size: "normal",
      callback: (token: string) => onTokenRef.current?.(token),
      "expired-callback": () => onExpireRef.current?.(),
      "error-callback": () => onErrorRef.current?.(),
    });
  }, [action, siteKey]);

  // Montage unique — les seules dépendances sont stables.
  useEffect(() => {
    if (!siteKey) return;

    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled) return;
        requestAnimationFrame(renderWidget);
      })
      .catch((err) => {
        console.error("[Turnstile] Chargement du script impossible:", err);
        // Le parent doit savoir qu'aucun token ne viendra, pour ne pas
        // laisser l'utilisateur bloqué sur un bouton qui échoue en silence.
        onErrorRef.current?.();
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // Ignorer
        }
        widgetIdRef.current = null;
      }
    };
  }, [renderWidget, siteKey]);

  // Redemande un token neuf quand le parent le signale (après un échec).
  useEffect(() => {
    if (resetSignal === 0) return;
    if (!widgetIdRef.current || !window.turnstile) return;
    try {
      window.turnstile.reset(widgetIdRef.current);
    } catch {
      // Ignorer
    }
  }, [resetSignal]);

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
