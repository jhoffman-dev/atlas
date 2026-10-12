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

/** How a date written with slashes and the year last (`06/14/2026`) is read: month first, or day first. */
export const DATE_ORDERS = ['mdy', 'dmy'] as const;

export type DateOrder = (typeof DATE_ORDERS)[number];

/** An optional `10:00 AM` or `14:00` after a date. */
const AT_TIME = String.raw`(?:\s+(\d{1,2}):(\d{2})\s*([ap])?\.?m?\.?)?`;
/** `October 6, 2026` or `Oct 6, 2026`, then an optional time. */
const SHOWN = new RegExp(String.raw`^([a-z]{3,9})\.?\s+(\d{1,2}),\s+(\d{4})${AT_TIME}$`, 'i');
/** `2026/10/06`, then an optional time: the year first, so it can only be year, month, day. */
const YEAR_FIRST = new RegExp(String.raw`^(\d{4})/(\d{1,2})/(\d{1,2})${AT_TIME}$`, 'i');
/** `10/06/2026`, then an optional time: month first or day first, which only the date order says. */
const YEAR_LAST = new RegExp(String.raw`^(\d{1,2})/(\d{1,2})/(\d{4})${AT_TIME}$`, 'i');
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

/** A side of the cell's year, month and day as numbers, and its time as written. */
interface WrittenDate {
  readonly year: string;
  readonly month: number;
  readonly day: number;
  readonly hours: string | undefined;
  readonly minutes: string;
  readonly half: string | undefined;
}

/** `October 6, 2026`: a month that is no month's name is month 0, which no date has. */
function monthNamed(text: string): WrittenDate | null {
  const match = SHOWN.exec(text);
  if (match === null) return null;
  const [, name = '', day = '', year = '', hours, minutes = '', half] = match;
  return { year, month: monthIndex(name) + 1, day: Number(day), hours, minutes, half };
}

function yearFirst(text: string): WrittenDate | null {
  const match = YEAR_FIRST.exec(text);
  if (match === null) return null;
  const [, year = '', month = '', day = '', hours, minutes = '', half] = match;
  return { year, month: Number(month), day: Number(day), hours, minutes, half };
}

/** `10/06/2026` in the order given; with none, it is not read: it could be either day. */
function yearLast(text: string, order: DateOrder | null): WrittenDate | null {
  const match = order === null ? null : YEAR_LAST.exec(text);
  if (match === null) return null;
  const [, first = '', second = '', year = '', hours, minutes = '', half] = match;
  const [month, day] = order === 'mdy' ? [first, second] : [second, first];
  return { year, month: Number(month), day: Number(day), hours, minutes, half };
}

/**
 * One side of the cell as `2026-10-06` or `2026-10-06T10:00`; null when
 * Notion did not write it in a form read here, or wrote no month 1 to 12 or
 * day 1 to 31 in it. The mapper checks the rest of what makes a day.
 */
function shownDate(text: string, order: DateOrder | null): string | null {
  const written = monthNamed(text) ?? yearFirst(text) ?? yearLast(text, order);
  if (written === null) return null;
  const { year, month, day, hours, minutes, half } = written;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = `${year}-${two(month)}-${two(day)}`;
  if (hours === undefined) return date;
  const time = clock(hours, minutes, half);
  return time === null ? null : `${date}T${time}`;
}

/** The end side: a time alone is on the start's day. */
function shownEnd(text: string, startDay: string, order: DateOrder | null): string | null {
  const match = CLOCK_ONLY.exec(text);
  if (match === null) return shownDate(text, order);
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
 * is on one clock: a zone written on either side is both sides' zone. A
 * date Notion was set to write with slashes is read too: `2026/10/06`
 * always, and `10/06/2026` only in the `order` given, since it could be
 * either day and is never guessed at. Text in any other form (an ISO
 * date-time, or a format that is not read here) is passed on as it is, for
 * the mapper to read or refuse.
 */
export function notionWhen(cell: string, order: DateOrder | null = null): NotionWhen {
  const [rawStart = '', rawEnd] = cell.split('→').map((side) => side.trim());
  const start = unzoned(rawStart);
  const end = rawEnd === undefined || rawEnd === '' ? null : unzoned(rawEnd);
  const zone = start.zone ?? end?.zone ?? null;
  const date = shownDate(start.text, order);
  if (date === null) return { date: rawStart, end: end === null ? null : (rawEnd ?? null) };
  const endValue = end === null ? null : shownEnd(end.text, date.slice(0, 10), order);
  return {
    date: onClock(date, zone),
    end: end === null ? null : endValue === null ? (rawEnd ?? null) : onClock(endValue, zone),
  };
}

/** Whether the cell's date is written `10/06/2026`, which only a date order can read. */
export const writtenYearLast = (cell: string): boolean =>
  YEAR_LAST.test(unzoned(cell.split('→')[0]?.trim() ?? '').text);

/** The sides of a range, each without its zone label. */
const sidesOf = (cell: string): string[] =>
  cell.split('→').map((side) => unzoned(side.trim()).text);

/** The two numbers a side written `10/06/2026` starts with; null for a side written any other way. */
function yearLastParts(side: string): [number, number] | null {
  const match = YEAR_LAST.exec(side);
  return match === null ? null : [Number(match[1]), Number(match[2])];
}

/** The other way round: the order a date written in `order` would instead have been written in. */
export const otherOrder = (order: DateOrder): DateOrder => (order === 'mdy' ? 'dmy' : 'mdy');

/** Whether a side of the cell is written `10/06/2026` with both numbers a month, so either order reads it. */
export const writtenAmbiguously = (cell: string): boolean =>
  sidesOf(cell).some((side) => {
    const parts = yearLastParts(side);
    return parts !== null && parts[0] <= 12 && parts[1] <= 12;
  });

/** Whether a side of the cell can be read only in the order other than `order`: its month, in `order`, is above 12. */
export const provesOtherOrder = (cell: string, order: DateOrder): boolean =>
  sidesOf(cell).some((side) => {
    const parts = yearLastParts(side);
    if (parts === null) return false;
    const [month, day] = order === 'mdy' ? parts : [parts[1], parts[0]];
    return month > 12 && day <= 12;
  });
