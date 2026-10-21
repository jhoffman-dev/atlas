import { ATLAS_DIRECTORY } from '../vault/vault-visibility.ts';

/**
 * Merging a settings file both Macs changed by its keys rather than its lines
 * (#233). The files in `.atlas/` are DFAI's own: types, views, settings and
 * the records of what it did. DFAI writes many of them by itself as a vault
 * opens — a built-in type gaining the properties a newer build ships, say — so
 * two Macs that opened the vault before syncing, or on different builds, have
 * each changed it. Their lines then clash though their keys do not, and a
 * conflict copy of a file nobody edited is noise that never goes away.
 *
 * The rule never loses a byte a person wrote. One side's file is kept whole;
 * the other side's is folded into it only when all it did, byte for byte, was
 * add top-level keys or entries to a block map such as a type's `properties`.
 * Those are copied in as written, comments and all. Any other edit on the
 * side folded in — a comment, a reorder, a restyle, a blank line, a value
 * changed or a key removed — and the merge gives up: the sync keeps both
 * versions, with a copy, as it does for any note.
 */

/** Whether `path` is a markdown file of DFAI's own, merged by its keys when both Macs changed it. */
export function isSettingsFile(path: string): boolean {
  return path.startsWith(`${ATLAS_DIRECTORY}/`) && path.toLowerCase().endsWith('.md');
}

/** An entry of a block map, as written: its line, the lines under it, and comments just above it. */
export interface WrittenEntry {
  readonly name: string;
  readonly text: string;
}

/** A top-level key whose value is a block map: the key's own lines, then its entries. */
export interface WrittenMap {
  readonly head: string;
  readonly indent: number;
  readonly entries: readonly WrittenEntry[];
}

/** A top-level key of a frontmatter block, as written; `map` when its value can be cut into entries. */
export interface WrittenKey {
  readonly key: string;
  readonly text: string;
  readonly map: WrittenMap | null;
}

/** One version of a settings file: its frontmatter keys as written, in order, and its body. */
export interface SettingsText {
  readonly keys: readonly WrittenKey[];
  readonly body: string;
}

/** What a merge folded in from the other side: the keys, and by map, the entries. */
export interface SettingsFolded {
  readonly keys: readonly string[];
  readonly entries: ReadonlyMap<string, readonly string[]>;
}

/** The merged frontmatter's inside, between its fences, and what was folded in to make it. */
export interface SettingsMerged {
  readonly frontmatter: string;
  readonly body: string;
  readonly folded: SettingsFolded;
}

