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
  Pair,
  type Scalar,
  YAMLMap,
  type YAMLError,
  type YAMLSeq,
} from 'yaml';
import { FrontmatterRefusedError } from '@atlas/application';
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
 * the key's place — how archiving gives a note back its own keys — moved from
 * the column its key is written at to the block's. Text that is not that one
 * key, alone, is not written: the key is removed instead, since it could
 * otherwise break the block around it.
 *
 * A change that writes to a block that cannot be read is refused with a
 * {@link FrontmatterRefusedError}, on the key it would write.
 *
 * A property that lists a key twice is refused with a
 * {@link FrontmatterRefusedError} — which of the two was meant cannot be told —
 * while a change to any other key still writes only that key's bytes.
 */
export function updateFrontmatter(
  frontmatter: string | null,
  changes: Readonly<Record<string, unknown>>,
): string {
  const { opening, body, closing, content } = split(frontmatter);
  const eol = opening.endsWith('\r\n') ? '\r\n' : '\n';
  const source = body.replace(/\r\n/g, '\n');

  const document = parsedForWriting(source, Object.keys(changes));
  // A key given the value it already holds is no change: its line keeps its bytes.
  const changed = Object.entries(changes).filter(([key, value]) => !holds(document, key, value));
  // Nothing to write — only removals of keys that are not there — leaves the
  // block as it was found, so a comment-only or empty block is not re-rendered.
  if (frontmatter !== null && changed.every(([key, value]) => absent(document, key, value))) {
    return frontmatter;
  }
  refuseUnreadable(
    document,
    changed.find(([key, value]) => !absent(document, key, value))?.[0] ?? '',
  );

  const lists = listIndent(
    document,
    source,
    changed.map(([key]) => key),
  );
  const touched = new Set<string>();
  const asWritten = new Map<string, string>();
  for (const [key, change] of changed) {
    const node = change instanceof KeyAsWritten ? writtenValue(key, change.text) : undefined;
    const removing = node === null || change === null || change === undefined;
    for (const holder of releaseAnchors(document, key, removing)) touched.add(holder);
    // Only the pair the reader reads is written; a shadowed one keeps its bytes.
    const id = idOf(key, Math.max(pairsOf(document, key).length - 1, 0));
    touched.add(id);
    if (node === undefined) setKey(document, key, change);
    else if (node === null) setKey(document, key, null);
    else {
      asWritten.set(id, (change as KeyAsWritten).text);
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
 * The block as a document to write. A key written twice is an error the library
 * will not write past, so such a block is read again with duplicates allowed —
 * once no change names the property that holds one. A duplicate that no
 * property holds (inside a key written as a map) refuses every change, since
 * none can be shown not to touch it.
 */
function parsedForWriting(source: string, changing: readonly string[]): Document {
  // An empty block parses to null and has nothing to set keys on. Starting from a
  // fresh Document gives a block map; parsing `{}` would give a flow one and write
  // `{title: New}` on a single line.
  if (source.trim() === '') return new Document({});
  const document = parseDocument(source);
  const found = duplicates(document);
  if (found.length === 0) return document;
  for (const placed of found) {
    const refusal = placed ?? {
      // No property holds this duplicate, so the refusal is pinned on the first
      // change asked for: it always matches below, and every change is refused.
      // With no changes at all there is nothing to refuse: '' matches none, and
      // the block is handed back as it was.
      key: changing[0] ?? '',
      message:
        "This note's properties list a key twice; fix it in the source before changing them.",
    };
    if (changing.includes(refusal.key)) throw new FrontmatterRefusedError(refusal);
  }
  return parseDocument(source, { uniqueKeys: false });
}

/**
 * Refuses `key`'s write on a block that cannot be read — keys at two columns,
 * a tab as indentation: where the change would go cannot be told, and the
 * library will not write it anyway. Only a change that writes gets here, so
 * removing a key such a block lacks stays no change.
 */
function refuseUnreadable(document: Document, key: string): void {
  const [error] = document.errors;
  if (error === undefined) return;
  throw new FrontmatterRefusedError({
    key,
    message: `This note's properties cannot be read (${problemLine(error)}); fix them in the source before changing them.`,
  });
}

/** YAML's message for an error, without the lines that draw a caret under its column. */
export function problemLine(error: YAMLError): string {
  return error.message.split('\n')[0] ?? error.message;
}

/**
 * Each key the block writes twice, as the property holding it and why a change
 * to that property is refused; null for one no property holds.
 */
function duplicates(document: Document): (Refusal | null)[] {
  return document.errors
    .filter((error) => error.code === 'DUPLICATE_KEY')
    .map((error) => refusalAt(document, error.pos[0]));
}

/**
 * The top-level properties of a block's YAML that hold a key written twice,
 * each with why a change to it is refused — as {@link updateFrontmatter}
 * refuses it.
 */
export function duplicatedProperties(source: string): Refusal[] {
  return duplicates(parseDocument(source)).filter((refusal) => refusal !== null);
}

/** A property a change to which is refused, and why, in the person's words. */
interface Refusal {
  readonly key: string;
  readonly message: string;
}

/**
 * The top-level property holding the key written twice at `offset`, and why a
 * change to it is refused, in the person's words. Null when no property holds it.
 */
function refusalAt(document: Document, offset: number): Refusal | null {
  const contents = document.contents;
  if (!isMap(contents)) return null;
  const fix = 'fix it in the source before changing it.';
  for (const pair of contents.items) {
    if (!isNode(pair.key)) continue;
    const key = keyOf(pair.key, document);
    if (pair.key.range?.[0] === offset) {
      return { key, message: `This note's properties list "${key}" twice; ${fix}` };
    }
    const inner = isNode(pair.value) ? keyAt(document, pair.value, offset) : null;
    if (inner !== null) {
      return { key, message: `This note's property "${key}" lists "${inner}" twice; ${fix}` };
    }
  }
  return null;
}

/** The name of the key that starts at `offset` somewhere inside `node`, if one does. */
function keyAt(document: Document, node: Node, offset: number): string | null {
  let found: string | null = null;
  visit(node, {
    Pair: (_, pair) => {
      if (!isNode(pair.key) || pair.key.range?.[0] !== offset) return undefined;
      found = keyOf(pair.key, document);
      return visit.BREAK;
    },
  });
  return found;
}

/**
 * The value `given` gives `key`, when it is that key and nothing else: one
 * block-map entry, in text that parses cleanly once its key is at column 0.
 * Null otherwise. The value is kept as a node, so a key whose text cannot be
 * put back in — in a flow map — is still written with the value it holds.
 */
function writtenValue(key: string, given: string): Node | null {
  // Text read from an indented block is read as if at column 0: the key's own
  // indent is the block's, not part of what the key holds.
  const text = shifted(given, -keyColumnOf(given));
  if (!text.endsWith('\n') || /^(?:---|\.\.\.)(?:[ \t]|$)/m.test(text)) return null;
  const parsed = parseDocument(text);
  const contents = parsed.contents;
  if (parsed.errors.length > 0 || !isMap(contents) || contents.flow === true) return null;
  const [pair, ...others] = contents.items;
  if (pair === undefined || others.length > 0 || keyOf(pair.key, parsed) !== key) return null;
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
  const parsed = parseDocument(source);
  const contents = parsed.contents;
  if (!isMap(contents)) return {};
  return Object.fromEntries(
    contents.items.map((pair) => {
      const alone = new Document({});
      alone.set(pair.key, pair.value);
      return [
        keyOf(pair.key, parsed),
        alone.toString({ lineWidth: 0, flowCollectionPadding: false }),
      ];
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

export function columnOf(source: string, offset: number | undefined): number | null {
  return offset === undefined ? null : offset - (source.lastIndexOf('\n', offset - 1) + 1);
}

/**
 * The key as the reader names it: `2024:` is the property "2024", `~:` is "",
 * and `*k :` is the key its anchor `&k` holds. Named any other way, a change
 * to such a key adds a second one that shadows it.
 */
export function keyOf(key: unknown, document: Document): string {
  if (isScalar(key) && (key.value === null || typeof key.value !== 'object')) {
    return key.value === null ? '' : String(key.value);
  }
  // An alias or a collection: named by the library itself, as the reader is,
  // from a map holding only this key.
  const alone = new YAMLMap();
  alone.items.push(new Pair(key, null));
  // The library warns on every collection key it names; the reader has
  // already warned once for this block, so naming it again is kept quiet.
  const level = document.options.logLevel;
  document.options.logLevel = 'error';
  try {
    return Object.keys(alone.toJS(document) as object)[0] ?? '';
  } finally {
    document.options.logLevel = level;
  }
}

/**
 * The pair the reader reads for `key`: the last that names it, since a later
 * spelling (`"1":` after `1:`, `"":` after `~:`) replaces an earlier one.
 */
export function pairOf(document: Document, key: string): Pair | undefined {
  return pairsOf(document, key).at(-1);
}

/** Every top-level pair that names `key`, in the order they are written. */
function pairsOf(document: Document, key: string): Pair[] {
  const contents = document.contents;
  if (!isMap(contents)) return [];
  return contents.items.filter((pair) => keyOf(pair.key, document) === key);
}

/** One top-level pair: its name, and which of the pairs with that name it is. */
const idOf = (key: string, occurrence: number) => `${key}\u0000${occurrence}`;

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
  return readsTheSame(pair.value.toJS(document), value);
}

function setKey(document: Document, key: string, value: unknown): void {
  const contents = document.contents;
  const pair = pairOf(document, key);
  if (pair === undefined || !isMap(contents)) {
    // Removing a key that is not there changes nothing — and a block holding
    // only comments has no map for the library to remove it from.
    if (value !== null && value !== undefined) document.set(key, value);
  } else if (value === null || value === undefined) {
    // Every spelling of the key goes, or the reader would read an earlier one.
    const named = new Set(pairsOf(document, key));
    contents.items = contents.items.filter((item) => !named.has(item));
  } else {
    pair.value = reconcile(document, pair.value, value);
  }
}

/**
 * Before `key` is changed, gives every anchor inside it that another key
 * refers to a new home: the first alias of it — a value or a key — becomes a
 * copy of the anchored node, anchor and all, so it and every later alias keep
 * what they read, and no other key is renamed. When the key is `removing`,
 * every pair naming it goes, so an anchor on one of their keys moves too.
 * Returns the pairs whose text that changed.
 */
function releaseAnchors(document: Document, key: string, removing: boolean): string[] {
  const contents = document.contents;
  if (!isMap(contents)) return [];
  const last = pairOf(document, key);
  const edited = removing ? pairsOf(document, key) : last === undefined ? [] : [last];
  const anchored: (Scalar | YAMLMap | YAMLSeq)[] = [];
  const collect = (node: unknown) => {
    if (!isNode(node)) return;
    visit(node, (_, inner) => {
      if (isNode(inner) && !isAlias(inner) && inner.anchor !== undefined) anchored.push(inner);
    });
  };
  for (const pair of edited) {
    if (removing) collect(pair.key);
    collect(pair.value);
  }

  const holders: string[] = [];
  for (const node of anchored) {
    const name = node.anchor as string;
    const holder = () => {
      const copy = node.clone() as typeof node;
      copy.anchor = name;
      return copy;
    };
    const home = contents.items.find((pair) => {
      if (edited.includes(pair)) return false;
      const was = keyOf(pair.key, document);
      if (!rehome(pair, 'key', name, holder)) return rehome(pair, 'value', name, holder);
      // A list or map used as a key through an alias is named `*k` by the
      // reader; written out in its place it would be named by its items.
      if (keyOf(pair.key, document) !== was) {
        throw new Error(
          `Cannot change "${key}": the key "${was}" is an alias of it, and would be renamed`,
        );
      }
      return true;
    });
    if (home !== undefined) {
      delete node.anchor;
      holders.push(idOfPair(document, home));
    }
  }
  return holders;
}

/**
 * Swaps the first alias of `name` on one side of `pair` for `holder()`;
 * whether there was one.
 */
function rehome(pair: Pair, side: 'key' | 'value', name: string, holder: () => Node): boolean {
  const at: unknown = pair[side];
  const refersHere = (alias: unknown) => isAlias(alias) && alias.source === name;
  // A pair's own key or value has no parent for `visit` to swap it in, so it is set directly.
  if (refersHere(at)) {
    pair[side] = holder();
    return true;
  }
  let moved = false;
  if (isNode(at)) {
    visit(at, (_, alias) => {
      // The copy that replaces the alias is visited next; stop there.
      if (moved) return visit.BREAK;
      if (!refersHere(alias)) return undefined;
      moved = true;
      return holder();
    });
  }
  return moved;
}

/** The id of a top-level pair, as {@link segments} cuts the written block. */
function idOfPair(document: Document, pair: Pair): string {
  const named = pairsOf(document, keyOf(pair.key, document));
  return idOf(keyOf(pair.key, document), named.indexOf(pair));
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
  existing.items = existing.items.filter((pair) => Object.hasOwn(value, keyOf(pair.key, document)));
  for (const [key, wanted] of Object.entries(value)) {
    // The last spelling of a key is the one the reader reads.
    const pair = existing.items.findLast((item) => keyOf(item.key, document) === key);
    if (pair === undefined) existing.items.push(document.createPair(key, wanted));
    else pair.value = reconcile(document, pair.value, wanted);
  }
  existing.items = inOrderOf(document, Object.keys(value), existing.items);
}

/**
 * Pairs sorted into `order`. A key like `2024` stays where it was: a
 * JavaScript object lists such keys first whatever order they were written
 * in, so its place in `order` says nothing about where it belongs.
 */
function inOrderOf<Item extends { key: unknown }>(
  document: Document,
  order: readonly string[],
  items: Item[],
): Item[] {
  const nameOf = (item: Item) => keyOf(item.key, document);
  const place = new Map(order.filter((key) => !isIndexKey(key)).map((key, at) => [key, at]));
  const movable = items
    .filter((item) => place.has(nameOf(item)))
    .sort((left, right) => (place.get(nameOf(left)) ?? 0) - (place.get(nameOf(right)) ?? 0));
  let next = 0;
  return items.map((item) => (place.has(nameOf(item)) ? (movable[next++] as Item) : item));
}

const isIndexKey = (key: string) => /^(?:0|[1-9]\d{0,8})$/.test(key);

function sameValue(document: Document, node: unknown, value: unknown): boolean {
  const current: unknown = isNode(node) ? (node as Node).toJS(document) : node;
  return readsTheSame(current, value);
}

/**
 * Whether two values read the same. One that refers to itself — `&e` holding
 * `*e`, or a JavaScript object cycle — has no JSON form, and is compared
 * shape by shape instead, so writing it back unchanged leaves it alone.
 */
function readsTheSame(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    // JSON.stringify throws only on a cycle (or a BigInt, which YAML never reads as).
    return sameShape(left, right, new Map());
  }
}

/**
 * JSON's equality — same keys in the same order, same values — that follows
 * a cycle: a pair of objects already being compared counts as the same.
 * Every pair is remembered, not one partner per object, since cycles of
 * different lengths (`x = [x]` against `y = [[y]]`) pair one object with
 * several and would otherwise alternate for ever.
 */
function sameShape(left: unknown, right: unknown, comparing: Map<object, Set<object>>): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false;
  }
  const partners = comparing.get(left) ?? new Set<object>();
  if (partners.has(right)) return true;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  comparing.set(left, partners.add(right));
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  const at = (value: object, key: string) => (value as Record<string, unknown>)[key];
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && sameShape(at(left, key), at(right, key), comparing),
    )
  );
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isScalarValue = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

/** A block's top-level keys, each with the exact text that writes it. */
interface Segments {
  /** Comments and blank lines before the first key. */
  readonly head: string;
  /** The spaces the keys' lines start with; YAML has every top-level key share them. */
  readonly indent: string;
  /** Each key's name, its {@link idOf} id, its text, and the comment lines that open it. */
  readonly keys: readonly {
    readonly key: string;
    readonly id: string;
    readonly text: string;
    readonly above: string;
  }[];
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
 *
 * The library writes every key at column 0, so a key it wrote is put at the
 * block's own indent, under the comment lines the original key had — those
 * keep their own columns, as every line the change did not reach does. A key
 * given as written is moved from the column it was written at to the block's.
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
  /** Pairs' ids whose text is given, written as that text wherever they stand. */
  asWritten: ReadonlyMap<string, string>;
}): string {
  const before = segments(original);
  const after = segments(written);
  if (after === null) return written;
  if (before === null) {
    // Nothing of the original to keep, but a key given as written is still written so.
    if (asWritten.size === 0) return written;
    const keys = after.keys.map((segment) => {
      const given = asWritten.get(segment.id);
      return given === undefined ? segment.text : shifted(given, -keyColumnOf(given));
    });
    return `${after.head}${keys.join('')}${after.tail}`.replace(/\n$/, '');
  }
  const found = new Map(before.keys.map((segment) => [segment.id, segment]));
  const indent = before.indent.length;
  const keys = after.keys.map((segment) => {
    const given = asWritten.get(segment.id);
    if (given !== undefined) return shifted(given, indent - keyColumnOf(given));
    const original = found.get(segment.id);
    if (original === undefined) return shifted(segment.text, indent);
    if (!touched.has(segment.id)) return original.text;
    return `${original.above}${shifted(segment.text.slice(segment.above.length), indent)}`;
  });
  // The head is comments and blank lines no key owns: no change reaches them.
  return `${before.head}${keys.join('')}${before.tail}`.replace(/\n$/, '');
}

function segments(text: string): Segments | null {
  const source = text.endsWith('\n') ? text : `${text}\n`;
  const document = parseDocument(source);
  const contents = document.contents;
  // A flow map (`{title: Plan}`) holds its keys on shared lines, so it cannot
  // be cut into one run of lines per key; the library writes it back whole,
  // in its own flow style, which leaves an untouched key as it was.
  if (!isMap(contents) || contents.flow === true || contents.items.length === 0) return null;
  const lines: number[] = [];
  for (const pair of contents.items) {
    if (!isNode(pair.key) || pair.key.range === undefined || pair.key.range === null) return null;
    lines.push(source.lastIndexOf('\n', pair.key.range[0] - 1) + 1);
  }
  const indent = /^ */.exec(source.slice(lines[0]))?.[0] ?? '';
  const starts = lines.map((line) => withCommentsAbove(source, line, indent.length));
  const last = contents.items[contents.items.length - 1] as Pair;
  const end = lineEnd(source, isNode(last.value) ? last.value.range : (last.key as Node).range);
  const seen = new Map<string, number>();
  const keys = contents.items.map((pair, at) => {
    const key = keyOf(pair.key, document);
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return {
      key,
      id: idOf(key, occurrence),
      text: source.slice(starts[at], starts[at + 1] ?? end),
      above: source.slice(starts[at], lines[at]),
    };
  });
  return { head: source.slice(0, starts[0]), indent, keys, tail: source.slice(end) };
}

/**
 * Where a key's line starts, moved up over the comment lines that open it: of
 * the comment lines directly above it, the ones from the first that is no
 * deeper than the keys. As the library reads them, comments deeper than the
 * keys before that one end the value above (or head the block); every comment
 * from it on belongs to the key below, whatever its column.
 */
function withCommentsAbove(source: string, lineStart: number, indent: number): number {
  let start = lineStart;
  let opens = lineStart;
  while (start > 0) {
    const previous = source.lastIndexOf('\n', start - 2) + 1;
    const comment = /^( *)#/.exec(source.slice(previous, start));
    if (comment === null) break;
    start = previous;
    if ((comment[1]?.length ?? 0) <= indent) opens = start;
  }
  return opens;
}

/** The column a key's text writes its key at: its first line that is neither blank nor a comment. */
function keyColumnOf(text: string): number {
  const line = /^(?! *(?:#|$))( *)/m.exec(text);
  return line?.[1]?.length ?? 0;
}

/**
 * Text moved `by` columns: right by prefixing every non-empty line, left by
 * taking up to that many leading spaces off each — a comment standing left of
 * the key keeps what it has. Moving a key's text by the difference between
 * two indents writes it at the other, its lines still deep as they were.
 */
function shifted(text: string, by: number): string {
  if (by > 0) return text.replace(/^(?=.)/gm, ' '.repeat(by));
  if (by < 0) return text.replace(new RegExp(`^ {1,${-by}}`, 'gm'), '');
  return text;
}

/** Just past the newline that ends a node's value (and its comment on the same line). */
export function lineEnd(source: string, range: Node['range'] | undefined): number {
  const at = range?.[1] ?? source.length;
  if (source[at - 1] === '\n') return at;
  const newline = source.indexOf('\n', at);
  return newline === -1 ? source.length : newline + 1;
}

const DEFAULT_OPENING = '---\n';
const DEFAULT_CLOSING = '---\n';

export function split(frontmatter: string | null): {
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
