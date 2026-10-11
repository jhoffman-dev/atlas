import { describe, expect, it } from 'vitest';
import { MEETING_INBOX } from '../meeting-arrival.ts';
import { MEETINGS_FOLDER } from './meeting-file-name.ts';

describe('where a mapped meeting goes', () => {
  // The mapper cannot import the import's constant (it runs alone in n8n), so the two are held equal here.
  it('is the folder the import settles arrivals in', () => {
    expect(MEETINGS_FOLDER).toBe(MEETING_INBOX);
  });
});
