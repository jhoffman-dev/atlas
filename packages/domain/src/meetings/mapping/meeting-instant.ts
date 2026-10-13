/*
 * An RFC 3339 instant read by our own rules rather than `Date.parse`, whose
 * reading of anything past the ECMAScript date format is the engine's: the
 * app's webview (JavaScriptCore) and n8n (V8) answer differently for a
 * lowercase `t`/`z`, a 60th second, or 30 February. Two writers of one note
 * must write the same bytes, so neither engine is asked.
 */

/** `date-time` of RFC 3339 §5.6; `T` and `Z` in either case, as §5.6 allows. */
const RFC_3339 =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/;

const DAY_MS = 24 * 60 * 60_000;

const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** How many days the month has in the year: 28 to 31, 29 for February in a leap year. */
function daysIn(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Days from 1970-01-01 to a day of the proleptic Gregorian calendar, by
 * arithmetic alone (H. Hinnant's days_from_civil): `Date.UTC` would read a
 * year under 100 as 19xx.
 */
function daysFromEpoch(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

/**
 * Milliseconds since the epoch for an RFC 3339 instant, or null when the
 * text is not one. Every field is held to its range: a month of 01–12, a day
 * the month has in that year (29 February only in a leap year), hours 00–23,
 * minutes 00–59, an offset of at most 23:59. Seconds are 00–59: a leap second
 * (`:60`, which §5.6 allows) is refused rather than clamped, since JavaScript
 * time has no leap seconds and Granola sends none. A fraction is cut, never
 * rounded, to the millisecond. An instant with no offset is not one.
 */
export function rfc3339Instant(text: string): number | null {
  const match = RFC_3339.exec(text);
  if (match === null) return null;
  const at = (group: number) => Number(match[group] ?? '0');
  const [year, month, day, hour, minute, second] = [at(1), at(2), at(3), at(4), at(5), at(6)];
  const [offsetHours, offsetMinutes] = [at(9), at(10)];
  if (month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (offsetHours > 23 || offsetMinutes > 59) return null;
  const millis = Number((match[7] ?? '').padEnd(3, '0').slice(0, 3));
  const timeOfDay = ((hour * 60 + minute) * 60 + second) * 1000;
  const east = (match[8] === '-' ? -1 : 1) * (offsetHours * 60 + offsetMinutes);
  return daysFromEpoch(year, month, day) * DAY_MS + timeOfDay + millis - east * 60_000;
}
