import { describe, expect, it } from 'vitest';
import { rfc3339Instant } from './meeting-instant.ts';

/*
 * The instant both writers of a note must agree on, read without asking the
 * engine. `Date.UTC` here is only the oracle for canonical values, which the
 * ECMAScript spec fixes for every engine.
 */

describe('rfc3339Instant', () => {
  it('reads every day of a leap year and of a common year at its own offset', () => {
    for (const year of [2026, 2028]) {
      for (let day = 0; day < 366; day += 1) {
        const date = new Date(Date.UTC(year, 0, 1 + day, 13, 7, 9, 250));
        if (date.getUTCFullYear() !== year) continue;
        const text = date.toISOString().replace('.250Z', '.25-08:00');
        expect(rfc3339Instant(text)).toBe(date.getTime() + 8 * 60 * 60_000);
      }
    }
  });

  it('takes T and Z in either case', () => {
    expect(rfc3339Instant('2026-10-06t17:00:00z')).toBe(Date.UTC(2026, 9, 6, 17));
  });

  it('reads a year under 100 as itself, not as 19xx', () => {
    const fifty = new Date(0);
    fifty.setUTCFullYear(50, 0, 1);
    expect(rfc3339Instant('0050-01-01T00:00:00Z')).toBe(fifty.getTime());
  });

  it('cuts a fraction to the millisecond rather than rounding it', () => {
    expect(rfc3339Instant('2026-10-06T17:00:00.9999Z')).toBe(Date.UTC(2026, 9, 6, 17, 0, 0, 999));
    expect(rfc3339Instant('2026-10-06T17:00:00.5Z')).toBe(Date.UTC(2026, 9, 6, 17, 0, 0, 500));
  });

  it.each([
    ['30 February', '2026-02-30T00:00:00Z'],
    ['29 February in a common year', '2026-02-29T00:00:00Z'],
    ['29 February in 1900', '1900-02-29T00:00:00Z'],
    ['31 June', '2026-06-31T00:00:00Z'],
    ['day 0', '2026-10-00T00:00:00Z'],
    ['month 0', '2026-00-06T00:00:00Z'],
    ['month 13', '2026-13-06T00:00:00Z'],
    ['hour 24', '2026-10-06T24:00:00Z'],
    ['minute 60', '2026-10-06T17:60:00Z'],
    ['a leap second', '2026-12-31T23:59:60Z'],
    ['an offset hour of 24', '2026-10-06T17:00:00+24:00'],
    ['an offset minute of 60', '2026-10-06T17:00:00+05:60'],
    ['no offset', '2026-10-06T17:00:00'],
    ['no seconds', '2026-10-06T17:00Z'],
    ['a space for the T', '2026-10-06 17:00:00Z'],
    ['an offset with no colon', '2026-10-06T17:00:00+0530'],
    ['a dot with no fraction', '2026-10-06T17:00:00.Z'],
    ['words', 'yesterday'],
  ])('is null for %s', (_, text) => {
    expect(rfc3339Instant(text)).toBeNull();
  });

  it('accepts the last day of each month and refuses the day after', () => {
    const last = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    last.forEach((days, at) => {
      const month = String(at + 1).padStart(2, '0');
      expect(rfc3339Instant(`2026-${month}-${days}T00:00:00Z`)).toBe(Date.UTC(2026, at, days));
      expect(rfc3339Instant(`2026-${month}-${days + 1}T00:00:00Z`)).toBeNull();
    });
  });
});
