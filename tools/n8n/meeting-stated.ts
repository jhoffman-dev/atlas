import { MeetingMappingError, oneLine } from './meeting-mapping-error.ts';

/** The day (`YYYY-MM-DD`) and, when given, the clock time a Gemini email states. */
export interface StatedWhen {
  readonly day: string;
  /** As written after the day (`10:00`, `2:30 PM`). */
  readonly time: string | null;
  /** The zone written after the time (`EDT`, `UTC+1`, `-04:00`), else null: the reader's own clock. */
  readonly zone: string | null;
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

/**
 * A day as an email or a Gemini doc title writes it — `Oct 6, 2026`,
 * `October 6 2026`, `2026/10/06`, `2026-10-06` — and the time after it, if any.
 */
const STATED =
  /(?:\b(\d{4})[-/](\d{2})[-/](\d{2})|\b([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4}))(?:,?\s+(?:at\s+)?(\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?)(?:\s*([a-z]{1,5}(?:[+-]\d{1,2}(?::?\d{2})?)?\b|[+-]\d{2}:?\d{2}\b))?)?/gi;

/** Offsets, in minutes east of UTC, of the zone abbreviations an email states. `IST` and the like mean several zones, so they are left out. */
const ZONE_OFFSETS: Readonly<Record<string, number>> = {
  UTC: 0,
  GMT: 0,
  Z: 0,
  WET: 0,
  WEST: 60,
  BST: 60,
  CET: 60,
  CEST: 120,
  EET: 120,
  EEST: 180,
  JST: 540,
  AEST: 600,
  AEDT: 660,
  HST: -600,
  AKST: -540,
  AKDT: -480,
  PST: -480,
  PDT: -420,
  MST: -420,
  MDT: -360,
  CST: -360,
  CDT: -300,
  EST: -300,
  EDT: -240,
};

/** `UTC+1`, `GMT-04:00`, `+05:30`, `-0400`. */
const NUMERIC_ZONE = /^(?:UTC|GMT)?([+-])(\d{1,2})(?::?(\d{2}))?$/i;

/**
 * Minutes east of UTC of a zone as an email writes it, or null when it is
 * not one the mapper knows: the caller then cannot convert the time.
 */
export function zoneOffsetMinutes(zone: string): number | null {
  const named = ZONE_OFFSETS[zone.toUpperCase()];
  if (named !== undefined) return named;
  const numeric = NUMERIC_ZONE.exec(zone);
  if (numeric === null) return null;
  const minutes = Number(numeric[2]) * 60 + Number(numeric[3] ?? 0);
  return numeric[1] === '-' ? -minutes : minutes;
}

/**
 * The zone written after a stated time, or null when the word there is no
 * zone (`10:00 Team sync`): a known abbreviation in any case, an offset, or
 * an unknown abbreviation in capitals (kept, so the start is flagged).
 */
function zoneOf(written: string | undefined): string | null {
  if (written === undefined) return null;
  if (zoneOffsetMinutes(written) !== null) return written;
  return /^[A-Z]{2,5}$/.test(written) ? written : null;
}

/** `Oct`, `Sept`, `october` as a month number; null for a word that is no month. */
function monthNumber(word: string): number | null {
  const lower = word.toLowerCase();
  const prefix = lower === 'sept' ? 'sep' : lower;
  const index = MONTHS.findIndex((month) => month.startsWith(prefix));
  return index === -1 ? null : index + 1;
}

const two = (value: number | string) => String(value).padStart(2, '0');

function dayOf(match: RegExpExecArray): string | null {
  const [, isoYear, isoMonth, isoDay, monthWord, wordDay, wordYear] = match;
  if (isoYear !== undefined) return `${isoYear}-${isoMonth ?? ''}-${isoDay ?? ''}`;
  const month = monthNumber(monthWord ?? '');
  return month === null ? null : `${wordYear ?? ''}-${two(month)}-${two(wordDay ?? '')}`;
}

/**
 * The meeting's day and time as a Gemini email states them: its subject
 * (`Notes: “Weekly sync” Oct 6, 2026`) or its doc's title
 * (`Weekly sync - 2026/10/06 10:00 PDT - Notes by Gemini`). The last date in
 * the words wins, since the title before it may hold a date of its own.
 * Null when nothing is stated; refused when words are given but hold no date,
 * rather than falling back to a time that is not the meeting's.
 */
export function readStated(value: unknown): StatedWhen | null {
  const text = oneLine(value);
  if (text === '') return null;
  const found = [...text.matchAll(STATED)]
    .map((match) => ({ day: dayOf(match), time: match[7] ?? null, zone: zoneOf(match[8]) }))
    .filter((each): each is StatedWhen => each.day !== null);
  const last = found.at(-1);
  if (last === undefined) throw new MeetingMappingError(`stated: no date in "${text}"`);
  return last;
}
