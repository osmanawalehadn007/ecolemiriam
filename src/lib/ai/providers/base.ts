/**
 * EcolPro — Abstraction des fournisseurs IA
 * ==========================================
 * Interface commune à tous les providers (Ollama local, OpenRouter, Groq, ...).
 * Les types reprennent l'API OpenAI, qui est le plus petit dénominateur
 * commun : Ollama et OpenRouter la supportent tous les deux.
 */

export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON brut renvoyé par le modèle — à parser par l'appelant
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatResult {
  content: string | null;
  toolCalls: ToolCall[];
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  reasoning?: boolean;
  tools?: ToolDefinition[];
}

export class AiConfigError extends Error {}
export class AiProviderUnavailableError extends Error {}

/**
 * Contrat minimal d'un provider IA.
 */
export interface AiProvider {
  /** Identifiant court du provider ("ollama", "openrouter", ...). */
  readonly name: string;

  /** Vérifie que le provider est configuré et joignable. */
  isAvailable(): Promise<boolean>;

  /** Appel de chat avec support du tool calling. */
  generateChat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
}
