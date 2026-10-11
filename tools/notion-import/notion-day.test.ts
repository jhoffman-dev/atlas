import { describe, expect, it } from 'vitest';
import { readDay } from './notion-day.ts';

const LA = 'America/Los_Angeles';

describe('the day a Notion date cell is on', () => {
  it('is the day Notion wrote, a time on any clock but UTC kept as written', () => {
    expect(readDay('October 20, 2026', LA)).toEqual({
      kind: 'day',
      day: '2026-10-20',
      end: null,
      endText: null,
    });
    expect(readDay('October 20, 2026 11:30 PM (PDT)', LA)).toMatchObject({ day: '2026-10-20' });
  });

  it("is a UTC time's day on the run's clock, and is not read with no clock to read it on", () => {
    expect(readDay('October 21, 2026 2:00 AM (UTC)', LA)).toMatchObject({ day: '2026-10-20' });
    expect(readDay('October 21, 2026 2:00 AM (UTC)', null)).toMatchObject({ kind: 'unread' });
  });

  it("keeps a range's end, and what Notion wrote for an end it cannot read", () => {
    expect(readDay('October 20, 2026 → October 24, 2026', LA)).toEqual({
      kind: 'day',
      day: '2026-10-20',
      end: '2026-10-24',
      endText: 'October 24, 2026',
    });
    expect(readDay('October 20, 2026 → soon', LA)).toEqual({
      kind: 'day',
      day: '2026-10-20',
      end: null,
      endText: 'soon',
    });
  });

  it('says why when the cell is not a day', () => {
    expect(readDay('10/20/2026', LA)).toEqual({
      kind: 'unread',
      why: 'cannot read "10/20/2026" as a date or a time',
    });
    expect(readDay('10:30 AM', LA)).toEqual({ kind: 'unread', why: 'it has a time and no day' });
  });
});
