import { describe, expect, it } from 'vitest';
import type { ModelMessage, ToolResult } from './messages.ts';
import { FULL_TOOL_RESULTS, SUMMARY_CHARACTERS, trimTranscript } from './trim-transcript.ts';

const result = (at: number, content: string): ToolResult => ({
  callId: `c${at}`,
  name: 'atlas_read',
  content,
  isError: false,
});

/** A conversation of `count` rounds, each a question, a call and its long result. */
function rounds(count: number, content = (at: number) => `${at}:`.padEnd(5_000, 'x')) {
  return Array.from({ length: count }, (_, at): ModelMessage[] => [
    { role: 'user', text: `Question ${at}` },
    { role: 'assistant', text: '', toolCalls: [{ id: `c${at}`, name: 'atlas_read', input: {} }] },
    { role: 'tool', results: [result(at, content(at))] },
  ]).flat();
}

const contents = (messages: readonly ModelMessage[]) =>
  messages.flatMap((message) =>
    message.role === 'tool' ? message.results.map((one) => one.content) : [],
  );

describe('trimTranscript', () => {
  it('keeps the last tool results in full and cuts the older ones to a summary', () => {
    const messages = rounds(FULL_TOOL_RESULTS + 2);
    const kept = contents(trimTranscript(messages));
    const full = contents(messages);

    expect(kept.slice(-FULL_TOOL_RESULTS)).toEqual(full.slice(-FULL_TOOL_RESULTS));
    for (const [at, summary] of kept.slice(0, 2).entries()) {
      expect(summary.startsWith(full[at]!.slice(0, SUMMARY_CHARACTERS))).toBe(true);
      expect(summary.length).toBeLessThan(SUMMARY_CHARACTERS + 200);
      expect(summary).toContain(`${5_000 - SUMMARY_CHARACTERS} characters left out`);
    }
  });

  it('changes nothing else: questions, answers, calls, and results short enough already', () => {
    const messages = rounds(FULL_TOOL_RESULTS + 3, (at) => (at === 0 ? 'short' : 'y'.repeat(900)));
    const trimmed = trimTranscript(messages);

    expect(trimmed.map((message) => message.role)).toEqual(messages.map((m) => m.role));
    expect(trimmed.filter((message) => message.role !== 'tool')).toEqual(
      messages.filter((message) => message.role !== 'tool'),
    );
    expect(contents(trimmed)[0]).toBe('short');
    expect(trimmed[2]).toMatchObject({ role: 'tool', results: [{ callId: 'c0', isError: false }] });
  });

  it('leaves a conversation with few enough results as it was', () => {
    const messages = rounds(FULL_TOOL_RESULTS);
    expect(trimTranscript(messages)).toEqual(messages);
  });
});
