import { frontmatterError, type MeetingImportError } from './meeting-import-error.ts';

/** The `type:` a meeting's note declares. */
export const MEETING_TYPE = 'meeting';

/** The contract a meeting file says it follows, in its `atlas_import:` key. */
export const MEETING_IMPORT_V1 = 'meeting/v1';

/** Someone, or some list, the meeting was sent to. */
export interface MeetingAttendee {
  readonly name: string;
  readonly email: string | null;
  /** A group address (`platform-team@…`): kept, but never made a Person. */
  readonly group: boolean;
}

/**
 * What the transcript's times count: time since the recording started
 * (Gemini's `00:09:44`) or the time of day (Granola's `14:14:22`).
 */
export type TranscriptClock = 'elapsed' | 'wall';

/** A meeting's frontmatter, read and checked against meeting/v1. */
export interface MeetingHeader {
  readonly title: string;
  /** The day, `2026-10-06`. */
  readonly date: string;
  /** The local time it started, `14:05`. */
  readonly start: string;
  readonly end: string | null;
  /** What sort of meeting the provider or the mapping called it: Standup, 1:1… */
  readonly kind: string | null;
  readonly provider: string;
  /** The provider's own id for it: what makes a second copy a duplicate. */
  readonly externalId: string;
  readonly attendees: readonly MeetingAttendee[];
  readonly transcriptClock: TranscriptClock;
}

/** Why a present value is wrong, or null when it is right. */
type ValueCheck = (value: unknown) => string | null;

const DAY = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const PROVIDER = /^[a-z][a-z0-9-]*$/;
const EMAIL = /^[^\s@]+@[^\s@]+$/;
const CLOCKS: readonly TranscriptClock[] = ['elapsed', 'wall'];

const exactly =
  (expected: string): ValueCheck =>
  (value) =>
    value === expected ? null : `must be \`${expected}\``;

const someText: ValueCheck = (value) =>
  typeof value === 'string' && value.trim() !== '' ? null : 'must be text, and not blank';

const calendarDay: ValueCheck = (value) =>
  typeof value === 'string' && isCalendarDay(value)
    ? null
    : 'must be a day that exists, like 2026-10-06, quoted';

const clockTime: ValueCheck = (value) =>
  typeof value === 'string' && CLOCK_TIME.test(value)
    ? null
    : 'must be a 24-hour time like 14:05, quoted';

const providerName: ValueCheck = (value) =>
  typeof value === 'string' && PROVIDER.test(value)
    ? null
    : 'must be a lowercase name like gemini or granola';

const transcriptClock: ValueCheck = (value) =>
  CLOCKS.includes(value as TranscriptClock) ? null : `must be one of ${CLOCKS.join(', ')}`;

interface FieldRule {
  readonly key: string;
  readonly required: boolean;
  readonly check: ValueCheck;
}

/** Every scalar key of meeting/v1, in the order the contract lists them. */
const FIELD_RULES: readonly FieldRule[] = [
  { key: 'type', required: true, check: exactly(MEETING_TYPE) },
  { key: 'atlas_import', required: true, check: exactly(MEETING_IMPORT_V1) },
  { key: 'title', required: true, check: someText },
  { key: 'date', required: true, check: calendarDay },
  { key: 'start', required: true, check: clockTime },
  { key: 'end', required: false, check: clockTime },
  { key: 'kind', required: false, check: someText },
  { key: 'provider', required: true, check: providerName },
  { key: 'external_id', required: true, check: someText },
  { key: 'transcript_clock', required: false, check: transcriptClock },
];

/** Whether `text` is `YYYY-MM-DD` naming a day the calendar has: no 30 February. */
function isCalendarDay(text: string): boolean {
  const match = DAY.exec(text);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (lengths[month - 1] ?? 0);
}

/** YAML's empty value (`end:`) and a missing key mean the same: not given. */
const isAbsent = (value: unknown) => value === undefined || value === null;

function checkFields(properties: Readonly<Record<string, unknown>>): MeetingImportError[] {
  const errors: MeetingImportError[] = [];
  for (const { key, required, check } of FIELD_RULES) {
    const value = properties[key];
    if (isAbsent(value)) {
      if (required) errors.push(frontmatterError(key, `${key} is required`));
      continue;
    }
    const problem = check(value);
    if (problem !== null) errors.push(frontmatterError(key, `${key} ${problem}`));
  }
  return errors;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const ATTENDEE_KEYS = new Set(['name', 'email', 'group']);

/** The problems with one attendee entry, named by where it sits in the list. */
function attendeeErrors(entry: unknown, at: string): MeetingImportError[] {
  if (!isRecord(entry)) {
    return [
      frontmatterError(at, `${at} must be a { name, email, group } entry, not a line of text`),
    ];
  }
  const errors: MeetingImportError[] = [];
  const name = someText(entry['name']);
  if (name !== null) errors.push(frontmatterError(`${at}.name`, `${at}.name ${name}`));
  const email = entry['email'];
  if (!isAbsent(email) && !(typeof email === 'string' && EMAIL.test(email))) {
    errors.push(frontmatterError(`${at}.email`, `${at}.email must be an address like a@b.com`));
  }
  const group = entry['group'];
  if (!isAbsent(group) && typeof group !== 'boolean') {
    errors.push(frontmatterError(`${at}.group`, `${at}.group must be true or false`));
  }
  for (const key of Object.keys(entry).filter((each) => !ATTENDEE_KEYS.has(each))) {
    errors.push(frontmatterError(`${at}.${key}`, `${at} has ${key}, which meeting/v1 does not`));
  }
  return errors;
}

function checkAttendees(value: unknown): MeetingImportError[] {
  if (isAbsent(value)) return [];
  if (!Array.isArray(value)) {
    return [frontmatterError('attendees', 'attendees must be a list')];
  }
  return value.flatMap((entry, index) => attendeeErrors(entry, `attendees[${index}]`));
}

const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function toAttendee(entry: Record<string, unknown>): MeetingAttendee {
  return {
    name: String(entry['name']),
    email: textOrNull(entry['email']),
    group: entry['group'] === true,
  };
}

/** The header of frontmatter that has already passed every check. */
function toHeader(properties: Readonly<Record<string, unknown>>): MeetingHeader {
  const attendees = properties['attendees'];
  return {
    title: String(properties['title']),
    date: String(properties['date']),
    start: String(properties['start']),
    end: textOrNull(properties['end']),
    kind: textOrNull(properties['kind']),
    provider: String(properties['provider']),
    externalId: String(properties['external_id']),
    attendees: Array.isArray(attendees) ? attendees.filter(isRecord).map(toAttendee) : [],
    transcriptClock: properties['transcript_clock'] === 'wall' ? 'wall' : 'elapsed',
  };
}

/**
 * A meeting file's frontmatter, read as YAML gives it, checked against
 * meeting/v1: the header, or every key that is wrong. Keys the contract does
 * not name are left alone — Atlas adds its own later (`atlas_import_error`).
 */
export function readMeetingHeader(properties: Readonly<Record<string, unknown>>): {
  readonly header: MeetingHeader | null;
  readonly errors: readonly MeetingImportError[];
} {
  const errors = [...checkFields(properties), ...checkAttendees(properties['attendees'])];
  return { header: errors.length === 0 ? toHeader(properties) : null, errors };
}
