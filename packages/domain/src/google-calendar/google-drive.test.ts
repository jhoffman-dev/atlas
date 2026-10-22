import { describe, expect, it } from 'vitest';
import {
  driveRetryDelay,
  GOOGLE_CALENDAR_SCOPES,
  GOOGLE_DRIVE_FILE_SCOPE,
  scopesWithDrive,
} from './index.ts';

describe('scopesWithDrive (#501)', () => {
  it('adds the Drive scope to what was granted, keeping the Calendar’s', () => {
    expect(scopesWithDrive(GOOGLE_CALENDAR_SCOPES)).toEqual([
      ...GOOGLE_CALENDAR_SCOPES,
      GOOGLE_DRIVE_FILE_SCOPE,
    ]);
  });

  it('asks for nothing when Drive is already granted', () => {
    expect(scopesWithDrive([GOOGLE_DRIVE_FILE_SCOPE, ...GOOGLE_CALENDAR_SCOPES])).toBeNull();
  });

  it('asks for only the files this app made, never the whole Drive', () => {
    expect(GOOGLE_DRIVE_FILE_SCOPE).toBe('https://www.googleapis.com/auth/drive.file');
  });
});

describe('driveRetryDelay (#502)', () => {
  it('waits longer each time Google says to slow down or fails on its side, three times', () => {
    for (const status of [429, 500, 503]) {
      expect([1, 2, 3, 4].map((attempt) => driveRetryDelay({ attempt, status }))).toEqual([
        1_000,
        2_000,
        4_000,
        null,
      ]);
    }
  });

  it('never tries again what another try would not change', () => {
    for (const status of [400, 401, 403, 404, 413, null]) {
      expect(driveRetryDelay({ attempt: 1, status })).toBeNull();
    }
  });
});
