/**
 * A frontmatter value, flattened into rows the index can query.
 *
 * Every value keeps a text form so `WHERE value_text = 'done'` always works, and
 * gains a typed form when one applies, so `WHERE value_num > 100` and date
 * comparisons work too. A list becomes one row per item, numbered, so an item can
 * be matched without parsing anything back out.
 */
export interface IndexableProperty {
  readonly key: string;
  readonly index: number;
  readonly text: string | null;
  readonly number: number | null;
  readonly date: string | null;
  readonly json: string | null;
}

/** `2026-09-20`, optionally with a time. Anything else is treated as plain text. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function isDateLike(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  if (Number.isNaN(Date.parse(value.replace(' ', 'T')))) return false;

  // Date.parse rolls an impossible day over — 2026-02-30 becomes March 2 — so the
  // components are checked to survive a round trip rather than merely to parse.
  const [year, month, day] = (value.slice(0, 10).split('-') as [string, string, string]).map(
    Number,
  ) as [number, number, number];
  const rebuilt = new Date(Date.UTC(year, month - 1, day));
  return (
    rebuilt.getUTCFullYear() === year &&
    rebuilt.getUTCMonth() === month - 1 &&
    rebuilt.getUTCDate() === day
  );
}

/** Flattens one frontmatter entry into the rows that represent it. */
export function toIndexableProperties(key: string, value: unknown): IndexableProperty[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      toIndexableProperties(key, item).map((row) => ({ ...row, index })),
    );
  }
  return [single(key, value)];
}

function single(key: string, value: unknown): IndexableProperty {
  const empty = { key, index: 0, text: null, number: null, date: null, json: null };

  if (value === null || value === undefined) return empty;

  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { ...empty, text: String(value), number: value }
      : { ...empty, text: String(value) };
  }

  if (typeof value === 'boolean') return { ...empty, text: String(value) };

  if (value instanceof Date) {
    return { ...empty, text: value.toISOString(), date: value.toISOString() };
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (isDateLike(trimmed)) return { ...empty, text: trimmed, date: trimmed };
    // A numeric string stays text as well, so both comparisons are available.
    const asNumber = trimmed === '' ? Number.NaN : Number(trimmed);
    return Number.isFinite(asNumber)
      ? { ...empty, text: trimmed, number: asNumber }
      : { ...empty, text: trimmed };
  }

  // Nested structures are kept whole rather than flattened into meaningless rows.
  return { ...empty, json: JSON.stringify(value) };
}

/** Every property of a note, ready to be written to the index. */
export function indexablePropertiesOf(
  frontmatter: Readonly<Record<string, unknown>>,
): IndexableProperty[] {
  return Object.entries(frontmatter).flatMap(([key, value]) => toIndexableProperties(key, value));
}
