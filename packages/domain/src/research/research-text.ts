import { formatPropertyDate } from '../page/property-date.ts';

/** One option a research list's filter offers: what it filters on, what it is called, and how many it would show. */
export interface ResearchChoice<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly count: number;
}

/** A combining mark: what an accent is, once text is decomposed. */
const MARKS = /\p{M}/gu;

/** Text as a filter compares it: accents off, case folded, cut into words. */
export function foldedWords(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(MARKS, '')
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');
}

/** Whether every one of `words` (already folded) is in one of `fields`; no words match anything. */
export function matchesEvery(words: readonly string[], fields: readonly string[]): boolean {
  if (words.length === 0) return true;
  const haystack = foldedWords(fields.join(' ')).join(' ');
  return words.every((word) => haystack.includes(word));
}

const COLLATOR = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** Names in reading order: case and accents aside, numbers by value ("Part 2" before "Part 10"). */
export function byName(left: string, right: string): number {
  return COLLATOR.compare(left, right);
}

/** How many items hold each value `valuesOf` gives, an item counted once per value. */
export function countBy<Item, Value>(
  items: readonly Item[],
  valuesOf: (item: Item) => readonly Value[],
): Map<Value, number> {
  const counts = new Map<Value, number>();
  for (const item of items) {
    for (const value of new Set(valuesOf(item))) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/** `values` with `value` taken out when it is in, or put in at the end when it is not: a toggle of a filter's chips. */
export function withToggled<Value>(values: readonly Value[], value: Value): Value[] {
  return values.includes(value) ? values.filter((each) => each !== value) : [...values, value];
}

/**
 * The day a note last changed, as a list says it: "Tue, Sep 22, 2026". Read
 * in UTC, as every date the domain shows, so it never depends on the zone.
 */
export function changedOn(modified: number): string {
  const day = new Date(Number.isFinite(modified) ? modified : 0).toISOString().slice(0, 10);
  return formatPropertyDate(day) ?? day;
}
