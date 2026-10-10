import { MeetingMappingError, oneLine } from './meeting-mapping-error.ts';

/** The day (`YYYY-MM-DD`) and, when given, the clock time a Gemini email states. */
export interface StatedWhen {
  readonly day: string;
  /** As written after the day (`10:00`, `2:30 PM`); a zone after it is not read. */
  readonly time: string | null;
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
  /(?:\b(\d{4})[-/](\d{2})[-/](\d{2})|\b([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4}))(?:,?\s+(?:at\s+)?(\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?))?/gi;

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
    .map((match) => ({ day: dayOf(match), time: match[7] ?? null }))
    .filter((each): each is StatedWhen => each.day !== null);
  const last = found.at(-1);
  if (last === undefined) throw new MeetingMappingError(`stated: no date in "${text}"`);
  return last;
}
