import {
  ChatCancelled,
  type ModelEvent,
  type ModelProvider,
  type ModelRequest,
} from '../chat/ports.ts';

/**
 * A model that says what it is scripted to, one round per request, and
 * remembers every request it was sent. A round that is a function is called
 * with the signal, for a test that stops a turn part-way. Test support only.
 */
export interface FakeModel extends ModelProvider {
  readonly requests: ModelRequest[];
}

export type ScriptedRound =
  readonly ModelEvent[] | ((signal: AbortSignal) => AsyncIterable<ModelEvent>) | Error;

export function fakeModel(rounds: readonly ScriptedRound[]): FakeModel {
  const requests: ModelRequest[] = [];
  return {
    id: 'claude-code',
    requests,
    status: async () => ({ ready: true }),
    async *stream(request, signal) {
      requests.push(request);
      const round = rounds[requests.length - 1];
      if (round === undefined) throw new Error(`the script has no round ${requests.length}`);
      if (round instanceof Error) throw round;
      const events = typeof round === 'function' ? round(signal) : round;
      for await (const event of events) {
        if (signal.aborted) throw new ChatCancelled();
        yield event;
      }
    },
  };
}
