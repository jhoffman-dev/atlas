const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const DATE_PART = /^(\d{4})-(\d{2})-(\d{2})/;
const TIME_PART = /^[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * A date property as it is read: `2026-09-22` is "Tue, Sep 22, 2026", and
 * `2026-09-22T14:30` is "Tue, Sep 22, 2026, 14:30".
 *
 * Calendar arithmetic on the date alone, in UTC, so the answer never depends
 * on the machine's zone or locale. A time is shown as written, with its zone
 * when it names one: the domain has no zone to convert it into. Anything that
 * is not a real calendar date — `2026-02-30`, free text — is `null`, and the
 * caller shows it as written.
 */
export function formatPropertyDate(value: string): string | null {
  const trimmed = value.trim();
  const match = DATE_PART.exec(trimmed);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // setUTCFullYear, not Date.UTC: Date.UTC reads the years 0–99 as 1900–1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const read = `${WEEKDAYS[date.getUTCDay()]}, ${MONTHS[month - 1]} ${day}, ${year}`;
  const time = timeOf(trimmed.slice(match[0].length));
  return time === null ? read : `${read}, ${time}`;
}

/** The time after a date, as "14:30" or "14:30 UTC"; null when there is none. */
function timeOf(rest: string): string | null {
  const match = TIME_PART.exec(rest);
  const clock = match?.[1];
  if (clock === undefined) return null;
  const zone = match?.[2];
  if (zone === undefined) return clock;
  return `${clock} ${zone === 'Z' ? 'UTC' : zone}`;
}

/**
 * A date property with its day changed to `date` and whatever follows the day
 * — a time, a zone — kept, so picking a new day never drops the time. A
 * cleared day clears the whole value.
 */
export function withDatePart(value: string, date: string): string {
  if (date === '') return '';
  const trimmed = value.trim();
  const match = DATE_PART.exec(trimmed);
  return match === null ? date : date + trimmed.slice(match[0].length);
}
