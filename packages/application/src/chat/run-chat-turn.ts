import { trimTranscript, type ModelMessage, type ToolCall, type ToolResult } from '@atlas/domain';
import { ChatCancelled, type ModelProvider } from './ports.ts';
import type { Proposal } from './proposals.ts';
import type { ChatToolbox } from './toolbox.ts';

/** Rounds of tool calls one question may take before the chat stops asking. */
export const MAX_TOOL_ROUNDS = 8;

/** What the panel hears as a turn goes. */
export type ChatTurnEvent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'tool_started'; readonly call: ToolCall }
  | {
      readonly type: 'tool_finished';
      readonly call: ToolCall;
      readonly result: ToolResult;
      readonly proposal: Proposal | null;
    };

export interface ChatTurnOutcome {
  /** What the turn added to the conversation, in order. */
  readonly added: readonly ModelMessage[];
  /** True when Stop ended it; what had arrived is kept. */
  readonly stopped: boolean;
}

/**
 * One question answered: the model is asked, any tools it calls are run and
 * their results sent back, until it answers without calling one — or Stop is
 * pressed, or the rounds run out. A provider failure rejects; what the turn
 * had added is then lost, and Retry asks again from the question.
 */
export async function runChatTurn({
  provider,
  toolbox,
  model,
  system,
  history,
  signal,
  onEvent,
}: {
  provider: ModelProvider;
  toolbox: ChatToolbox;
  model: string;
  system: string;
  /** The conversation so far, ending with the person's question. */
  history: readonly ModelMessage[];
  signal: AbortSignal;
  onEvent: (event: ChatTurnEvent) => void;
}): Promise<ChatTurnOutcome> {
  const added: ModelMessage[] = [];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const reply = { text: '', calls: [] as ToolCall[], malformed: [] as string[] };
    try {
      const messages = trimTranscript([...history, ...added]);
      const request = { model, system, messages, tools: toolbox.specs };
      for await (const event of provider.stream(request, signal)) {
        if (event.type === 'text') {
          reply.text += event.text;
          onEvent(event);
        } else if (event.type === 'tool_call') reply.calls.push(event.call);
        else reply.malformed.push(event.problem);
      }
    } catch (error) {
      if (!(error instanceof ChatCancelled)) throw error;
      if (reply.text !== '') added.push({ role: 'assistant', text: reply.text, toolCalls: [] });
      return { added, stopped: true };
    }
    added.push({ role: 'assistant', text: reply.text, toolCalls: reply.calls });
    if (reply.calls.length === 0 && reply.malformed.length === 0) return { added, stopped: false };

    const results = await runCalls({ calls: reply.calls, toolbox, onEvent });
    added.push({ role: 'tool', results: [...results, ...reply.malformed.map(malformedResult)] });
    if (signal.aborted) return { added, stopped: true };
  }
  const gaveUp = `\n\n(I stopped after ${MAX_TOOL_ROUNDS} rounds of looking things up without an answer.)`;
  onEvent({ type: 'text', text: gaveUp });
  added.push({ role: 'assistant', text: gaveUp.trim(), toolCalls: [] });
  return { added, stopped: false };
}

/** Runs each call in the order the model made them, telling the panel as each starts and ends. */
async function runCalls({
  calls,
  toolbox,
  onEvent,
}: {
  calls: readonly ToolCall[];
  toolbox: ChatToolbox;
  onEvent: (event: ChatTurnEvent) => void;
}): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  for (const call of calls) {
    onEvent({ type: 'tool_started', call });
    const { result, proposal } = await toolbox.run(call);
    onEvent({ type: 'tool_finished', call, result, proposal });
    results.push(result);
  }
  return results;
}

function malformedResult(problem: string, at: number): ToolResult {
  return {
    callId: `malformed-${at + 1}`,
    name: 'invalid_tool_call',
    content: problem,
    isError: true,
  };
}
