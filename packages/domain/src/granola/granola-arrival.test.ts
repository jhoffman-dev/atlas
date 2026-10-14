import { describe, expect, it } from 'vitest';
import { isStaleArrival, STALE_ARRIVAL_MS } from './granola-arrival.ts';

/*
 * A note the pull finds that the webhook should have brought long since
 * (plan §5): the sign that Granola has disabled the webhook endpoint.
 */

const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('isStaleArrival', () => {
  it('is a note last updated more than two hours ago', () => {
    expect(STALE_ARRIVAL_MS).toBe(2 * 60 * 60_000);
    expect(isStaleArrival({ updatedAt: ago(STALE_ARRIVAL_MS + 1), now: NOW })).toBe(true);
    expect(isStaleArrival({ updatedAt: '2026-10-12T12:00:00Z', now: NOW })).toBe(true);
  });

  it('is not a note updated two hours ago or less, which the webhook may still bring', () => {
    expect(isStaleArrival({ updatedAt: ago(STALE_ARRIVAL_MS), now: NOW })).toBe(false);
    expect(isStaleArrival({ updatedAt: ago(60_000), now: NOW })).toBe(false);
  });

  it('is not a note updated after now, by a clock ahead of this Mac’s', () => {
    expect(isStaleArrival({ updatedAt: ago(-60_000), now: NOW })).toBe(false);
  });

  it('is not a note whose time cannot be read: no warning on a guess', () => {
    expect(isStaleArrival({ updatedAt: 'yesterday', now: NOW })).toBe(false);
  });
});
