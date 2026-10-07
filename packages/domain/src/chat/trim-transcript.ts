import type { ModelMessage, ToolResult } from './messages.ts';

/** How many of the latest tool results are sent in full with each question. */
export const FULL_TOOL_RESULTS = 6;

/** How much of an older tool result is kept, as its summary. */
export const SUMMARY_CHARACTERS = 400;

/**
 * The conversation as it is sent with the next question (ADR-0021). A chat
 * that has read many notes would otherwise send every one of them again each
 * time; the latest results are what the model is working from, so they go in
 * full, and each older one is cut to its opening with a note of what was left
 * out — the model can run the tool again to see the rest. Nothing else changes.
 */
export function trimTranscript(messages: readonly ModelMessage[]): ModelMessage[] {
  const total = messages.reduce(
    (count, message) => count + (message.role === 'tool' ? message.results.length : 0),
    0,
  );
  let seen = 0;
  return messages.map((message) => {
    if (message.role !== 'tool') return message;
    const results = message.results.map((result) => {
      seen += 1;
      return total - seen < FULL_TOOL_RESULTS ? result : summarised(result);
    });
    return { role: 'tool', results };
  });
}

function summarised(result: ToolResult): ToolResult {
  const { content } = result;
  if (content.length <= SUMMARY_CHARACTERS) return result;
  const left = content.length - SUMMARY_CHARACTERS;
  return {
    ...result,
    content: `${content.slice(0, SUMMARY_CHARACTERS)}… (${left} characters left out; run the tool again to see them)`,
  };
}
