/**
 * École Miriam — Client Assistant IA (GLM via OpenRouter, API compatible OpenAI)
 * ============================================================
 * Variables d'environnement :
 *   GLM_API_KEY=...
 *   GLM_API_BASE_URL=https://openrouter.ai/api/v1
 *   GLM_MODEL=z-ai/glm-4.6   (identifiant exact affiché sur openrouter.ai/models)
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
  const apiKey = process.env.GLM_API_KEY;
  const model = process.env.GLM_MODEL;

  if (!apiKey || !model) {
    throw new AiConfigError(
      "Assistant IA non configuré (GLM_API_KEY / GLM_MODEL manquants dans l'environnement)"
    );
  }

  const baseUrl = process.env.GLM_API_BASE_URL ?? DEFAULT_BASE_URL;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://ecolemiriam.app";

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      // Recommandé par OpenRouter pour l'attribution des requêtes.
      "HTTP-Referer": appUrl,
      "X-Title": "École Miriam",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options?.temperature ?? 0.6,
      max_tokens: options?.maxTokens ?? 400,
      reasoning: { enabled: options?.reasoning ?? false },
      ...(options?.tools ? { tools: options.tools, tool_choice: "auto" } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Erreur API IA (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const message = data?.choices?.[0]?.message;
  let toolCalls: ToolCall[] = (message?.tool_calls ?? []).map(
    (tc: { id: string; function: { name: string; arguments: string } }) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    })
  );
  let content: string | null = message?.content ?? null;

  if (toolCalls.length === 0 && typeof content === "string" && content.includes("<tool_call>")) {
    // On ne convertit en toolCalls que si des outils étaient réellement
    // proposés pour cet appel — sinon l'appelant (ex: generateCompletion,
    // qui ignore les toolCalls) se retrouverait avec un contenu vidé sans
    // rien à exécuter. Dans tous les cas, on nettoie la balise du texte.
    if (options?.tools && options.tools.length > 0) {
      const fallback = parseFallbackToolCalls(content);
      if (fallback.length > 0) {
        toolCalls = fallback;
        content = null;
      }
    } else {
      content = stripToolCallTags(content);
    }
  }

  return { content, toolCalls };
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
