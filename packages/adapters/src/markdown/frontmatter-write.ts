import {
  Document,
  isAlias,
  isMap,
  isNode,
  isScalar,
  isSeq,
  parseDocument,
  visit,
  type Node,
  type Pair,
  type Scalar,
  type YAMLMap,
  type YAMLSeq,
} from 'yaml';
import { KeyAsWritten } from '@atlas/domain';

/**
 * Changes some keys of a frontmatter block and leaves everything else alone.
 *
 * The block is edited as a YAML document rather than rebuilt from parsed values,
 * so comments, key order, quoting style and block-vs-inline lists all survive.
 * Setting a value to null or undefined removes the key.
 *
 * A changed list or map is written into the one that was there, not over it:
 * items and keys that still hold the same values keep their nodes, so a
 * dashboard's other widgets keep their comments, quoting and inline lists when
 * one widget is edited, and a list that was inline stays inline.
 *
 * A key that was not changed is written back as the exact text it was found
 * as — its indentation, spacing and folded strings included — since
 * re-stringifying it would normalise all of them.
 *
 * An anchor on the node being changed (or anything inside it) that other keys
 * refer to moves to the first of them, holding the value it had: editing
 * `tags: &t [a, b]` never changes an `other: *t`, and removing `tags` never
 * leaves `other` pointing at nothing. The link is broken only for the key that
 * was edited — the least surprising of the choices, since the person editing
 * one property cannot see the others it would otherwise change.
 *
 * The `---` delimiters and the line endings are reused exactly as they were
 * found, so a file written on Windows stays written on Windows.
 *
 * A change given as {@link KeyAsWritten} is written as exactly that text, in
 * the key's place — how archiving gives a note back its own keys. Text that is
 * not that one key, alone, at the start of its line, is not written: the key
 * is removed instead, since it could otherwise break the block around it.
 */
export function updateFrontmatter(
  frontmatter: string | null,
  changes: Readonly<Record<string, unknown>>,
): string {
  const { opening, body, closing, content } = split(frontmatter);
  const eol = opening.endsWith('\r\n') ? '\r\n' : '\n';
  const source = body.replace(/\r\n/g, '\n');

  // An empty block parses to null and has nothing to set keys on. Starting from a
  // fresh Document gives a block map; parsing `{}` would give a flow one and write
  // `{title: New}` on a single line.
  const document: Document = source.trim() === '' ? new Document({}) : parseDocument(source);
  // A key given the value it already holds is no change: its line keeps its bytes.
  const changed = Object.entries(changes).filter(([key, value]) => !holds(document, key, value));
  // Nothing to write — only removals of keys that are not there — leaves the
  // block as it was found, so a comment-only or empty block is not re-rendered.
  if (frontmatter !== null && changed.every(([key, value]) => absent(document, key, value))) {
    return frontmatter;
  }

  const lists = listIndent(
    document,
    source,
    changed.map(([key]) => key),
  );
  const touched = new Set<string>();
  const asWritten = new Map<string, string>();
  for (const [key, change] of changed) {
    for (const holder of releaseAnchors(document, key)) touched.add(holder);
    touched.add(key);
    if (!(change instanceof KeyAsWritten)) {
      setKey(document, key, change);
      continue;
    }
    const node = writtenValue(key, change.text);
    if (node === null) setKey(document, key, null);
    else {
      asWritten.set(key, change.text);
      putNode(document, key, node);
    }
  }
  if (isEmptiedBlockMap(document)) {
    // The library would write `{}`; what is left is what stood around the
    // keys — comments and blank lines before the first and after the last —
    // and a block with nothing in it at all is just its delimiters.
    // Comments heading the block lose the blank lines the library put under
    // them; a head that is only blank lines was the note's own, and stays.
    const around = segments(source);
    const head = around?.head ?? '';
    const kept = head.trim() === '' ? head : head.replace(/\n+$/, '\n');
    return `${opening}${`${kept}${around?.tail ?? ''}`.replace(/\n/g, eol)}${closing}`;
  }

  const written = document
    .toString({
      // Never wrap: a long value must not gain a line break it did not have.
      lineWidth: 0,
      // `[one, two]` rather than `[ one, two ]`, so an untouched inline list is
      // written back exactly as it was found.
      flowCollectionPadding: false,
      ...lists,
    })
    .replace(/\n$/, '');
  const kept = keepUntouched({ original: source, written, touched, asWritten });
  // Blank lines were all a block held: they stay above the keys it now has.
  const blank = source.trim() === '' ? content.replace(/\r\n/g, '\n') : '';
  return `${opening}${`${blank}${kept}`.replace(/\n/g, eol)}${eol}${closing}`;
}

