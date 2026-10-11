/** A Notion Date cell as the mapper reads it (packages/domain/src/meetings/mapping/meeting-when.ts). */
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

/** `October 6, 2026` or `Oct 6, 2026`, then an optional `10:00 AM` or `14:00`. */
const SHOWN =
  /^([a-z]{3,9})\.?\s+(\d{1,2}),\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([ap])?\.?m?\.?)?$/i;
/** `10:30 AM` alone: the end of a range on the start's day. */
const CLOCK_ONLY = /^(\d{1,2}):(\d{2})\s*([ap])?\.?m?\.?$/i;
/** A zone in brackets after a side of the cell: `(PDT)`, `(UTC)`. */
const ZONE_LABEL = /\s+\(([^)]+)\)$/;
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

/** One side of the cell as `2026-10-06` or `2026-10-06T10:00`; null when Notion did not write it this way. */
function shownDate(text: string): string | null {
  const match = SHOWN.exec(text);
  const month = monthIndex(match?.[1] ?? '');
  if (match === null || month < 0) return null;
  const [, , day = '', year = '', hours, minutes = '', half] = match;
  const date = `${year}-${two(month + 1)}-${two(Number(day))}`;
  if (hours === undefined) return date;
  const time = clock(hours, minutes, half);
  return time === null ? null : `${date}T${time}`;
}

/** The end side: a time alone is on the start's day. */
function shownEnd(text: string, startDay: string): string | null {
  const match = CLOCK_ONLY.exec(text);
  if (match === null) return shownDate(text);
  const [, hours = '', minutes = '', half] = match;
  const time = clock(hours, minutes, half);
  return time === null ? null : `${startDay}T${time}`;
}

/** A side of the cell without its zone label, and the label. */
function unzoned(side: string): { text: string; zone: string | null } {
  const label = ZONE_LABEL.exec(side);
  if (label === null) return { text: side, zone: null };
  return { text: side.slice(0, label.index), zone: label[1]?.trim() ?? null };
}

/** The value with `Z` added when the zone is UTC and the value has a time. */
const onClock = (value: string, zone: string | null) =>
  zone !== null && UTC.test(zone) && value.includes('T') ? `${value}Z` : value;

/**
 * A Notion export's Date cell, written the way Notion shows it
 * (`October 6, 2026 10:00 AM`, a range with `→`, a zone in brackets), as a
 * date and an end the meeting mapper reads. A time with no zone, or with a
 * zone other than UTC, is that clock's time and is kept as written; a UTC
 * time is an instant the mapper puts on the clock of its time zone. A range
 * is on one clock: a zone written on either side is both sides' zone. Text
 * in any other form (an ISO date-time, or a format Notion was set to that is
 * not read here) is passed on as it is, for the mapper to read or refuse:
 * `10/06/2026` could be either day, so it is never guessed at.
 */
export function notionWhen(cell: string): NotionWhen {
  const [rawStart = '', rawEnd] = cell.split('→').map((side) => side.trim());
  const start = unzoned(rawStart);
  const end = rawEnd === undefined || rawEnd === '' ? null : unzoned(rawEnd);
  const zone = start.zone ?? end?.zone ?? null;
  const date = shownDate(start.text);
  if (date === null) return { date: rawStart, end: end === null ? null : (rawEnd ?? null) };
  const endValue = end === null ? null : shownEnd(end.text, date.slice(0, 10));
  return {
    date: onClock(date, zone),
    end: end === null ? null : endValue === null ? (rawEnd ?? null) : onClock(endValue, zone),
  };
}
