import { describe, expect, it } from 'vitest';
import { FULL_TOOL_RESULTS, SUMMARY_CHARACTERS, type ModelMessage } from '@atlas/domain';
import { fakeModel } from '../testing/fake-model.ts';
import { runChatTurn } from './run-chat-turn.ts';

/**
 * Adversarial (A27-01): a long chat that read many notes must not send every
 * note it ever read with each new question.
 */

const LONG = 'x'.repeat(10_000);

function history(results: number): ModelMessage[] {
  return Array.from({ length: results }, (_, at): ModelMessage[] => [
    { role: 'assistant', text: '', toolCalls: [{ id: `c${at}`, name: 'atlas_read', input: {} }] },
    {
      role: 'tool',
      results: [{ callId: `c${at}`, name: 'atlas_read', content: LONG, isError: false }],
    },
  ]).flat();
}

describe('runChatTurn (adversarial)', () => {
  it('sends older tool results as summaries, and the latest in full', async () => {
    const provider = fakeModel([[{ type: 'text', text: 'Done.' }]]);
    await runChatTurn({
      provider,
      toolbox: { specs: [], run: () => Promise.reject(new Error('no calls')) },
      model: 'claude-opus-5-5',
      system: 'System.',
      history: [...history(FULL_TOOL_RESULTS + 1), { role: 'user', text: 'And now?' }],
      signal: new AbortController().signal,
      onEvent: () => {},
    });

    const sent = provider.requests[0]!.messages.flatMap((message) =>
      message.role === 'tool' ? message.results.map((result) => result.content.length) : [],
    );
    expect(sent[0]).toBeLessThan(SUMMARY_CHARACTERS + 200);
    expect(sent.slice(1)).toEqual(Array(FULL_TOOL_RESULTS).fill(LONG.length));
  });
});
