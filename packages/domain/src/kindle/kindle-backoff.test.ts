import { describe, expect, it } from 'vitest';
import {
  holdsKindleAutoSync,
  KINDLE_ROBOT_CHECK_BACKOFF_MS,
  kindleAutoSyncHeldUntil,
  mayAutoSyncKindle,
} from './kindle-backoff.ts';

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 21, 9, 0);

describe('the back-off after a robot check', () => {
  it('is 24 hours', () => {
    expect(KINDLE_ROBOT_CHECK_BACKOFF_MS).toBe(24 * HOUR);
  });

  it('holds automatic syncs for 24 hours from the robot check', () => {
    expect(kindleAutoSyncHeldUntil(NOW)).toBe(NOW + 24 * HOUR);
    expect(kindleAutoSyncHeldUntil(null)).toBeNull();
  });

  it('lets an automatic sync run when there has been no robot check', () => {
    expect(mayAutoSyncKindle({ now: NOW, lastRobotCheckAt: null })).toBe(true);
  });

  it('refuses one until 24 hours have passed, and allows it from the moment they have', () => {
    expect(mayAutoSyncKindle({ now: NOW + 1, lastRobotCheckAt: NOW })).toBe(false);
    expect(mayAutoSyncKindle({ now: NOW + 24 * HOUR - 1, lastRobotCheckAt: NOW })).toBe(false);
    expect(mayAutoSyncKindle({ now: NOW + 24 * HOUR, lastRobotCheckAt: NOW })).toBe(true);
  });

  it('does not hold a sync for a robot check the clock says is in the future', () => {
    // A clock set back is not a reason to stop syncing for ever.
    expect(mayAutoSyncKindle({ now: NOW, lastRobotCheckAt: NOW + 3 * 24 * HOUR })).toBe(true);
  });

  it('does not hold automatic syncs for ever when the stored robot-check time is not a number', () => {
    // A time read back badly from storage (Number(undefined)) is no reason to stop for good.
    expect(
      mayAutoSyncKindle({ now: Date.UTC(2026, 9, 21, 9, 0), lastRobotCheckAt: Number.NaN }),
    ).toBe(true);
    for (const stored of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(mayAutoSyncKindle({ now: NOW, lastRobotCheckAt: stored }), String(stored)).toBe(true);
    }
  });

  it('holds nothing until a time that is not a number', () => {
    expect(kindleAutoSyncHeldUntil(Number.NaN)).toBeNull();
    expect(kindleAutoSyncHeldUntil(Number.NEGATIVE_INFINITY)).toBeNull();
  });
});

describe('which syncs start the back-off', () => {
  it('is one stopped by a robot check or by Amazon saying it is asked too often', () => {
    expect(holdsKindleAutoSync({ kind: 'robot_check' })).toBe(true);
    expect(holdsKindleAutoSync({ kind: 'rate_limited' })).toBe(true);
  });

  it('is no other: a sign-in, Amazon unreachable, or a sync that ran', () => {
    for (const kind of ['sign_in_required', 'unavailable', 'unrecognised', 'synced'] as const) {
      expect(holdsKindleAutoSync({ kind }), kind).toBe(false);
    }
  });
});
