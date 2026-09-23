/**
 * EcolPro — Provider IA local : Ollama
 * =====================================
 * Ollama expose une API OpenAI-compatible sur http://localhost:11434/v1.
 * Gratuit, offline, illimité — c'est le provider prioritaire pour les tâches
 * simples (rédaction courte, reformulation, synthèses).
 *
 * Variables d'environnement :
 *   OLLAMA_BASE_URL=http://localhost:11434
 *   OLLAMA_DEFAULT_MODEL=llama3.2:3b
 */

import type {
  AiProvider,
  ChatMessage,
  ChatOptions,
  ChatResult,
  ToolCall,
} from "./base";
import { AiConfigError } from "./base";

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_MODEL = "llama3.2:3b";
const LOCAL_TIMEOUT_MS = Number(process.env.AI_LOCAL_TIMEOUT_MS ?? 30_000);

export class OllamaProvider implements AiProvider {
  readonly name = "ollama";

  private get baseUrl(): string {
    return (process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  private get model(): string {
    return process.env.OLLAMA_DEFAULT_MODEL ?? DEFAULT_MODEL;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generateChat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
    if (!(await this.isAvailable())) {
      throw new AiConfigError(
        "Ollama n'est pas joignable. Lancez `ollama serve` localement ou configurez OLLAMA_BASE_URL."
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LOCAL_TIMEOUT_MS);

    try {
      // API OpenAI-compatible d'Ollama.
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: options?.temperature ?? 0.6,
          max_tokens: options?.maxTokens ?? 400,
          stream: false,
          ...(options?.tools && options.tools.length > 0
            ? { tools: options.tools, tool_choice: "auto" }
            : {}),
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Erreur Ollama (${res.status}): ${text.slice(0, 300)}`);
      }

      const data = await res.json();
      const message = data?.choices?.[0]?.message;
      const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map(
        (tc: { id: string; function: { name: string; arguments: string } }) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        })
      );
      const content: string | null = message?.content ?? null;

      return { content, toolCalls };
    } finally {
      clearTimeout(timeout);
    }
  }
}
