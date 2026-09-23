/**
 * EcolPro — Provider IA cloud : OpenRouter (GLM et autres modèles)
 * =================================================================
 * Provider de repli cloud quand Ollama n'est pas disponible ou que la tâche
 * est complexe (tool calling avancé, raisonnement long).
 *
 * Variables d'environnement :
 *   GLM_API_KEY=...
 *   GLM_API_BASE_URL=https://openrouter.ai/api/v1
 *   GLM_MODEL=z-ai/glm-4.6
 */

import type {
  AiProvider,
  ChatMessage,
  ChatOptions,
  ChatResult,
  ToolCall,
} from "./base";
import { AiConfigError } from "./base";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const CLOUD_TIMEOUT_MS = Number(process.env.AI_CLOUD_TIMEOUT_MS ?? 15_000);

/**
 * Filet de sécurité : certains backends OpenRouter traduisent mal le tool
 * calling natif — le modèle écrit alors son appel d'outil en texte brut au
 * format "<tool_call>...</tool_call>". On le détecte et le convertit ici.
 */
function parseFallbackToolCalls(content: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const blockRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  let blockMatch: RegExpExecArray | null;
  let index = 0;

  while ((blockMatch = blockRegex.exec(content))) {
    const body = blockMatch[1];
    const nameMatch = body.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)/);
    if (!nameMatch) continue;
    const name = nameMatch[1];

    const args: Record<string, string> = {};
    const argRegex = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/g;
    let argMatch: RegExpExecArray | null;
    while ((argMatch = argRegex.exec(body))) {
      args[argMatch[1].trim()] = argMatch[2].trim();
    }

    calls.push({ id: `fallback_${index++}`, name, arguments: JSON.stringify(args) });
  }

  return calls;
}

/** Retire toute balise <tool_call> résiduelle du texte. */
export function stripToolCallTags(content: string): string {
  return content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
}

export class OpenRouterProvider implements AiProvider {
  readonly name = "openrouter";

  private get apiKey(): string | undefined {
    return process.env.GLM_API_KEY;
  }

  private get model(): string | undefined {
    return process.env.GLM_MODEL;
  }

  private get baseUrl(): string {
    return (process.env.GLM_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey && this.model);
  }

  async generateChat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
    if (!this.apiKey || !this.model) {
      throw new AiConfigError(
        "Provider cloud non configuré (GLM_API_KEY / GLM_MODEL manquants dans l'environnement)"
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://ecolpro.app";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CLOUD_TIMEOUT_MS);

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "HTTP-Referer": appUrl,
          "X-Title": "EcolPro",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: options?.temperature ?? 0.6,
          max_tokens: options?.maxTokens ?? 400,
          reasoning: { enabled: options?.reasoning ?? false },
          ...(options?.tools && options.tools.length > 0
            ? { tools: options.tools, tool_choice: "auto" }
            : {}),
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
    } finally {
      clearTimeout(timeout);
    }
  }
}
