import { SOURCE_KINDS, type SourceKind } from '../highlights/anchor.ts';
import type { PillHue } from '../page/pill-colour.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import {
  byName,
  countBy,
  foldedWords,
  matchesEvery,
  type ResearchChoice,
} from './research-text.ts';

/** A project a source is filed under: the note its link resolves to, or none, and what it is called. */
export interface LibraryProject {
  readonly path: VaultPath | null;
  readonly name: string;
}

/** One literature note (ADR-0043) as the Library lists it (#507). */
export interface LibraryEntry {
  readonly path: VaultPath;
  readonly title: string;
  readonly author: string | null;
  /** Null for a kind this build does not know, which is still listed. */
  readonly kind: SourceKind | null;
  readonly highlights: number;
  /** When the note last changed: the latest a highlight was taken or a comment written. */
  readonly modified: number;
  /** Its tags, by key, each once. */
  readonly tags: readonly string[];
  readonly projects: readonly LibraryProject[];
  /** A picture in the vault that fronts it, as written; null for none, and for one off the vault. */
  readonly cover: string | null;
}

export type LibrarySortKey = 'title' | 'author' | 'modified' | 'highlights';

export interface LibrarySort {
  readonly key: LibrarySortKey;
  readonly descending: boolean;
}

/** Newest first: the source last read is the one most likely wanted again. */
export const DEFAULT_LIBRARY_SORT: LibrarySort = { key: 'modified', descending: true };

/** Which sources the Library shows: every one of `kinds` (all, when empty), with the tag and project, matching the words. */
export interface LibraryFilter {
  readonly kinds: readonly SourceKind[];
  readonly tag: string | null;
  /** A project by {@link projectKey}. */
  readonly project: string | null;
  readonly search: string;
}

export const NO_LIBRARY_FILTER: LibraryFilter = { kinds: [], tag: null, project: null, search: '' };

/** What each kind is called on its chip. */
export const SOURCE_KIND_LABELS: Readonly<Record<SourceKind, string>> = {
  pdf: 'PDF',
  epub: 'EPUB',
  kindle: 'Kindle',
};

/** Each kind's muted pastel (#413): fixed, so a kind is the same colour in every list. */
export const SOURCE_KIND_HUES: Readonly<Record<SourceKind, PillHue>> = {
  pdf: 'red',
  epub: 'blue',
  kindle: 'orange',
};

/** A project as a filter names it: the note it resolves to, or its name folded when it resolves to none. */
export function projectKey(project: LibraryProject): string {
  return project.path ?? `name:${foldedWords(project.name).join(' ')}`;
}

/** The sources `filter` lets through, in the order given. */
export function filterLibrary(
  entries: readonly LibraryEntry[],
  filter: LibraryFilter,
): LibraryEntry[] {
  const words = foldedWords(filter.search);
  return entries.filter(
    (entry) =>
      (filter.kinds.length === 0 || (entry.kind !== null && filter.kinds.includes(entry.kind))) &&
      (filter.tag === null || entry.tags.includes(filter.tag)) &&
      (filter.project === null ||
        entry.projects.some((project) => projectKey(project) === filter.project)) &&
      matchesEvery(words, [entry.title, entry.author ?? '']),
  );
}

/**
 * The sources in `sort`'s order. A tie — and a source with no author, which
 * always comes after those with one — falls back to the title, then the path,
 * so the order is the same on every read.
 */
export function sortLibrary(entries: readonly LibraryEntry[], sort: LibrarySort): LibraryEntry[] {
  const sign = sort.descending ? -1 : 1;
  const byTitle = (left: LibraryEntry, right: LibraryEntry) =>
    byName(left.title, right.title) || byName(left.path, right.path);
  return [...entries].sort((left, right) => {
    if (sort.key === 'author') {
      if ((left.author === null) !== (right.author === null)) return left.author === null ? 1 : -1;
      return sign * byName(left.author ?? '', right.author ?? '') || byTitle(left, right);
    }
    const order =
      sort.key === 'title'
        ? byTitle(left, right)
        : sort.key === 'modified'
          ? left.modified - right.modified
          : left.highlights - right.highlights;
    return sign * order || byTitle(left, right);
  });
}

/** The Library as shown: filtered, then sorted. */
export function libraryShown(
  entries: readonly LibraryEntry[],
  { filter, sort }: { filter: LibraryFilter; sort: LibrarySort },
): LibraryEntry[] {
  return sortLibrary(filterLibrary(entries, filter), sort);
}

/** What the Library's filters offer: each kind, tag and project its sources have, with how many. */
export interface LibraryChoices {
  readonly kinds: readonly ResearchChoice<SourceKind>[];
  readonly tags: readonly ResearchChoice<string>[];
  readonly projects: readonly ResearchChoice<string>[];
}

/** The choices the Library's filters offer, each with how many sources it would show; kinds in their own order, the rest by name. */
export function libraryChoices(entries: readonly LibraryEntry[]): LibraryChoices {
  const kinds = countBy(entries, (entry) => (entry.kind === null ? [] : [entry.kind]));
  const tags = countBy(entries, (entry) => entry.tags);
  const names = new Map<string, string>();
  const projects = countBy(entries, (entry) =>
    entry.projects.map((project) => {
      const key = projectKey(project);
      if (!names.has(key)) names.set(key, project.name);
      return key;
    }),
  );
  return {
    kinds: SOURCE_KINDS.flatMap((kind) => {
      const count = kinds.get(kind);
      return count === undefined ? [] : [{ value: kind, label: SOURCE_KIND_LABELS[kind], count }];
    }),
    tags: [...tags]
      .map(([value, count]) => ({ value, label: `#${value}`, count }))
      .sort((left, right) => byName(left.value, right.value)),
    projects: [...projects]
      .map(([value, count]) => ({ value, label: names.get(value) ?? value, count }))
      .sort((left, right) => byName(left.label, right.label) || byName(left.value, right.value)),
  };
}

/** A URL's scheme, which a cover in the vault never has: a picture off the vault is never fetched. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The picture a source's `cover:` names in the vault, as the vault's image
 * loader reads it: an embed (`![[cover.jpg]]`) or a link (`[[cover.jpg|Cover]]`)
 * becomes its path, a bare path stays. Null for none, and for a URL — the
 * Library shows only what is already in the vault, and fetches nothing.
 */
export function libraryCover(value: string | null): string | null {
  if (value === null) return null;
  const linked = /^!?\[\[([^\]|#]*)[^\]]*\]\]$/.exec(value.trim());
  const path = (linked === null ? value : (linked[1] ?? '')).trim();
  return path === '' || SCHEME.test(path) || path.startsWith('//') ? null : path;
}
