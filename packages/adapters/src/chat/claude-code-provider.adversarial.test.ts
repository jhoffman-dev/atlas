import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatCancelled, ModelProviderError, type ModelRequest } from '@atlas/application';
import { claudeCodeProvider } from './claude-code-provider.ts';
import type { ModelProcessHost } from './model-process.ts';

/**
 * Adversarial (A27-01): a `claude` that never answers — a login prompt left
 * waiting, a hung network — must not leave the panel waiting for ever or the
 * process running behind it.
 */

const REQUEST: ModelRequest = {
  model: 'claude-opus-5-5',
  system: 'You are Claude in Atlas.',
  messages: [{ role: 'user', text: 'Who is Sam?' }],
  tools: [],
};

/** A `claude` that prints nothing and exits only when killed. */
function silentClaude() {
  const killed: boolean[] = [];
  const host: ModelProcessHost = {
    run: ({ signal }) =>
      new Promise((resolve) =>
        signal.addEventListener('abort', () => {
          killed.push(true);
          resolve({ code: null, stderr: '' });
        }),
      ),
  };
  return { host, killed };
}

const TIMEOUTS = { status: 1_000, run: 5_000 };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the Claude Code provider under a silent claude (adversarial)', () => {
  it('gives up on `claude auth status` and kills it', async () => {
    const { host, killed } = silentClaude();
    const status = claudeCodeProvider(host, { timeouts: TIMEOUTS }).status();

    await vi.advanceTimersByTimeAsync(TIMEOUTS.status);

    await expect(status).resolves.toMatchObject({ ready: false, problem: 'unavailable' });
    await expect(status).resolves.toMatchObject({ message: expect.stringMatching(/1 second/) });
    expect(killed).toEqual([true]);
  });

  it('ends a run that outlasts its time as a failure, not a Stop, and kills it', async () => {
    const { host, killed } = silentClaude();
    const stream = claudeCodeProvider(host, { timeouts: TIMEOUTS }).stream(
      REQUEST,
      new AbortController().signal,
    );
    const events = stream[Symbol.asyncIterator]();
    const next = events.next();
    const settled = next.then(
      () => null,
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(TIMEOUTS.run - 1);
    expect(killed).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    const error = await settled;
    expect(error).toBeInstanceOf(ModelProviderError);
    expect(error).not.toBeInstanceOf(ChatCancelled);
    expect((error as Error).message).toMatch(/5 seconds/);
    expect(killed).toEqual([true]);
  });

  it('still reports Stop as a Stop before the time is up', async () => {
    const { host } = silentClaude();
    const stop = new AbortController();
    const stream = claudeCodeProvider(host, { timeouts: TIMEOUTS }).stream(REQUEST, stop.signal);
    const events = stream[Symbol.asyncIterator]();
    const next = events.next();
    stop.abort();
    await expect(next).rejects.toBeInstanceOf(ChatCancelled);
  });
});