/**
 * The value `text` gives `key`, when `text` is that key and nothing else: one
 * block-map entry, at the start of its line, in text that parses cleanly.
 * Null otherwise. The value is kept as a node, so a key whose text cannot be
 * put back in — in a flow map — is still written with the value it holds.
 */
function writtenValue(key: string, text: string): Node | null {
  if (!text.endsWith('\n') || /^(?:---|\.\.\.)(?:[ \t]|$)/m.test(text)) return null;
  const parsed = parseDocument(text);
  const contents = parsed.contents;
  if (parsed.errors.length > 0 || !isMap(contents) || contents.flow === true) return null;
  const [pair, ...others] = contents.items;
  if (pair === undefined || others.length > 0 || keyOf(pair.key) !== key) return null;
  if (!isNode(pair.key) || columnOf(text, pair.key.range?.[0]) !== 0) return null;
  // A bare `key:` may hold no node; an empty one keeps the key in its place.
  return isNode(pair.value) ? pair.value : parsed.createNode(null);
}

/** Sets `key` to a node as it stands, in the key's place, or last when the block lacks it. */
function putNode(document: Document, key: string, node: Node): void {
  const pair = pairOf(document, key);
  if (pair === undefined) document.set(key, node);
  else pair.value = node;
}

/**
 * Each top-level key of a frontmatter block with the exact text that writes
 * it — the comment lines right above it included — with `\n` line endings.
 * Nothing for a note with no block. Keys that share lines (a flow map) cannot
 * be cut apart, so each is written out on a line of its own instead: the
 * value is kept, if not its spelling.
 */
export function frontmatterKeyTexts(frontmatter: string | null): Record<string, string> {
  if (frontmatter === null) return {};
  const source = split(frontmatter).body.replace(/\r\n/g, '\n');
  const cut = segments(source);
  if (cut !== null) return Object.fromEntries(cut.keys.map(({ key, text }) => [key, text]));
  const contents = parseDocument(source).contents;
  if (!isMap(contents)) return {};
  return Object.fromEntries(
    contents.items.map((pair) => {
      const alone = new Document({});
      alone.set(pair.key, pair.value);
      return [keyOf(pair.key), alone.toString({ lineWidth: 0, flowCollectionPadding: false })];
    }),
  );
}

/**
 * How deep a changed block list is written: as deep as the first changed key's
 * list was found, so `tags:` over `- a` stays at zero indent and one at four
 * spaces keeps four. The library's two spaces otherwise. Only the changed keys'
 * text is written this way — the rest is put back as it was found.
 */
function listIndent(
  document: Document,
  source: string,
  keys: readonly string[],
): { indent?: number; indentSeq?: boolean } {
  for (const key of keys) {
    const pair = pairOf(document, key);
    const list = pair?.value;
    if (!isSeq(list) || list.flow === true || !isNode(pair?.key)) continue;
    const keyColumn = columnOf(source, pair.key.range?.[0]);
    const itemColumn = columnOf(source, list.range?.[0]);
    if (keyColumn === null || itemColumn === null) continue;
    const depth = itemColumn - keyColumn;
    return depth <= 0 ? { indentSeq: false } : { indent: depth, indentSeq: true };
  }
  return {};
}

function columnOf(source: string, offset: number | undefined): number | null {
  return offset === undefined ? null : offset - (source.lastIndexOf('\n', offset - 1) + 1);
}

