/**
 * A conversation with a model, as Atlas keeps it: its own shape, not any
 * vendor's. Each provider translates this into what it sends (ADR-0021).
 */

/** The model asking for one of Atlas's tools to be run. */
export interface ToolCall {
  /** Pairs the call with its result; chosen by the provider, unique in a turn. */
  readonly id: string;
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

/** What running a tool call came to, as the model is told it. */
export interface ToolResult {
  readonly callId: string;
  readonly name: string;
  /** Text for the model: JSON for a read, a sentence for a refusal. */
  readonly content: string;
  readonly isError: boolean;
}

export type ModelMessage =
  | { readonly role: 'user'; readonly text: string }
  | {
      readonly role: 'assistant';
      readonly text: string;
      readonly toolCalls: readonly ToolCall[];
    }
  | { readonly role: 'tool'; readonly results: readonly ToolResult[] };

/** A tool as the model is told about it: a JSON Schema for its input. */
export interface ModelToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

/** The model a chat uses when Settings names none: the latest when this was written. */
export const DEFAULT_CHAT_MODEL = 'claude-opus-5-5';

/** The model named in Settings, or the default when it is blank. */
export function chatModelOrDefault(named: string | null | undefined): string {
  const trimmed = named?.trim() ?? '';
  return trimmed === '' ? DEFAULT_CHAT_MODEL : trimmed;
}
