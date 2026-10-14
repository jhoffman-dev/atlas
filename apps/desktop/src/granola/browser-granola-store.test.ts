// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserGranolaPullRecords } from './browser-granola-store.ts';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const VAULT = '/Users/mara/Vault';
const OTHER = '/Users/mara/Other';
const RECORD = { watermark: '2026-10-13T17:00:00.000Z', lastPullAt: 1_760_000_000_000 };

describe('browserGranolaPullRecords', () => {
  it('keeps each vault’s record on this Mac, across a reload', () => {
    expect(browserGranolaPullRecords.read(VAULT)).toEqual({ watermark: null, lastPullAt: null });
    browserGranolaPullRecords.write(VAULT, RECORD);

    // What a reload reads is what storage holds, not anything kept in memory.
    const kept = window.localStorage.getItem(`atlas.granola-pull:${VAULT}`);
    expect(JSON.parse(kept ?? 'null')).toEqual(RECORD);
    expect(browserGranolaPullRecords.read(VAULT)).toEqual(RECORD);
    expect(browserGranolaPullRecords.read(OTHER)).toEqual({ watermark: null, lastPullAt: null });
  });

  it('reads a record it cannot make sense of as none', () => {
    window.localStorage.setItem(`atlas.granola-pull:${VAULT}`, 'not json');
    expect(browserGranolaPullRecords.read(VAULT)).toEqual({ watermark: null, lastPullAt: null });
    window.localStorage.setItem(
      `atlas.granola-pull:${VAULT}`,
      JSON.stringify({ watermark: 7, lastPullAt: 'yesterday' }),
    );
    expect(browserGranolaPullRecords.read(VAULT)).toEqual({ watermark: null, lastPullAt: null });
  });

  it('reads none, and writes nothing, when storage is out of reach', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(browserGranolaPullRecords.read(VAULT)).toEqual({ watermark: null, lastPullAt: null });
    expect(() => browserGranolaPullRecords.write(VAULT, RECORD)).not.toThrow();
  });
});
