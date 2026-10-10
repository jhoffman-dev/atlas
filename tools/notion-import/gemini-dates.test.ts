import { describe, expect, it } from 'vitest';
import { fromArrival } from './gemini-dates.ts';

/* Reading a Gemini row's Date as when its notes arrived (issue #44). All names are made up. */

const TRANSCRIPT = ['### 00:00:05', 'Mara Quill: Hi.', '### 00:30:00', 'Tobias Fenn: Bye.'].join(
  '\n',
);

const fields = (date: string, transcript: string | undefined = TRANSCRIPT) => ({
  title: 'Retro',
  date,
  end: '2026-10-06T11:00',
  details: '- Shipped.',
  transcript,
  source: 'gemini',
  sourceId: 'a1',
});

describe('fromArrival', () => {
  it.each([
    ['2026-10-06T10:00', '2026-10-06', '09:30'],
    ['2026-10-06T10:00:00.000Z', '2026-10-06', '09:30'],
    ['2026-10-06 10:00Z', '2026-10-06', '09:30'],
    ['2026-10-06T10:00:00+02:00', '2026-10-06', '09:30'],
    ['2026-10-07T00:05:00.000Z', '2026-10-06', '23:35'],
    ['2026-01-01T00:10Z', '2025-12-31', '23:40'],
  ])('reads %s as local time, less the transcript’s length', (date, day, start) => {
    expect(fromArrival(fields(date))).toMatchObject({ date: day, start, end: null });
  });

  it('opens Notes with why the start is approximate, before what Notes held', () => {
    expect(fromArrival(fields('2026-10-06T10:00Z')).details).toBe(
      "Start time approximate: Gemini's date in Notion is when its notes arrived (10:00), and the start written here is that less the transcript's last time stamp, 00:30:00 (issue #44).\n\n- Shipped.",
    );
  });

  it('starts the meeting when the notes arrived when the transcript has no section stamps', () => {
    const read = fromArrival({ ...fields('2026-10-06T10:00Z', 'Mara Quill: Hi.'), details: '' });

    expect(read).toMatchObject({ date: '2026-10-06', start: '10:00' });
    expect(read.details).toMatch(
      /transcript has no time stamps, so the start written here is that time/,
    );
  });

  it('does not read a wall-clock transcript’s times as its length', () => {
    const read = fromArrival(fields('2026-10-06T10:00Z', '**[09:30:00] You:** Hi.'));

    expect(read).toMatchObject({ start: '10:00' });
  });

  it.each(['2026-10-06', 'someday soon'])('leaves %s for the mapper to read or refuse', (date) => {
    expect(fromArrival(fields(date))).toEqual(fields(date));
  });
});
