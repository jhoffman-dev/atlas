import { MeetingMappingError } from './meeting-mapping-error.ts';

/** When a meeting was: the day, its local start, and its end when known. */
export interface MeetingWhen {
  readonly date: string;
  readonly start: string;
  readonly end: string | null;
}

/** A day and a time read off one input value; either may be missing. */
interface Moment {
  readonly day: string | null;
  readonly time: string | null;
}

const NOTHING: Moment = { day: null, time: null };
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i;
const CLOCK = /^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*([ap])?\.?m?\.?$/i;

/** `2026-09-29`, when it is a day the calendar has (no 30 February). */
function realDay(text: string): string | null {
  const match = DAY.exec(text);
  if (match === null) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? text : null;
}

/** `9:05`, `09:05:30`, `2:30 PM` as 24-hour `HH:MM`; null when it is not a time of day. */
function clockTime(text: string): string | null {
  const match = CLOCK.exec(text);
  if (match === null) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const half = match[3]?.toLowerCase();
  if (half !== undefined && (hours < 1 || hours > 12)) return null;
  if (half === 'p' && hours < 12) hours += 12;
  if (half === 'a' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** A clock in `timeZone`; refuses a name that is not an IANA zone. */
function zoneClock(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw new MeetingMappingError(`"${timeZone}" is not a time zone (try "America/Los_Angeles")`);
  }
}

/** The day and time an instant shows on a clock in `timeZone`. */
function inZone(instant: Date, timeZone: string): Moment {
  const parts = zoneClock(timeZone).formatToParts(instant);
  const part = (type: string) => parts.find((each) => each.type === type)?.value ?? '';
  return {
    day: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
}

/**
 * A date-and-time. Without an offset it is a local clock time, taken as
 * written. With one (`Z`, `-07:00`) it is an instant, shown on the clock of
 * `timeZone`; with no zone to read it in it is refused, since keeping the
 * UTC clock time would put a 17:02 meeting at 00:02 the next day.
 */
function dateTime(match: RegExpExecArray, field: string, timeZone: string | null): Moment {
  const [text, day = '', hours = '', minutes = '', offset] = match;
  if (realDay(day) === null) throw new MeetingMappingError(`${field}: ${day} is not a real day`);
  const time = clockTime(`${hours}:${minutes}`);
  if (time === null) {
    throw new MeetingMappingError(`${field}: ${hours}:${minutes} is not a time of day`);
  }
  if (offset === undefined) return { day, time };
  if (timeZone === null) {
    throw new MeetingMappingError(
      `${field}: ${text} is an instant (it ends in Z or an offset) and there is no time zone to read it in; set timeZone`,
    );
  }
  const iso = text
    .replace(' ', 'T')
    .toUpperCase()
    .replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) {
    throw new MeetingMappingError(`${field}: cannot read "${text}" as an instant`);
  }
  return inZone(instant, timeZone);
}

function readMoment(value: unknown, field: string, timeZone: string | null): Moment {
  if (value === null || value === undefined || value === '') return NOTHING;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new MeetingMappingError(`${field}: not a valid date`);
    return readMoment(value.toISOString(), field, timeZone);
  }
  if (typeof value !== 'string') {
    throw new MeetingMappingError(`${field}: expected text, got ${JSON.stringify(value)}`);
  }
  const text = value.trim();
  const full = DATE_TIME.exec(text);
  if (full !== null) return dateTime(full, field, timeZone);
  if (DAY.test(text)) {
    const day = realDay(text);
    if (day === null) throw new MeetingMappingError(`${field}: ${text} is not a real day`);
    return { day, time: null };
  }
  const time = clockTime(text);
  if (time !== null) return { day: null, time };
  throw new MeetingMappingError(`${field}: cannot read "${text}" as a date or a time`);
}

/** What the mapping reads the meeting's time from. */
export interface WhenInput {
  readonly date: unknown;
  readonly start: unknown;
  readonly end: unknown;
  /** The transcript's first time of day, for a provider (Granola) that stamps every turn. */
  readonly firstSpoken: string | null;
  readonly timeZone: string | null;
}

/**
 * The meeting's day, start and end. The start is the one given, else the
 * time on the date, else when the first word was spoken (a wall-clock
 * transcript only). With none of those the meeting has no start, and the
 * contract requires one — so it is refused rather than given a made-up time.
 */
export function meetingWhen(input: WhenInput): MeetingWhen {
  if (input.timeZone !== null) zoneClock(input.timeZone);
  const date = readMoment(input.date, 'date', input.timeZone);
  const start = readMoment(input.start, 'start', input.timeZone);
  const end = readMoment(input.end, 'end', input.timeZone);
  const day = date.day ?? start.day;
  if (day === null) throw new MeetingMappingError('date: the meeting has no date');
  const startTime = start.time ?? date.time ?? input.firstSpoken;
  if (startTime === null) {
    throw new MeetingMappingError('start: the meeting has no start time (pass `start`)');
  }
  return { date: day, start: startTime, end: end.time };
}
