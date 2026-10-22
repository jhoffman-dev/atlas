import { describe, expect, it } from 'vitest';
import {
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
});