const KEY_LINE = /^([A-Za-z0-9_][A-Za-z0-9_.-]*):[ \t]*$/;
const COMMENT_OR_BLANK = /^[ \t]*(?:#.*)?$/;

/**
 * A top-level key's text cut into its entries, when its value is a block map
 * of plainly named entries at one indent: `properties:` over `  date:` and
 * `  tasks:`. Null for anything else — a value on the key's line, a flow
 * map, a list, a quoted name — which is then only ever kept or left whole.
 */
export function writtenMap(text: string): WrittenMap | null {
  const lines = linesOf(text);
  const keyAt = lines.findIndex((line) => !COMMENT_OR_BLANK.test(line.replace(/\n$/, '')));
  if (keyAt === -1 || !KEY_LINE.test(lines[keyAt]!.replace(/\n$/, ''))) return null;
  const rest = lines.slice(keyAt + 1);
  const first = rest.find((line) => !COMMENT_OR_BLANK.test(line.replace(/\n$/, '')));
  if (first === undefined) return null;
  const indent = first.length - first.trimStart().length;
  if (indent === 0 || /^\s*-/.test(first)) return null;
  const starts: number[] = [];
  for (const [at, line] of rest.entries()) {
    const bare = line.replace(/\n$/, '');
    if (COMMENT_OR_BLANK.test(bare)) continue;
    const depth = bare.length - bare.trimStart().length;
    if (depth < indent) return null;
    if (depth === indent) starts.push(at);
  }
  const entries: WrittenEntry[] = [];
  let prelude = rest.length;
  for (const [index, start] of starts.entries()) {
    const name = /^\s*([A-Za-z0-9_][A-Za-z0-9_.-]*):(?:[ \t]|\n|$)/.exec(rest[start]!)?.[1];
    if (name === undefined) return null;
    const from = leadingComments(rest, start, index === 0 ? 0 : starts[index - 1]! + 1, indent);
    const to =
      index + 1 < starts.length
        ? leadingCommentsStart(rest, starts, index + 1, indent)
        : rest.length;
    if (index === 0) prelude = from;
    entries.push({ name, text: rest.slice(from, to).join('') });
  }
  return {
    head: [...lines.slice(0, keyAt + 1), ...rest.slice(0, prelude)].join(''),
    indent,
    entries,
  };
}

/** The text's lines, each with its line ending. */
const linesOf = (text: string): string[] => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/** Where the comment lines just above the entry at `start` begin, no further up than `floor`. */
function leadingComments(
  lines: readonly string[],
  start: number,
  floor: number,
  indent: number,
): number {
  let at = start;
  while (at > floor && isShallowComment(lines[at - 1]!, indent)) at -= 1;
  return at;
}

const leadingCommentsStart = (
  lines: readonly string[],
  starts: readonly number[],
  index: number,
  indent: number,
) => leadingComments(lines, starts[index]!, starts[index - 1]! + 1, indent);

/** A comment or blank line no deeper than the entries: it belongs to the entry below it. */
function isShallowComment(line: string, indent: number): boolean {
  const bare = line.replace(/\n$/, '');
  if (!COMMENT_OR_BLANK.test(bare)) return false;
  return bare.trim() === '' || bare.length - bare.trimStart().length <= indent;
}

/**
 * `from` folded into `onto`, or null when `from` did anything but add keys or
 * map entries since `base` — or, with no base (both Macs made the file),
 * anything but add to what the two have in common, written the same. `onto`
 * is kept byte for byte; what `from` added goes after its own, as written. A
 * key or entry both added must be written the same on both, or it is a
 * conflict. `from`'s body must be `onto`'s or the base's: only one side
 * changed it, and `onto`'s is kept.
 */
export function mergeSettingsText({
  base,
  onto,
  from,
}: {
  base: SettingsText | null;
  onto: SettingsText;
  from: SettingsText;
}): SettingsMerged | null {
  if (from.body !== onto.body && (base === null || from.body !== base.body)) return null;
  if (![onto, from, ...(base === null ? [] : [base])].every(wellCut)) return null;
  const added = base === null ? addedBeside(from, onto) : addedSince(from, base);
  if (added === null) return null;
  return foldInto(onto, from, added);
}

/** Every key's and entry's text ends its line, so another can follow it. */
const wellCut = ({ keys }: SettingsText) =>
  keys.every(
    ({ text, map }) =>
      text.endsWith('\n') &&
      (map === null || map.entries.every((entry) => entry.text.endsWith('\n'))),
  );

interface Added {
  readonly keys: readonly WrittenKey[];
  readonly entries: ReadonlyMap<string, readonly WrittenEntry[]>;
}

/** What `side` added since `base`, when adding is all it did; null otherwise. */
function addedSince(side: SettingsText, base: SettingsText): Added | null {
  const was = byKey(base.keys);
  const kept = side.keys.filter(({ key }) => was.has(key));
  if (kept.length !== base.keys.length) return null;
  const entries = new Map<string, readonly WrittenEntry[]>();
  for (const [at, key] of kept.entries()) {
    const before = base.keys[at]!;
    if (key.key !== before.key) return null;
    if (key.text === before.text) continue;
    const extra = entriesAdded(key.map, before.map, { exact: true });
    if (extra === null) return null;
    entries.set(key.key, extra);
  }
  return { keys: side.keys.filter(({ key }) => !was.has(key)), entries };
}

/** With no base: what `side` has beyond `other`, when all they share is written the same. */
function addedBeside(side: SettingsText, other: SettingsText): Added | null {
  const theirs = byKey(other.keys);
  const shared = side.keys.filter(({ key }) => theirs.has(key));
  const order = other.keys.filter(({ key }) => shared.some((mine) => mine.key === key));
  if (order.some((key, at) => key.key !== shared[at]!.key)) return null;
  const entries = new Map<string, readonly WrittenEntry[]>();
  for (const key of shared) {
    const same = theirs.get(key.key)!;
    if (key.text === same.text) continue;
    const extra = entriesAdded(key.map, same.map, { exact: false });
    if (extra === null) return null;
    entries.set(key.key, extra);
  }
  return { keys: side.keys.filter(({ key }) => !theirs.has(key)), entries };
}

/**
 * The entries `side` has beyond `reference`, when the map is otherwise
 * written the same: the same head, and every shared entry the same text in
 * the same order. `exact`: `reference` may have no entry `side` lacks.
 */
function entriesAdded(
  side: WrittenMap | null,
  reference: WrittenMap | null,
  { exact }: { exact: boolean },
): WrittenEntry[] | null {
  if (side === null || reference === null) return null;
  if (side.head !== reference.head || side.indent !== reference.indent) return null;
  const known = new Map(reference.entries.map((entry) => [entry.name, entry.text]));
  const shared = side.entries.filter(({ name }) => known.has(name));
  if (exact && shared.length !== reference.entries.length) return null;
  const order = reference.entries.filter(({ name }) => shared.some((entry) => entry.name === name));
  if (
    order.some((entry, at) => entry.name !== shared[at]!.name || entry.text !== shared[at]!.text)
  ) {
    return null;
  }
  return side.entries.filter(({ name }) => !known.has(name));
}

/** `onto`'s keys as written, then `added` after them: null where `onto` holds one written differently. */
function foldInto(onto: SettingsText, from: SettingsText, added: Added): SettingsMerged | null {
  const own = byKey(onto.keys);
  const keys: string[] = [];
  const tail: string[] = [];
  for (const key of added.keys) {
    const same = own.get(key.key);
    if (same !== undefined) {
      if (same.text !== key.text) return null;
      continue;
    }
    keys.push(key.key);
    tail.push(key.text);
  }
  for (const name of added.entries.keys()) if (!own.has(name)) return null;
  const folded = new Map<string, string[]>();
  const texts: string[] = [];
  for (const key of onto.keys) {
    const theirs = from.keys.find(({ key: name }) => name === key.key)?.map ?? null;
    const fresh = freshEntries(key, theirs, added.entries.get(key.key) ?? []);
    if (fresh === null) return null;
    if (fresh.length > 0)
      folded.set(
        key.key,
        fresh.map(({ name }) => name),
      );
    texts.push(key.text + fresh.map((entry) => entry.text).join(''));
  }
  return {
    frontmatter: [...texts, ...tail].join(''),
    body: onto.body,
    folded: { keys, entries: folded },
  };
}

/**
 * The entries of `extra` that the kept key's map lacks, to put after its own;
 * null when one it has is written differently, or the two maps cannot take
 * each other's entries as lines (one is not a map, or their indents differ).
 */
function freshEntries(
  kept: WrittenKey,
  theirs: WrittenMap | null,
  extra: readonly WrittenEntry[],
): WrittenEntry[] | null {
  const map = kept.map;
  const own = new Map((map?.entries ?? []).map((entry) => [entry.name, entry.text]));
  if (extra.some((entry) => own.has(entry.name) && own.get(entry.name) !== entry.text)) return null;
  const fresh = extra.filter((entry) => !own.has(entry.name));
  if (fresh.length === 0) return fresh;
  if (map === null || theirs === null || map.indent !== theirs.indent) return null;
  return fresh;
}

const byKey = (keys: readonly WrittenKey[]) => new Map(keys.map((key) => [key.key, key]));

const isMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

/** Whether two values read from frontmatter say the same: by value, maps in any key order. */
export function sameFrontmatterValue(first: unknown, second: unknown): boolean {
  if (first instanceof Date || second instanceof Date) {
    return first instanceof Date && second instanceof Date && first.getTime() === second.getTime();
  }
  if (Array.isArray(first) || Array.isArray(second)) {
    return (
      Array.isArray(first) &&
      Array.isArray(second) &&
      first.length === second.length &&
      first.every((item, at) => sameFrontmatterValue(item, second[at]))
    );
  }
  if (isMap(first) && isMap(second)) {
    const keys = Object.keys(first);
    return (
      keys.length === Object.keys(second).length &&
      keys.every(
        (key) => Object.hasOwn(second, key) && sameFrontmatterValue(first[key], second[key]),
      )
    );
  }
  return Object.is(first, second);
}
