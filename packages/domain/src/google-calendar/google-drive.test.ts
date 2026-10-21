import { describe, expect, it } from 'vitest';
import { GOOGLE_CALENDAR_SCOPES, GOOGLE_DRIVE_FILE_SCOPE, scopesWithDrive } from './index.ts';

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
