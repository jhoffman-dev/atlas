import type { BodyRange } from '../graph/mention.ts';
import { findTags, type TagMatch } from './tag-grammar.ts';
import { formatTag, isTagName, renamedTagName, tagKey } from './tag-name.ts';

/** The frontmatter key whose values are tags, as Obsidian reads it. */
export const TAGS_KEY = 'tags';

/** One use of a tag in a note, as the index stores it. */
export interface NoteTag {
  /** What makes it the same tag as another: {@link tagKey}. */
  readonly key: string;
  /** As it is written here, which is how the tag is shown if this is its first use. */
  readonly name: string;
}

/**
 * Every tag in a body. `ranges` are its runs of plain text, as the markdown
 * parser found them — which is what keeps a `#` in code, a link or an HTML
 * block from being read as a tag.
 */
export function tagsInBody({
  body,
  ranges,
}: {
  body: string;
  ranges: readonly BodyRange[];
}): TagMatch[] {
  return [...ranges]
    .sort((left, right) => left.start - right.start)
    .flatMap((range) =>
      findTags(body.slice(range.start, range.end)).map((tag) => ({
        ...tag,
        start: tag.start + range.start,
        end: tag.end + range.start,
      })),
    );
}

/**
 * The tag a frontmatter value names, or null. The `#` is optional there —
 * `tags: [idea]` and `tags: ["#idea"]` say the same — and a closing one is allowed.
 */
function frontmatterTagName(item: unknown): string | null {
  if (typeof item !== 'string') return null;
  const trimmed = item.trim();
  const name = trimmed.startsWith('#') ? trimmed.slice(1).replace(/#$/, '') : trimmed;
  return isTagName(name) ? name : null;
}

/** The value's items: a list's, or a string's comma-separated parts (`tags: a, b`). */
function frontmatterItems(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value;
  return typeof value === 'string' ? value.split(',') : [];
}

/** The tags a note's `tags` property declares, in order, skipping what cannot be one. */
export function frontmatterTagNames(value: unknown): string[] {
  return frontmatterItems(value).flatMap((item) => {
    const name = frontmatterTagName(item);
    return name === null ? [] : [name];
  });
}

/** Every use of a tag in a note: its `tags` property first, then its body in order. */
export function noteTags({
  tagsProperty,
  body,
  ranges,
}: {
  tagsProperty: unknown;
  body: string;
  ranges: readonly BodyRange[];
}): NoteTag[] {
  return [
    ...frontmatterTagNames(tagsProperty),
    ...tagsInBody({ body, ranges }).map((tag) => tag.name),
  ].map((name) => ({ key: tagKey(name), name }));
}

/** A tag renamed: `from`, and everything nested under it, becomes `to`. */
export interface TagRename {
  readonly from: string;
  readonly to: string;
}

/**
 * The body with every use of `from` (and of the tags nested under it) renamed.
 * Only those tags' own bytes change; a tag that gains a space is closed, so it
 * still reads back whole. `count` is the uses whose bytes changed: a use
 * already written the new way is no change.
 *
 * A closed name reads back only before a space or punctuation (ADR-0018):
 * `#idea_` or `#idea#x` renamed to `my tag` would read as `#my`, and no other
 * spelling closes there. So the result is read back, and when any use would
 * not come back as its new name the body is handed back unchanged, with why.
 */
export function renameTagInBody({
  body,
  ranges,
  rename,
}: {
  body: string;
  ranges: readonly BodyRange[];
  rename: TagRename;
}): { body: string; count: number; problem: string | null } {
  const found = tagsInBody({ body, ranges });
  let text = body;
  let shifted: readonly BodyRange[] = ranges;
  let count = 0;
  for (const tag of [...found].reverse()) {
    const name = renamedTagName({ name: tag.name, ...rename });
    const written = name === null ? null : formatTag(name, tag.closed);
    if (written === null || written === text.slice(tag.start, tag.end)) continue;
    text = `${text.slice(0, tag.start)}${written}${text.slice(tag.end)}`;
    shifted = shiftRanges(shifted, tag, written.length - (tag.end - tag.start));
    count += 1;
  }
  const unreadable = firstUnreadable({
    found,
    read: tagsInBody({ body: text, ranges: shifted }),
    rename,
  });
  if (unreadable === null) return { body: text, count, problem: null };
  return { body, count: 0, problem: unreadableProblem(unreadable, body) };
}

/** The ranges once the text at `tag` grew by `delta`: the one holding it, and every later one. */
function shiftRanges(ranges: readonly BodyRange[], tag: TagMatch, delta: number): BodyRange[] {
  return ranges.map((range) => {
    if (range.start >= tag.end) return { start: range.start + delta, end: range.end + delta };
    if (range.start <= tag.start && tag.end <= range.end) {
      return { start: range.start, end: range.end + delta };
    }
    return range;
  });
}

/** The first use the renamed body does not read back as its new name, or null. */
function firstUnreadable({
  found,
  read,
  rename,
}: {
  found: readonly TagMatch[];
  read: readonly TagMatch[];
  rename: TagRename;
}): { tag: TagMatch; name: string } | null {
  const expected = found.map((tag) => ({
    tag,
    name: renamedTagName({ name: tag.name, ...rename }) ?? tag.name,
  }));
  const wrong = expected.find(({ name }, at) => read[at]?.name !== name);
  if (wrong !== undefined) return wrong;
  // Every use read back, but the new spelling made a tag of text that was none.
  return read.length === found.length ? null : (expected.at(-1) ?? null);
}

function unreadableProblem({ tag, name }: { tag: TagMatch; name: string }, body: string): string {
  const after = body.slice(tag.end).match(/^./u)?.[0];
  const where = after === undefined ? 'where it is' : `right before “${after}”`;
  return `${formatTag(name)} can’t be written ${where} and still read back as that tag.`;
}

/**
 * A `tags` property with `from` renamed, written in the form it came in: a
 * list stays a list, a comma-separated string a string, and an item written
 * with its `#` keeps it. Only the renamed items change: one renamed into a
 * tag the note already has is dropped, so the note has it once, and items the
 * rename does not reach stay as they are, repeats and all. `count` is the
 * items changed; null when there are none.
 */
export function renameTagInProperty(
  value: unknown,
  rename: TagRename,
): { value: unknown; count: number } | null {
  const renamed = frontmatterItems(value).map((item) => {
    const name = frontmatterTagName(item);
    const to = name === null ? null : renamedTagName({ name, ...rename });
    return { item, name, to };
  });
  const kept = new Set(
    renamed.flatMap(({ name, to }) => (name !== null && to === null ? [tagKey(name)] : [])),
  );
  let count = 0;
  const items = renamed.flatMap(({ item, name, to }) => {
    if (name === null || to === null) return [item];
    const key = tagKey(to);
    const rewritten = rewriteItem(item as string, name, to);
    if (kept.has(key)) {
      count += 1;
      return [];
    }
    kept.add(key);
    if (rewritten !== item) count += 1;
    return [rewritten];
  });
  if (count === 0) return null;
  return { value: Array.isArray(value) ? items : items.join(','), count };
}

/** One item with its name swapped, keeping its spacing and its `#`s. */
function rewriteItem(item: string, name: string, renamed: string): string {
  const at = item.indexOf(name);
  const closed = item.trimEnd().endsWith(`${name}#`);
  const written = item.trim().startsWith('#') ? formatTag(renamed, closed) : renamed;
  const from = item.trim().startsWith('#') ? item.indexOf('#') : at;
  const to = at + name.length + (closed ? 1 : 0);
  return `${item.slice(0, from)}${written}${item.slice(to)}`;
}
