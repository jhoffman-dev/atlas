import { describe, expect, it } from 'vitest';
import type { GranolaFailure } from '@dfai/domain';
import { pacedRequests } from './granola-requests.ts';
import { GranolaError } from './ports.ts';

/** A clock that only the waits move, and the waits it was asked for. */
function testTime() {
  const time = { now: 1_000_000, waits: [] as number[] };
  return {
    time,
    clock: { now: () => time.now },
    wait: async (milliseconds: number) => {
      time.waits.push(milliseconds);
      time.now += milliseconds;
    },
  };
}

const failing = (failure: GranolaFailure) => () => Promise.reject(new GranolaError(failure));
const slowDown: GranolaFailure = { kind: 'api_refused', status: 429, message: '429' };

describe('pacedRequests', () => {
  it('sends four requests in a second without waiting, and waits out the second before the fifth', async () => {
    const { time, clock, wait } = testTime();
    const send = pacedRequests({ clock, wait });
    for (let each = 0; each < 5; each += 1) await send(async () => each);
    expect(time.waits).toEqual([1_000]);
  });

  it('asks again after a 429, waiting 1 then 2 seconds', async () => {
    const { time, clock, wait } = testTime();
    const send = pacedRequests({ clock, wait });
    const answers = [failing(slowDown), failing(slowDown), async () => 'answered'];
    let asked = 0;

    await expect(send(() => answers[asked++]!())).resolves.toBe('answered');

    expect(asked).toBe(3);
    expect(time.waits).toEqual([1_000, 2_000]);
  });

  it('gives up on the sixth 429, after five retries, with the 429', async () => {
    const { time, clock, wait } = testTime();
    const send = pacedRequests({ clock, wait });
    let asked = 0;

    const sent = send(() => {
      asked += 1;
      return failing(slowDown)();
    });

    await expect(sent).rejects.toMatchObject({ failure: { status: 429 } });
    expect(asked).toBe(6);
    expect(time.waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000]);
  });

  it('passes any other failure on at once', async () => {
    const { time, clock, wait } = testTime();
    const send = pacedRequests({ clock, wait });
    let asked = 0;
    const sent = send(() => {
      asked += 1;
      return failing({ kind: 'api_refused', status: 503, message: '503' })();
    });
    await expect(sent).rejects.toMatchObject({ failure: { status: 503 } });
    await expect(send(() => Promise.reject(new Error('not Granola')))).rejects.toThrow(
      'not Granola',
    );
    expect(asked).toBe(1);
    expect(time.waits).toEqual([]);
  });
});
