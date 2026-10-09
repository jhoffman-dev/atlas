/** A Notion Date cell as the mapper reads it (tools/n8n/meeting-when.ts). */
export interface NotionWhen {
  readonly date: string;
  readonly end: string | null;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** The month's index for its name or a short form of it (`Oct`, `Sept`); -1 for any other word. */
const monthIndex = (name: string) =>
  MONTHS.findIndex((month) => name.length >= 3 && month.startsWith(name.toLowerCase()));

/** `October 6, 2026` or `Oct 6, 2026`, then an optional `10:00 AM` or `14:00`, then an optional `(PDT)`. */
const SHOWN =
  /^([a-z]{3,9})\.?\s+(\d{1,2}),\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([ap])?\.?m?\.?)?(?:\s+\(([^)]+)\))?$/i;
/** `10:30 AM` alone: the end of a range on the start's day. */
const CLOCK_ONLY = /^(\d{1,2}):(\d{2})\s*([ap])?\.?m?\.?(?:\s+\(([^)]+)\))?$/i;
/** Zone labels that name UTC itself; any other label is that zone's clock, as written. */
const UTC = /^(utc|gmt|z)$/i;

const two = (value: number) => String(value).padStart(2, '0');

/**
 * `10:00 AM` as `10:00`, `2:30 PM` as `14:30`; null for a 12-hour time past
 * 12 (`13:00 PM`). The mapper checks the rest of what makes a time of day.
 */
function clock(hours: string, minutes: string, half: string | undefined): string | null {
  let hour = Number(hours);
  if (half !== undefined && (hour < 1 || hour > 12)) return null;
  if (half?.toLowerCase() === 'p' && hour < 12) hour += 12;
  if (half?.toLowerCase() === 'a' && hour === 12) hour = 0;
  return `${two(hour)}:${minutes}`;
}

const zoned = (zone: string | undefined) =>
  zone !== undefined && UTC.test(zone.trim()) ? 'Z' : '';

/** One side of the cell as `2026-10-06` or `2026-10-06T10:00`; the text as given when Notion did not write it this way. */
function shownDate(text: string): string {
  const match = SHOWN.exec(text);
  const month = monthIndex(match?.[1] ?? '');
  if (match === null || month < 0) return text;
  const [, , day = '', year = '', hours, minutes = '', half, zone] = match;
  const date = `${year}-${two(month + 1)}-${two(Number(day))}`;
  if (hours === undefined) return date;
  const time = clock(hours, minutes, half);
  return time === null ? text : `${date}T${time}${zoned(zone)}`;
}

function shownEnd(text: string, startDay: string): string {
  const match = CLOCK_ONLY.exec(text);
  if (match === null) return shownDate(text);
  const [, hours = '', minutes = '', half, zone] = match;
  const time = clock(hours, minutes, half);
  return time === null ? text : `${startDay}T${time}${zoned(zone)}`;
}

/**
 * A Notion export's Date cell, written the way Notion shows it
 * (`October 6, 2026 10:00 AM`, a range with `→`, a zone in brackets), as a
 * date and an end the meeting mapper reads. A time with no zone, or with a
 * zone other than UTC, is that clock's time and is kept as written; a UTC
 * time is an instant the mapper puts on the clock of its time zone. Text in
 * any other form (an ISO date-time, or a format Notion was set to that is
 * not read here) is passed on as it is, for the mapper to read or refuse:
 * `10/06/2026` could be either day, so it is never guessed at.
 */
export function notionWhen(cell: string): NotionWhen {
  const [start = '', end] = cell.split('→').map((side) => side.trim());
  const date = shownDate(start);
  const startDay = date.slice(0, 10);
  return { date, end: end === undefined || end === '' ? null : shownEnd(end, startDay) };
}
