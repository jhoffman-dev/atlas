/**
 * External data as plain records.
 *
 * Every format reader here takes text and returns records: no fetching, no
 * files, no clock. A feed that arrives malformed is a test rather than an
 * incident, and the same reader runs whether the text came off the network or
 * off the disk.
 */

/** One row of an external source, with whatever fields it happened to have. */
export type SourceRecord = Readonly<Record<string, string>>;

export class SourceFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceFormatError';
  }
}

/**
 * CSV, as RFC 4180 describes it.
 *
 * Quoted fields may hold commas, quotes (doubled) and newlines, which is the
 * whole reason not to split on commas and hope. A file that ends inside a
 * quote is a `SourceFormatError`: the alternative is reading the rest of it as
 * one enormous field and losing every row after the one that opened the quote.
 */
export function parseCsv(text: string): SourceRecord[] {
  const rows = csvRows(text);
  const header = rows.shift();
  if (header === undefined) return [];

  const names = columnNames(header);

  return (
    rows
      .filter((row) => row.some((cell) => cell !== ''))
      // Built from entries rather than assigned: a column named `__proto__` is a
      // field like any other, and assigning it would reach the prototype setter,
      // which drops the value on the floor.
      .map((row) => Object.fromEntries(names.map((name, index) => [name, row[index] ?? ''])))
  );
}

/**
 * A name for every column, so that no column is nameless and no two share one.
 *
 * A blank header would make a field no one can name, and a repeated header
 * would quietly drop a column, so both fall back to the column's position.
 */
function columnNames(header: readonly string[]): string[] {
  const taken = new Set<string>();
  return header.map((raw, index) => {
    let name = raw.trim() === '' ? `column${index + 1}` : raw.trim();
    // A file is free to name a column `column2` itself. Lengthening until the
    // name is free ends, because a header has finitely many columns.
    while (taken.has(name)) name = `${name}_${index + 1}`;
    taken.add(name);
    return name;
  });
}

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  // Normalised first, so a file written on Windows parses the same as one
  // written anywhere else.
  const source = text.replace(/\r\n?/g, '\n');

  for (let at = 0; at < source.length; at += 1) {
    const character = source[at];

    if (quoted) {
      if (character === '"') {
        // A doubled quote inside quotes is one literal quote.
        if (source[at + 1] === '"') {
          cell += '"';
          at += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"' && cell === '') {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }

  if (quoted) {
    throw new SourceFormatError(
      'a quoted field is never closed, so the rest of the file would be read as part of it',
    );
  }

  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

/**
 * JSON, as a list of records.
 *
 * A feed is usually a list, but just as often a list wrapped in an envelope, so
 * `pointer` names the field the list is under. Values that are not text are
 * stringified rather than dropped: a number is still something to filter on.
 */
export function parseJsonRecords(text: string, pointer: string | null = null): SourceRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new SourceFormatError(
      `this is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const listed = pointer === null ? parsed : followPointer(parsed, pointer);
  if (!Array.isArray(listed)) {
    throw new SourceFormatError(
      pointer === null
        ? 'expected a list of records at the top level'
        : `expected a list of records at ${JSON.stringify(pointer)}`,
    );
  }

  return listed.flatMap((item) => (isObject(item) ? [flatten(item)] : []));
}

function followPointer(value: unknown, pointer: string): unknown {
  return pointer
    .split('.')
    .filter((step) => step !== '')
    .reduce<unknown>((at, step) => (isObject(at) ? at[step] : undefined), value);
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function flatten(item: Record<string, unknown>): SourceRecord {
  const fields = Object.entries(item)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]): [string, string] => [
      key,
      typeof value === 'object'
        ? JSON.stringify(value)
        : String(value as string | number | boolean),
    ]);
  // Built from entries rather than assigned, so a field named `__proto__` is
  // kept as a field instead of reaching the prototype setter and vanishing.
  return Object.fromEntries(fields);
}

/**
 * iCalendar, as the events in it.
 *
 * Only VEVENT is read. Everything a calendar carries that is not an event —
 * timezones, alarms, free/busy — is skipped rather than half-understood.
 */
export function parseIcs(text: string): SourceRecord[] {
  const events: SourceRecord[] = [];
  let current: Map<string, string> | null = null;
  let nested = 0;

  for (const line of unfold(text)) {
    if (current === null) {
      if (line === 'BEGIN:VEVENT') current = new Map();
      continue;
    }

    // A VALARM — which every Google and Apple export carries — is a component
    // inside the event, with fields of its own. Skipping to its matching END
    // keeps its DESCRIPTION off the event's, and keeps BEGIN, ACTION and
    // TRIGGER off the note entirely.
    if (line.startsWith('BEGIN:')) {
      nested += 1;
      continue;
    }
    if (line.startsWith('END:')) {
      if (nested > 0) {
        nested -= 1;
      } else if (line === 'END:VEVENT') {
        events.push(Object.fromEntries(current));
        current = null;
      }
      continue;
    }
    if (nested > 0) continue;

    const split = line.indexOf(':');
    if (split < 0) continue;

    // `DTSTART;VALUE=DATE` and `DTSTART` are the same field; the parameters
    // after the semicolon say how to read the value, not what it is called.
    const name = line.slice(0, split);
    const [key = ''] = name.split(';');
    const value = line.slice(split + 1);

    const field = key.toLowerCase();
    if (field === '') continue;
    current.set(field, field.startsWith('dt') ? icsDate(value) : unescapeIcs(value));
  }

  return events;
}

/**
 * A folded line put back together.
 *
 * iCalendar wraps long lines and marks the continuation with a leading space or
 * tab, so a summary can arrive split down the middle of a word.
 */
function unfold(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += raw.slice(1);
    } else if (raw !== '') {
      lines.push(raw);
    }
  }
  return lines;
}

/**
 * `20260920` or `20260920T140000Z` as `2026-09-20`.
 *
 * A day the calendar does not have is left as the feed wrote it: `20260230`
 * read as `2026-02-30` would sort, group and land in a month grid as though it
 * were a real day, which hides the broken feed instead of showing it.
 */
function icsDate(value: string): string {
  const trimmed = value.trim();
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(trimmed);
  if (match === null) return trimmed;

  const [, year = '', month = '', day = ''] = match;
  return isRealDay(Number(year), Number(month), Number(day)) ? `${year}-${month}-${day}` : trimmed;
}

const MONTH_LENGTHS: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isRealDay(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const leapDay = month === 2 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 1 : 0;
  return day <= (MONTH_LENGTHS[month - 1] ?? 0) + leapDay;
}

/**
 * One pass, because the escapes are not independent: unescaping `\n` first
 * turns `\\n` — an escaped backslash followed by the letter n — into a newline
 * the feed never had.
 */
function unescapeIcs(value: string): string {
  return value.replace(/\\(.)/g, (_match, escaped: string) =>
    escaped === 'n' || escaped === 'N' ? '\n' : escaped,
  );
}
