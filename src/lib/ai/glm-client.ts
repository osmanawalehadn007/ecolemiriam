/**
 * EcolPro — Client Assistant IA
 * ==============================
 * Façade publique de l'abstraction IA. Point d'entrée inchangé pour tout le
 * code existant (`/api/ai/chat`, appréciations, outils emploi du temps).
 *
 * La sélection du provider (Ollama local en priorité, OpenRouter en fallback)
 * est déléguée au routeur (`src/lib/ai/router.ts`). Variables d'environnement :
 *   AI_PROVIDER=auto|ollama|openrouter
 *   OLLAMA_BASE_URL / OLLAMA_DEFAULT_MODEL (local)
 *   GLM_API_KEY / GLM_API_BASE_URL / GLM_MODEL (cloud)
 */

import { getAiProvider, getAiProviderForTools } from "./router";
import type {
  ChatMessage,
  ChatOptions,
  ChatResult,
  ToolCall,
  ToolDefinition,
} from "./providers/base";
import { AiConfigError } from "./providers/base";

export type { ChatMessage, ChatResult, ToolCall, ToolDefinition };
export { AiConfigError };

/**
 * Appelle le provider IA sélectionné. Retourne le texte généré et, le cas
 * échéant, les appels d'outils demandés par le modèle — à l'appelant de les
 * exécuter et de renvoyer leur résultat dans un tour suivant (rôle "tool").
 */
export async function generateChat(
  messages: ChatMessage[],
  options?: ChatOptions
): Promise<ChatResult> {
  const provider = options?.tools?.length
    ? await getAiProviderForTools()
    : await getAiProvider();
  return provider.generateChat(messages, options);
}

/**
 * Variante simple : retourne uniquement le texte généré (pas d'outils).
 * Si la première tentative revient vide (ex: le modèle a répété un réflexe
 * d'appel d'outil sous forme de texte alors qu'aucun outil n'était proposé),
 * on retente une fois avec une consigne explicite avant d'abandonner.
 */
export async function generateCompletion(
  messages: ChatMessage[],
  options?: ChatOptions
): Promise<string> {
  const { content } = await generateChat(messages, options);
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  const retry = await generateChat(
    [
      ...messages,
      {
        role: "user",
        content:
          "Réponds uniquement par un message en texte simple pour l'utilisateur, sans appel d'outil ni balise technique.",
      },
    ],
    options
  );
  if (typeof retry.content === "string" && retry.content.trim()) {
    return retry.content.trim();
  }

  throw new Error("Réponse IA vide ou invalide");
}
