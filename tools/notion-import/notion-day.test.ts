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

  it('reads a date written year first always, and month or day first only in the order given', () => {
    expect(readDay('2026/06/14', LA)).toMatchObject({ kind: 'day', day: '2026-06-14' });
    expect(readDay('06/14/2026', LA, 'mdy')).toMatchObject({ kind: 'day', day: '2026-06-14' });
    expect(readDay('14/06/2026', LA, 'dmy')).toMatchObject({ kind: 'day', day: '2026-06-14' });
    expect(readDay('06/14/2026 10:00 AM (PDT) → 11:00 AM', LA, 'mdy')).toEqual({
      kind: 'day',
      day: '2026-06-14',
      end: '2026-06-14',
      endText: '11:00 AM',
    });
    expect(readDay('13/01/2026', LA, 'mdy')).toEqual({
      kind: 'unread',
      why: 'cannot read "13/01/2026" as a date or a time',
    });
  });
});