/** The key as the reader names it: `2024:` is the property "2024". */
const keyOf = (key: unknown) => String(isScalar(key) ? key.value : key);

function pairOf(document: Document, key: string): Pair | undefined {
  const contents = document.contents;
  if (!isMap(contents)) return undefined;
  return contents.items.find((pair) => keyOf(pair.key) === key);
}

/** Whether the last key of a block map was just removed; a flow map stays `{}`. */
function isEmptiedBlockMap(document: Document): boolean {
  const contents = document.contents;
  return isMap(contents) && contents.items.length === 0 && contents.flow !== true;
}

/** Whether this change removes a key the block does not have. */
function absent(document: Document, key: string, value: unknown): boolean {
  return (value === null || value === undefined) && pairOf(document, key) === undefined;
}

/**
 * Whether `key` already holds `value`, alias or not. Text given as written
 * always counts as a change; so does a map whose keys are in another order.
 */
function holds(document: Document, key: string, value: unknown): boolean {
  if (value === null || value === undefined || value instanceof KeyAsWritten) return false;
  const pair = pairOf(document, key);
  if (pair === undefined || !isNode(pair.value)) return false;
  return JSON.stringify(pair.value.toJS(document)) === JSON.stringify(value);
}

function setKey(document: Document, key: string, value: unknown): void {
  const contents = document.contents;
  const pair = pairOf(document, key);
  if (pair === undefined || !isMap(contents)) {
    // Removing a key that is not there changes nothing — and a block holding
    // only comments has no map for the library to remove it from.
    if (value !== null && value !== undefined) document.set(key, value);
  } else if (value === null || value === undefined) {
    contents.items.splice(contents.items.indexOf(pair), 1);
  } else {
    pair.value = reconcile(document, pair.value, value);
  }
}

/**
 * Before `key` is changed, gives every anchor inside it that another key
 * refers to a new home: the first alias of it becomes a copy of the anchored
 * node, anchor and all, so it and every later alias keep the value they read.
 * Returns the keys whose text that changed.
 */
function releaseAnchors(document: Document, key: string): string[] {
  const edited = pairOf(document, key);
  const contents = document.contents;
  if (edited === undefined || !isMap(contents)) return [];
  const anchored: (Scalar | YAMLMap | YAMLSeq)[] = [];
  if (!isNode(edited.value)) return [];
  visit(edited.value, (_, node) => {
    if (isNode(node) && !isAlias(node) && node.anchor !== undefined) anchored.push(node);
  });

  const holders: string[] = [];
  for (const node of anchored) {
    const name = node.anchor as string;
    for (const pair of contents.items) {
      if (pair === edited || !isNode(pair.value)) continue;
      const holder = () => {
        const copy = node.clone() as typeof node;
        copy.anchor = name;
        return copy;
      };
      const refersHere = (alias: unknown) => isAlias(alias) && alias.source === name;
      let moved = refersHere(pair.value);
      // A key's whole value has no parent for `visit` to swap it in, so it is set directly.
      if (moved) pair.value = holder();
      else {
        visit(pair.value, (_, alias) => {
          // The copy that replaces the alias is visited next; stop there.
          if (moved) return visit.BREAK;
          if (!refersHere(alias)) return undefined;
          moved = true;
          return holder();
        });
      }
      if (moved) {
        delete node.anchor;
        holders.push(keyOf(pair.key));
        break;
      }
    }
  }
  return holders;
}

/**
 * `value` as a node, reusing `existing` wherever it already says the same.
 * Anything else is a fresh node, written in the library's default style.
 */
function reconcile(document: Document, existing: unknown, value: unknown): unknown {
  if (!isNode(existing)) return value;
  if (sameValue(document, existing, value)) return existing;
  if (isSeq(existing) && Array.isArray(value)) {
    existing.items = reconcileItems(document, existing.items, value);
    return existing;
  }
  if (isMap(existing) && isPlainObject(value)) {
    reconcileMap(document, existing, value);
    return existing;
  }
  // A scalar keeps its node, and with it its quoting, as `set` always did.
  if (isScalar(existing) && isScalarValue(value)) {
    existing.value = value;
    return existing;
  }
  return document.createNode(value);
}

