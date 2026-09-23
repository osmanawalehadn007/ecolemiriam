/**
 * EcolPro — Routeur IA
 * =====================
 * Sélectionne le provider selon la stratégie configurée :
 *   AI_PROVIDER=ollama     → local uniquement (gratuit, offline)
 *   AI_PROVIDER=openrouter → cloud uniquement
 *   AI_PROVIDER=auto       → Ollama en priorité, fallback OpenRouter (défaut)
 *
 * Les tâches nécessitant du tool calling complexe peuvent être forcées vers le
 * cloud via `getAiProvider({ preferCloud: true })`.
 */

import type { AiProvider } from "./providers/base";
import { AiConfigError } from "./providers/base";
import { OllamaProvider } from "./providers/ollama";
import { OpenRouterProvider } from "./providers/openrouter";

type ProviderName = "ollama" | "openrouter" | "auto";

let cachedOllama: OllamaProvider | null = null;
let cachedOpenRouter: OpenRouterProvider | null = null;

function ollama(): OllamaProvider {
  cachedOllama ??= new OllamaProvider();
  return cachedOllama;
}

function openrouter(): OpenRouterProvider {
  cachedOpenRouter ??= new OpenRouterProvider();
  return cachedOpenRouter;
}

export interface RouterOptions {
  /** Forcer le cloud même en mode auto (tool calling complexe). */
  preferCloud?: boolean;
  /** Forcer le local même en mode auto (confidentialité maximale). */
  preferLocal?: boolean;
}

/**
 * Retourne le provider à utiliser pour cette tâche.
 */
export async function getAiProvider(opts: RouterOptions = {}): Promise<AiProvider> {
  const configured = (process.env.AI_PROVIDER ?? "auto") as ProviderName;

  if (configured === "ollama") return ollama();
  if (configured === "openrouter") return openrouter();

  // Mode auto : local d'abord (sauf si on force le cloud), puis fallback cloud.
  if (!opts.preferCloud) {
    if (await ollama().isAvailable()) return ollama();
    if (!opts.preferLocal && (await openrouter().isAvailable())) return openrouter();
  } else {
    if (await openrouter().isAvailable()) return openrouter();
    if (!opts.preferLocal && (await ollama().isAvailable())) return ollama();
  }

  if (opts.preferLocal && (await ollama().isAvailable())) return ollama();

  throw new AiConfigError(
    "Aucun provider IA disponible. Lancez Ollama localement (ollama serve) ou configurez GLM_API_KEY / GLM_MODEL pour le cloud."
  );
}

/**
 * Variante pour les tool calls complexes : on sait que certains modèles
 * locaux gèrent mal le function calling → on privilégie le cloud.
 */
export async function getAiProviderForTools(): Promise<AiProvider> {
  const configured = (process.env.AI_PROVIDER ?? "auto") as ProviderName;
  if (configured === "ollama") return ollama();
  if (configured === "openrouter") return openrouter();
  return getAiProvider({ preferCloud: true });
}
