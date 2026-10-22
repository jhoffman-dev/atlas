import { describe, expect, it } from 'vitest';
import {
  KINDLE_AUTO_SYNC_MIN_GAP_MS,
  kindleAutoSyncSkip,
  kindleRecordAfterFailure,
  kindleRecordAfterSync,
  NO_KINDLE_SYNC_RECORD,
  type KindleSyncRecord,
} from './kindle-auto-sync.ts';
import { KINDLE_AUTO_SYNC_HOLD_MS } from './kindle-backoff.ts';
import { KINDLE_NOT_CONNECTED_MESSAGE } from './kindle-sync-report.ts';

const NOW = Date.UTC(2026, 9, 22, 9, 0);
const CONNECTED: KindleSyncRecord = { connected: true, lastHoldAt: null, last: null };

describe('kindleAutoSyncSkip', () => {
  it('runs nothing by itself until Kindle is connected', () => {
    expect(kindleAutoSyncSkip(NO_KINDLE_SYNC_RECORD, NOW)).toBe('not_connected');
  });

  it('runs once connected with nothing held and no sync yet', () => {
    expect(kindleAutoSyncSkip(CONNECTED, NOW)).toBeNull();
  });

  it('holds for a day after a robot check or rate limit, then runs', () => {
    const held = { ...CONNECTED, lastHoldAt: NOW - KINDLE_AUTO_SYNC_HOLD_MS + 1 };
    expect(kindleAutoSyncSkip(held, NOW)).toBe('held');
    expect(
      kindleAutoSyncSkip({ ...held, lastHoldAt: NOW - KINDLE_AUTO_SYNC_HOLD_MS }, NOW),
    ).toBeNull();
  });

  it('does not sync again within the hour after one ran, as after a restart', () => {
    const last = { at: NOW - KINDLE_AUTO_SYNC_MIN_GAP_MS + 1, message: 'x', ok: true };
    expect(kindleAutoSyncSkip({ ...CONNECTED, last }, NOW)).toBe('recent');
    const older = { ...last, at: NOW - KINDLE_AUTO_SYNC_MIN_GAP_MS };
    expect(kindleAutoSyncSkip({ ...CONNECTED, last: older }, NOW)).toBeNull();
  });

  it('takes a last sync dated in the future as no reason to wait', () => {
    const last = { at: NOW + 60_000, message: 'x', ok: true };
    expect(kindleAutoSyncSkip({ ...CONNECTED, last }, NOW)).toBeNull();
  });
});

describe('kindleRecordAfterSync', () => {
  it('keeps the words of a sync that went through, and marks Kindle connected', () => {
    const after = kindleRecordAfterSync(
      NO_KINDLE_SYNC_RECORD,
      { kind: 'synced', books: [], added: 0 },
      NOW,
    );
    expect(after).toEqual({
      connected: true,
      lastHoldAt: null,
      last: { at: NOW, message: 'Nothing new from Kindle.', ok: true },
    });
  });

  it('dates a robot check and a rate limit, and leaves the connection as it was', () => {
    const robot = kindleRecordAfterSync(
      CONNECTED,
      { kind: 'robot_check', books: [], added: 0 },
      NOW,
    );
    expect(robot).toMatchObject({ connected: true, lastHoldAt: NOW, last: { ok: false } });
    const limited = kindleRecordAfterSync(
      { ...CONNECTED, lastHoldAt: 5 },
      { kind: 'rate_limited', status: 429, books: [], added: 0 },
      NOW,
    );
    expect(limited.lastHoldAt).toBe(NOW);
  });

  it('keeps an earlier hold through a sign-in, and forgets the session the host says is gone', () => {
    const signIn = kindleRecordAfterSync(
      { ...CONNECTED, lastHoldAt: 5 },
      { kind: 'sign_in_required', books: [], added: 0 },
      NOW,
    );
    expect(signIn).toMatchObject({ connected: true, lastHoldAt: 5 });
    const gone = kindleRecordAfterSync(
      CONNECTED,
      { kind: 'not_connected', books: [], added: 0 },
      NOW,
    );
    expect(gone).toMatchObject({
      connected: false,
      last: { message: KINDLE_NOT_CONNECTED_MESSAGE },
    });
  });
});

describe('kindleRecordAfterFailure', () => {
  it('says the sync failed, in its own words', () => {
    expect(kindleRecordAfterFailure(CONNECTED, 'the host stopped', NOW)).toEqual({
      ...CONNECTED,
      last: { at: NOW, message: 'Kindle sync failed: the host stopped', ok: false },
    });
  });
});
