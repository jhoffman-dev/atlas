import { ATLAS_DIRECTORY } from '../vault/vault-visibility.ts';

/**
 * Merging a settings file both Macs changed by its keys rather than its lines
 * (#233). The files in `.atlas/` are Atlas's own: types, views, settings and
 * the records of what it did. Atlas writes many of them by itself as a vault
 * opens — a built-in type gaining the properties a newer build ships, say — so
 * two Macs that opened the vault before syncing, or on different builds, have
 * each changed it. Their lines then clash though their keys do not, and a
 * conflict copy of a file nobody edited is noise that never goes away.
 *
 * Only what one side added is merged: a top-level key, or an entry in a map a
 * key holds (a type's `properties`). Anything else either side did — a value
 * both changed, a key one removed, a body both rewrote — is a real conflict,
 * and the sync keeps both versions as it does for any note.
 */

/** Whether `path` is a markdown file of Atlas's own, merged by its keys when both Macs changed it. */
export function isSettingsFile(path: string): boolean {
  return path.startsWith(`${ATLAS_DIRECTORY}/`) && path.toLowerCase().endsWith('.md');
}

/** One version of a settings file: its frontmatter read as values, and its body as written. */
export interface SettingsSide {
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly body: string;
}

/** What to copy from one side into the other, so the other holds both sides' changes. */
export interface SettingsAdditions {
  /** Top-level keys the other side added, in its order: copied as written. */
  readonly keys: readonly string[];
  /** By a map-valued key both have, the entries the other side added to it, in its order. */
  readonly entries: Readonly<Record<string, readonly string[]>>;
}

/**
 * What `from` added since `base` that `onto` lacks, for `onto` to gain; null
 * when `from` did anything else that `onto` does not already hold — which
 * only a person merging them could settle. `base` is null when both Macs made
 * the file: then `from` may only add to what `onto` has.
 */
export function settingsAdditions({
  base,
  onto,
  from,
}: {
  base: SettingsSide | null;
  onto: SettingsSide;
  from: SettingsSide;
}): SettingsAdditions | null {
  if (from.body !== onto.body && (base === null || from.body !== base.body)) return null;
  const was = base?.frontmatter ?? {};
  const keys: string[] = [];
  const entries: Record<string, readonly string[]> = {};
  for (const key of keysOf(from.frontmatter, was)) {
    const change = changeOf(key, { was, onto: onto.frontmatter, from: from.frontmatter });
    if (change === 'conflict') {
      const added = mapAdditions(key, { was, onto: onto.frontmatter, from: from.frontmatter });
      if (added === null) return null;
      if (added.length > 0) entries[key] = added;
    } else if (change === 'add') keys.push(key);
  }
  return { keys, entries };
}

type Change = 'none' | 'add' | 'conflict';

interface Versions {
  readonly was: Readonly<Record<string, unknown>>;
  readonly onto: Readonly<Record<string, unknown>>;
  readonly from: Readonly<Record<string, unknown>>;
}

/**
 * What `from` did to `key`: nothing `onto` lacks (`none`), added it where
 * `onto` has none (`add`), or something `onto` does not hold (`conflict`).
 */
function changeOf(key: string, { was, onto, from }: Versions): Change {
  const inFrom = Object.hasOwn(from, key);
  const inWas = Object.hasOwn(was, key);
  const inOnto = Object.hasOwn(onto, key);
  // Removed by `from`: settled only when `onto` removed it too.
  if (!inFrom) return inWas && inOnto ? 'conflict' : 'none';
  if (inWas && sameValue(from[key], was[key])) return 'none';
  if (inOnto && sameValue(from[key], onto[key])) return 'none';
  if (!inOnto) return inWas ? 'conflict' : 'add';
  return 'conflict';
}

/**
 * The entries `from` added to the map `key` holds, when adding them is all
 * it did there that `onto` lacks; null when it did more, or `key` is not a
 * map on every side that has it.
 */
function mapAdditions(key: string, versions: Versions): string[] | null {
  const from = versions.from[key];
  const onto = versions.onto[key];
  const was = Object.hasOwn(versions.was, key) ? versions.was[key] : {};
  if (!isMap(from) || !isMap(onto) || !isMap(was)) return null;
  const added: string[] = [];
  for (const entry of keysOf(from, was)) {
    const change = changeOf(entry, { was, onto, from });
    if (change === 'conflict') return null;
    if (change === 'add') added.push(entry);
  }
  return added;
}

/** Every key of `first`, in its order, then those of `second` it lacks. */
const keysOf = (first: object, second: object): string[] => [
  ...new Set([...Object.keys(first), ...Object.keys(second)]),
];

const isMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

/** Whether two values read from frontmatter say the same: by value, maps in any key order. */
function sameValue(first: unknown, second: unknown): boolean {
  if (first instanceof Date || second instanceof Date) {
    return first instanceof Date && second instanceof Date && first.getTime() === second.getTime();
  }
  if (Array.isArray(first) || Array.isArray(second)) {
    return (
      Array.isArray(first) &&
      Array.isArray(second) &&
      first.length === second.length &&
      first.every((item, at) => sameValue(item, second[at]))
    );
  }
  if (isMap(first) && isMap(second)) {
    const keys = Object.keys(first);
    return (
      keys.length === Object.keys(second).length &&
      keys.every((key) => Object.hasOwn(second, key) && sameValue(first[key], second[key]))
    );
  }
  return Object.is(first, second);
}
