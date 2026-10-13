import { describe, expect, it } from 'vitest';
import { nextWatermark, sinceOf, type GranolaNoteResult } from './granola-watermark.ts';

/*
 * Where a pull of Granola starts listing, and where the next one will
 * (plan §4.3, as amended by the ADR review): rules about times, not timers.
 */

describe('sinceOf', () => {
  it('lists from a day before the watermark at startup, so nothing on the edge is missed', () => {
    expect(sinceOf({ watermark: '2026-10-12T09:00:00Z', mode: 'startup' })).toBe(
      '2026-10-11T09:00:00.000Z',
    );
  });

  it('lists from a day before the watermark on the 15-minute timer too', () => {
    expect(sinceOf({ watermark: '2026-10-12T09:00:00+02:00', mode: 'periodic' })).toBe(
      '2026-10-11T07:00:00.000Z',
    );
  });

  it('keeps an old watermark: listing back to it costs list calls only', () => {
    expect(sinceOf({ watermark: '2026-01-02T00:00:00Z', mode: 'startup' })).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('lists every note on the first pull ever', () => {
    expect(sinceOf({ watermark: null, mode: 'startup' })).toBeNull();
    expect(sinceOf({ watermark: null, mode: 'periodic' })).toBeNull();
  });

  it('lists every note on Sync now, whatever the watermark says', () => {
    expect(sinceOf({ watermark: '2026-10-12T09:00:00Z', mode: 'sync-now' })).toBeNull();
  });

  it('lists every note when the watermark cannot be read', () => {
    expect(sinceOf({ watermark: 'yesterday', mode: 'startup' })).toBeNull();
  });
});

const result = (outcome: GranolaNoteResult['outcome'], updatedAt: string): GranolaNoteResult => ({
  outcome,
  updatedAt,
});

describe('nextWatermark', () => {
  it('moves to the newest note written or already held', () => {
    const results = [
      result('written', '2026-10-12T09:00:00Z'),
      result('held', '2026-10-12T11:00:00Z'),
      result('written', '2026-10-12T10:00:00Z'),
    ];
    expect(nextWatermark({ watermark: '2026-10-10T00:00:00Z', results })).toBe(
      '2026-10-12T11:00:00.000Z',
    );
  });

  it('holds at the oldest note that failed in transport, so the next pull lists it again', () => {
    const results = [
      result('written', '2026-10-12T11:00:00Z'),
      result('failed', '2026-10-12T10:00:00Z'),
      result('failed', '2026-10-12T09:30:00Z'),
      result('written', '2026-10-12T09:00:00Z'),
    ];
    expect(nextWatermark({ watermark: '2026-10-10T00:00:00Z', results })).toBe(
      '2026-10-12T09:30:00.000Z',
    );
  });

  it('goes back to a failed note older than the watermark, which the overlap listed', () => {
    const results = [result('failed', '2026-10-11T20:00:00Z')];
    expect(nextWatermark({ watermark: '2026-10-12T09:00:00Z', results })).toBe(
      '2026-10-11T20:00:00.000Z',
    );
  });

  it('is not held back by a note the mapper refused, which only a mapper fix would change', () => {
    const results = [
      result('refused', '2026-10-12T08:00:00Z'),
      result('written', '2026-10-12T09:00:00Z'),
    ];
    expect(nextWatermark({ watermark: null, results })).toBe('2026-10-12T09:00:00.000Z');
  });

  it('moves past a refused note that is the newest, so it is not fetched on every pull', () => {
    const results = [
      result('written', '2026-10-12T09:00:00Z'),
      result('refused', '2026-10-12T10:00:00Z'),
    ];
    expect(nextWatermark({ watermark: null, results })).toBe('2026-10-12T10:00:00.000Z');
  });

  it('is not held back by a note Granola no longer has (404), and moves past it', () => {
    const results = [
      result('gone', '2026-10-12T08:00:00Z'),
      result('written', '2026-10-12T09:00:00Z'),
      result('gone', '2026-10-12T10:00:00Z'),
    ];
    expect(nextWatermark({ watermark: null, results })).toBe('2026-10-12T10:00:00.000Z');
  });

  it('stays where it is when nothing was listed', () => {
    expect(nextWatermark({ watermark: '2026-10-12T09:00:00Z', results: [] })).toBe(
      '2026-10-12T09:00:00.000Z',
    );
    expect(nextWatermark({ watermark: null, results: [] })).toBeNull();
  });

  it('never moves backwards for older notes that were settled', () => {
    const results = [result('written', '2026-10-11T09:00:00Z')];
    expect(nextWatermark({ watermark: '2026-10-12T09:00:00Z', results })).toBe(
      '2026-10-12T09:00:00.000Z',
    );
  });

  it('starts at the failed note when there was no watermark and nothing else settled', () => {
    const results = [result('failed', '2026-10-12T09:00:00Z')];
    expect(nextWatermark({ watermark: null, results })).toBe('2026-10-12T09:00:00.000Z');
  });

  it('compares instants, not text, across offsets', () => {
    const results = [
      result('written', '2026-10-12T10:00:00+02:00'),
      result('written', '2026-10-12T09:00:00Z'),
    ];
    expect(nextWatermark({ watermark: null, results })).toBe('2026-10-12T09:00:00.000Z');
  });

  it('ignores a settled note whose time it cannot read', () => {
    const results = [result('written', 'soon'), result('written', '2026-10-12T09:00:00Z')];
    expect(nextWatermark({ watermark: null, results })).toBe('2026-10-12T09:00:00.000Z');
  });

  it('does not move at all when a failed note’s time cannot be read, rather than skip it', () => {
    const results = [result('written', '2026-10-12T11:00:00Z'), result('failed', 'soon')];
    expect(nextWatermark({ watermark: '2026-10-12T09:00:00Z', results })).toBe(
      '2026-10-12T09:00:00.000Z',
    );
    expect(nextWatermark({ watermark: null, results })).toBeNull();
  });

  it('treats a watermark it cannot read as none', () => {
    const results = [result('written', '2026-10-12T09:00:00Z')];
    expect(nextWatermark({ watermark: 'yesterday', results })).toBe('2026-10-12T09:00:00.000Z');
  });
});
