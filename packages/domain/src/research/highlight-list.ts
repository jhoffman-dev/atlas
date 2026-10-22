import { HIGHLIGHT_COLORS, type HighlightColor } from '../highlights/anchor.ts';
import type { PillHue } from '../page/pill-colour.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import type { LibraryEntry } from './library.ts';
import { byName, countBy, type ResearchChoice } from './research-text.ts';

/** One highlight (ADR-0043) as All highlights lists it (#507). */
export interface HighlightEntry {
  /** The literature note it is in. */
  readonly path: VaultPath;
  /** That note's title. */
  readonly source: string;
  /** When that note last changed: a highlight keeps no day of its own (ADR-0043). */
  readonly modified: number;
  /** Its block id, `^id`, which a link or an embed names it by. */
  readonly id: string;
  /** `pdf`, `epub` or `kindle` as the marker says it. */
  readonly kind: string;
  /** The start of its quote's words. */
  readonly quote: string;
  /** The start of its comment's markdown; empty for none. */
  readonly comment: string;
  readonly mark: string;
  readonly color: string;
  readonly page: number | null;
  readonly location: number | null;
  /** Its note's tags, by key. */
  readonly tags: readonly string[];
}

/** A highlight as the index lists it, before it is matched to its source. */
export type ListedHighlight = Omit<HighlightEntry, 'source' | 'modified' | 'tags'> & {
  /** Its place among its note's highlights, from 0. */
  readonly index: number;
};

/**
 * Every highlight in one of `sources` — the literature notes in use, as the
 * Library read them — with its source's title, time and tags: the most
 * recently changed sources first, then by path, each source's highlights in
 * the order it holds them. A highlight in no such source (one archived, or
 * one of a note that is no longer literature) is left out.
 */
export function joinHighlights(
  listed: readonly ListedHighlight[],
  sources: readonly LibraryEntry[],
): HighlightEntry[] {
  const byPath = new Map(sources.map((source) => [source.path, source]));
  const found = listed.flatMap((row) => {
    const source = byPath.get(row.path);
    return source === undefined ? [] : [{ row, source }];
  });
  found.sort(
    (left, right) =>
      right.source.modified - left.source.modified ||
      inPathOrder(left.row.path, right.row.path) ||
      left.row.index - right.row.index,
  );
  return found.map(({ row, source }) => ({
    path: row.path,
    source: source.title,
    modified: source.modified,
    id: row.id,
    kind: row.kind,
    quote: row.quote,
    comment: row.comment,
    mark: row.mark,
    color: row.color,
    page: row.page,
    location: row.location,
    tags: source.tags,
  }));
}

/** Paths in the index's order: by code unit, as SQLite's `ORDER BY path` sorts them. */
const inPathOrder = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/** Whether a highlight's comment is asked for: either way, only with one, or only without. */
export type CommentFilter = 'any' | 'with' | 'without';

/** How recently a highlight's note changed: the only day a highlight can be told by. */
export type ChangedWithin = 'any' | 'week' | 'month' | 'year';

export interface HighlightFilter {
  /** One source by its note, or every one. */
  readonly source: VaultPath | null;
  /** Any of these colours (as {@link highlightColor} reads it); every colour when empty. */
  readonly colors: readonly HighlightColor[];
  readonly tag: string | null;
  readonly comment: CommentFilter;
  readonly changed: ChangedWithin;
}

export const NO_HIGHLIGHT_FILTER: HighlightFilter = {
  source: null,
  colors: [],
  tag: null,
  comment: 'any',
  changed: 'any',
};

const DAY_MS = 86_400_000;

/** How far back each choice of {@link ChangedWithin} reaches. */
export const CHANGED_WITHIN_MS: Readonly<Record<Exclude<ChangedWithin, 'any'>, number>> = {
  week: 7 * DAY_MS,
  month: 30 * DAY_MS,
  year: 365 * DAY_MS,
};

/** A highlight's colour as it is drawn: one this build does not know is yellow (ADR-0043 §3). */
export function highlightColor(color: string): HighlightColor {
  return HIGHLIGHT_COLORS.find((known) => known === color) ?? 'yellow';
}

/** Each colour's muted pastel: the same-named hue, so a yellow highlight reads yellow. */
export const HIGHLIGHT_HUES: Readonly<Record<HighlightColor, PillHue>> = {
  yellow: 'yellow',
  green: 'green',
  blue: 'blue',
  pink: 'pink',
  purple: 'purple',
  orange: 'orange',
};

/** Whether a highlight has a comment: one of only spaces is none. */
export function hasComment(entry: Pick<HighlightEntry, 'comment'>): boolean {
  return entry.comment.trim() !== '';
}

/**
 * The highlights `filter` lets through, in the order given. "Changed within"
 * counts back from `now`, the clock's, and keeps a note changed in the future
 * (another Mac's clock ahead of this one) rather than hiding it.
 */
export function filterHighlights(
  entries: readonly HighlightEntry[],
  filter: HighlightFilter,
  now: number,
): HighlightEntry[] {
  const since = filter.changed === 'any' ? null : now - CHANGED_WITHIN_MS[filter.changed];
  return entries.filter(
    (entry) =>
      (filter.source === null || entry.path === filter.source) &&
      (filter.colors.length === 0 || filter.colors.includes(highlightColor(entry.color))) &&
      (filter.tag === null || entry.tags.includes(filter.tag)) &&
      (filter.comment === 'any' || hasComment(entry) === (filter.comment === 'with')) &&
      (since === null || entry.modified >= since),
  );
}

/**
 * Where a highlight is in its source, as a row says it: a PDF's or a
 * Kindle book's page, a Kindle location, or nothing — an EPUB's place is a
 * CFI, which means nothing read.
 */
export function highlightPlace(entry: Pick<HighlightEntry, 'page' | 'location'>): string | null {
  if (entry.location !== null) return `Location ${entry.location}`;
  if (entry.page !== null) return `Page ${entry.page}`;
  return null;
}

/** The embed a highlight is pulled into another note with: `![[Source#^id]]` (ADR-0022). */
export function highlightEmbed({ target, id }: { target: string; id: string }): string {
  return `![[${target}#^${id}]]`;
}

/** What All highlights' filters offer: each source, colour and tag its highlights have, with how many. */
export interface HighlightChoices {
  readonly sources: readonly ResearchChoice<VaultPath>[];
  readonly colors: readonly ResearchChoice<HighlightColor>[];
  readonly tags: readonly ResearchChoice<string>[];
}

/** The choices All highlights' filters offer; sources and tags by name, colours in their own order. */
export function highlightChoices(entries: readonly HighlightEntry[]): HighlightChoices {
  const titles = new Map<VaultPath, string>();
  for (const entry of entries) if (!titles.has(entry.path)) titles.set(entry.path, entry.source);
  const sources = countBy(entries, (entry) => [entry.path]);
  const colors = countBy(entries, (entry) => [highlightColor(entry.color)]);
  const tags = countBy(entries, (entry) => entry.tags);
  return {
    sources: [...sources]
      .map(([value, count]) => ({ value, label: titles.get(value) ?? value, count }))
      .sort((left, right) => byName(left.label, right.label) || byName(left.value, right.value)),
    colors: HIGHLIGHT_COLORS.flatMap((color) => {
      const count = colors.get(color);
      return count === undefined ? [] : [{ value: color, label: capitalised(color), count }];
    }),
    tags: [...tags]
      .map(([value, count]) => ({ value, label: `#${value}`, count }))
      .sort((left, right) => byName(left.value, right.value)),
  };
}

const capitalised = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
