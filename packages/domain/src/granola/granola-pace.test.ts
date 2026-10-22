import { describe, expect, it } from 'vitest';
import { backoff, paceOf, RETRIES } from './granola-pace.ts';

/*
 * How fast a pull may ask Granola, and how long it waits after a 429
 * (plan §5). Granola allows bursts of 25 in 5 s and 5 a second sustained;
 * DFAI keeps to 4 a second. The clock is passed in.
 */

describe('backoff', () => {
  it('waits 1, 2, 4, 8 and 16 seconds before the five retries', () => {
    expect([1, 2, 3, 4, 5].map(backoff)).toEqual([1000, 2000, 4000, 8000, 16000]);
    expect(RETRIES).toBe(5);
  });

  it('gives up after the fifth retry, so the note counts as failed', () => {
    expect(backoff(6)).toBeNull();
    expect(backoff(1000)).toBeNull();
  });

  it('never waits longer than 16 seconds, for any attempt', () => {
    const waits = Array.from({ length: 64 }, (_, at) => backoff(at - 2));
    expect(Math.max(...waits.map((each) => each ?? 0))).toBe(16000);
  });

  it('waits the first delay for an attempt before the first, or one that is not a number', () => {
    expect(backoff(0)).toBe(1000);
    expect(backoff(-3)).toBe(1000);
    expect(backoff(Number.NaN)).toBe(1000);
    expect(backoff(2.7)).toBe(2000);
  });
});

const NOW = 1_000_000;

describe('paceOf', () => {
  it('sends at once while fewer than four requests went in the last second', () => {
    expect(paceOf({ sentAt: [], now: NOW })).toBe(0);
    expect(paceOf({ sentAt: [NOW - 900, NOW - 500, NOW - 10], now: NOW })).toBe(0);
  });

  it('waits until the oldest of the last four is a second old', () => {
    expect(paceOf({ sentAt: [NOW - 900, NOW - 600, NOW - 300, NOW - 100], now: NOW })).toBe(100);
  });

  it('counts only the last second: a request a second ago or more is spent', () => {
    expect(
      paceOf({ sentAt: [NOW - 5000, NOW - 1000, NOW - 600, NOW - 300, NOW - 100], now: NOW }),
    ).toBe(0);
  });

  it('reads the times in any order', () => {
    expect(paceOf({ sentAt: [NOW - 100, NOW - 900, NOW - 300, NOW - 600], now: NOW })).toBe(100);
  });

  it('waits on the fourth newest when more than four went in the last second', () => {
    const sentAt = [NOW - 950, NOW - 800, NOW - 400, NOW - 300, NOW - 200, NOW - 100];
    expect(paceOf({ sentAt, now: NOW })).toBe(600);
  });

  it('never waits longer than a second, even when the clock moved back', () => {
    const sentAt = [NOW + 5000, NOW + 5000, NOW + 5000, NOW + 5000];
    expect(paceOf({ sentAt, now: NOW })).toBe(1000);
  });
});