/**
 * The list's new items, each the old node that holds the same value if there
 * is one — so a reordered list moves its nodes rather than rewriting them.
 * An item that changed is written into the node that stood in its place, or,
 * when that one has moved on, the first node left over — changed as little as
 * it can be. Only what is left over after that is made afresh.
 */
function reconcileItems(document: Document, items: readonly unknown[], values: readonly unknown[]) {
  const claimed = new Set<number>();
  const claim = (at: number) => {
    claimed.add(at);
    return items[at];
  };
  const matched = values.map((value) => {
    const at = items.findIndex(
      (item, index) => !claimed.has(index) && sameValue(document, item, value),
    );
    return at === -1 ? undefined : claim(at);
  });
  return values.map((value, at) => {
    if (matched[at] !== undefined) return matched[at];
    const spare =
      at < items.length && !claimed.has(at)
        ? at
        : items.findIndex((_, index) => !claimed.has(index));
    return spare === -1 ? document.createNode(value) : reconcile(document, claim(spare), value);
  });
}

/**
 * The map's keys set to `value`'s, each written into the pair that held it,
 * and put in `value`'s order — so a property moved or renamed in an editor
 * lands where the editor put it, and a new key where it was added.
 */
function reconcileMap(
  document: Document,
  existing: { items: { key: unknown; value: unknown }[] },
  value: Readonly<Record<string, unknown>>,
): void {
  existing.items = existing.items.filter((pair) => Object.hasOwn(value, keyOf(pair.key)));
  for (const [key, wanted] of Object.entries(value)) {
    const pair = existing.items.find((item) => keyOf(item.key) === key);
    if (pair === undefined) existing.items.push(document.createPair(key, wanted));
    else pair.value = reconcile(document, pair.value, wanted);
  }
  existing.items = inOrderOf(Object.keys(value), existing.items);
}

/**
 * Pairs sorted into `order`. A key like `2024` stays where it was: a
 * JavaScript object lists such keys first whatever order they were written
 * in, so its place in `order` says nothing about where it belongs.
 */
function inOrderOf<Item extends { key: unknown }>(order: readonly string[], items: Item[]): Item[] {
  const place = new Map(order.filter((key) => !isIndexKey(key)).map((key, at) => [key, at]));
  const movable = items
    .filter((item) => place.has(keyOf(item.key)))
    .sort((left, right) => (place.get(keyOf(left.key)) ?? 0) - (place.get(keyOf(right.key)) ?? 0));
  let next = 0;
  return items.map((item) => (place.has(keyOf(item.key)) ? (movable[next++] as Item) : item));
}

const isIndexKey = (key: string) => /^(?:0|[1-9]\d{0,8})$/.test(key);

function sameValue(document: Document, node: unknown, value: unknown): boolean {
  const current: unknown = isNode(node) ? (node as Node).toJS(document) : node;
  return JSON.stringify(current) === JSON.stringify(value);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isScalarValue = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

/** A block's top-level keys, each with the exact text that writes it. */
interface Segments {
  /** Comments and blank lines before the first key. */
  readonly head: string;
  readonly keys: readonly { readonly key: string; readonly text: string }[];
  /** Whatever follows the last key's value: a trailing comment. */
  readonly tail: string;
}

/**
 * The block as written, with every key that was not touched put back as the
 * text it was found as. Each key's text runs from the comment lines right
 * above it to where the next key's begin, so a key's comment goes where the
 * key goes. Both texts are cut the same way, which is what lets a key's
 * written text be swapped for its original. A trailing comment is kept as it
 * was found.
 */
function keepUntouched({
  original,
  written,
  touched,
  asWritten,
}: {
  original: string;
  written: string;
  touched: ReadonlySet<string>;
  /** Keys whose text is given, written as that text wherever they stand. */
  asWritten: ReadonlyMap<string, string>;
}): string {
  const before = segments(original);
  const after = segments(written);
  if (after === null) return written;
  if (before === null) {
    // Nothing of the original to keep, but a key given as written is still written so.
    if (asWritten.size === 0) return written;
    const keys = after.keys.map((segment) => asWritten.get(segment.key) ?? segment.text);
    return `${after.head}${keys.join('')}${after.tail}`.replace(/\n$/, '');
  }
  const found = new Map(before.keys.map((segment) => [segment.key, segment.text]));
  const first = after.keys[0]?.key;
  const head =
    first !== undefined && first === before.keys[0]?.key && !touched.has(first)
      ? before.head
      : after.head;
  const keys = after.keys.map(
    (segment) =>
      asWritten.get(segment.key) ??
      (touched.has(segment.key) ? segment.text : (found.get(segment.key) ?? segment.text)),
  );
  return `${head}${keys.join('')}${before.tail}`.replace(/\n$/, '');
}

function segments(text: string): Segments | null {
  const source = text.endsWith('\n') ? text : `${text}\n`;
  const contents = parseDocument(source).contents;
  // A flow map (`{title: Plan}`) holds its keys on shared lines, so it cannot
  // be cut into one run of lines per key; the library writes it back whole,
  // in its own flow style, which leaves an untouched key as it was.
  if (!isMap(contents) || contents.flow === true || contents.items.length === 0) return null;
  const starts: number[] = [];
  for (const pair of contents.items) {
    if (!isNode(pair.key) || pair.key.range === undefined || pair.key.range === null) return null;
    starts.push(withCommentsAbove(source, source.lastIndexOf('\n', pair.key.range[0] - 1) + 1));
  }
  const last = contents.items[contents.items.length - 1] as Pair;
  const end = lineEnd(source, isNode(last.value) ? last.value.range : (last.key as Node).range);
  const keys = contents.items.map((pair, at) => ({
    key: keyOf(pair.key),
    text: source.slice(starts[at], starts[at + 1] ?? end),
  }));
  return { head: source.slice(0, starts[0]), keys, tail: source.slice(end) };
}

/** Where a key's line starts, moved up over the comment lines directly above it. */
function withCommentsAbove(source: string, lineStart: number): number {
  let start = lineStart;
  while (start > 0) {
    const previous = source.lastIndexOf('\n', start - 2) + 1;
    if (!source.startsWith('#', previous)) break;
    start = previous;
  }
  return start;
}

/** Just past the newline that ends a node's value (and its comment on the same line). */
function lineEnd(source: string, range: Node['range'] | undefined): number {
  const at = range?.[1] ?? source.length;
  if (source[at - 1] === '\n') return at;
  const newline = source.indexOf('\n', at);
  return newline === -1 ? source.length : newline + 1;
}

const DEFAULT_OPENING = '---\n';
const DEFAULT_CLOSING = '---\n';

function split(frontmatter: string | null): {
  opening: string;
  body: string;
  closing: string;
  /** Every line between the delimiters, the last one's newline included; `body` is this without it. */
  content: string;
} {
  if (frontmatter === null) {
    return { opening: DEFAULT_OPENING, body: '', closing: DEFAULT_CLOSING, content: '' };
  }

  // A byte-order mark before the block is part of its opening, written back as found.
  const opening = /^\uFEFF?---[ \t]*\r?\n/.exec(frontmatter);
  const closing = /\r?\n---[ \t]*(\r?\n)?$/.exec(frontmatter);
  if (opening === null || closing === null) {
    return { opening: DEFAULT_OPENING, body: '', closing: DEFAULT_CLOSING, content: '' };
  }

  const start = opening[0].length;
  const closingLine = frontmatter.slice(closing.index);
  const lastNewline = /^\r?\n/.exec(closingLine)?.[0] ?? '';
  return {
    opening: opening[0],
    body: frontmatter.slice(start, closing.index),
    closing: closingLine.slice(lastNewline.length),
    // `---\n---\n` holds no lines: the closing's newline is the opening's own.
    content: closing.index < start ? '' : frontmatter.slice(start, closing.index) + lastNewline,
  };
}
