import { Document, isMap, isNode, isScalar, parseDocument, type Node, type Pair } from 'yaml';
import { frontmatterProblem, parseFrontmatterProperties } from './frontmatter.ts';
import { columnOf, lineEnd, pairOf, split, updateFrontmatter } from './frontmatter-write.ts';

/**
 * Adds `entries` at the end of the map `key` holds, leaving every line the
 * block had exactly as it was: the new keys are lines put in after the map's
 * last one, at its indentation, and nothing else is written. A block with no
 * `key` yet, or one holding nothing, gains it the same way, when the writer's
 * own output only adds lines.
 *
 * Null when that cannot be done — `key` holds a list or a sentence, an inline
 * `{…}` map, a key `entries` names already (as an alias, a number or a
 * boolean too), a block that is not a map, or YAML that cannot be read — so
 * the caller leaves the file alone rather than rewriting a line of it. What is
 * returned is checked: it reads back as the block did, with `entries` added.
 */
export function addToFrontmatterMap(
  frontmatter: string,
  key: string,
  entries: Readonly<Record<string, unknown>>,
): string | null {
  if (frontmatterProblem(frontmatter) !== null || !holdsMapAt(frontmatter, key)) return null;
  const read = parseFrontmatterProperties(frontmatter);
  const held = isPlainObject(read[key]) ? read[key] : {};
  if (Object.keys(held).some((name) => Object.hasOwn(entries, name))) return null;
  const expected = { ...read, [key]: { ...held, ...entries } };
  const written =
    linesAddedToBlockMap(frontmatter, key, entries) ??
    updateFrontmatter(frontmatter, { [key]: expected[key] });
  return readsBackAs(written, expected) && onlyAddsLines(frontmatter, written) ? written : null;
}

/**
 * Whether the block is empty or a map, and `key` is absent, empty or a map:
 * the only shapes that can gain keys. A list or a sentence would have a map
 * written over it, and a block that is not a map cannot be given a key at all.
 */
function holdsMapAt(frontmatter: string, key: string): boolean {
  const { body } = split(frontmatter);
  if (body.trim() === '') return true;
  const document = parseDocument(body.replace(/\r\n/g, '\n'));
  if (!isKeyedMap(document.contents)) return false;
  const value = pairOf(document, key)?.value;
  return (
    value === undefined ||
    value === null ||
    isKeyedMap(value) ||
    (isScalar(value) && value.value === null)
  );
}

/** A map of keys to values — not `!!set`, which YAML holds as a map of keys alone. */
const isKeyedMap = (node: unknown) => isMap(node) && node.tag !== 'tag:yaml.org,2002:set';

/**
 * Whether `written` reads back as `expected`. A block that cannot be compared —
 * a self-referring anchor has no JSON form — is not one this can vouch for.
 */
function readsBackAs(written: string, expected: Record<string, unknown>): boolean {
  try {
    return (
      frontmatterProblem(written) === null &&
      JSON.stringify(parseFrontmatterProperties(written)) === JSON.stringify(expected)
    );
  } catch {
    return false;
  }
}

/**
 * `entries` written as lines after the last of the block map `key` holds, at
 * the column its keys stand at and indented within by the step it uses; null
 * when `key` does not hold a block map with keys in it.
 */
function linesAddedToBlockMap(
  frontmatter: string,
  key: string,
  entries: Readonly<Record<string, unknown>>,
): string | null {
  const { opening, body } = split(frontmatter);
  const source = `${body.replace(/\r\n/g, '\n')}\n`;
  const pair = pairOf(parseDocument(source), key);
  const map = pair?.value;
  if (!isMap(map) || map.flow === true || !isNode(pair?.key)) return null;
  const first = map.items[0];
  const last = map.items[map.items.length - 1];
  if (first === undefined || last === undefined || !isNode(first.key)) return null;
  const keyColumn = columnOf(source, pair.key.range?.[0]);
  const column = columnOf(source, first.key.range?.[0]);
  if (keyColumn === null || column === null || column <= keyColumn) return null;

  const eol = opening.endsWith('\r\n') ? '\r\n' : '\n';
  const lines = new Document(entries)
    .toString({ indent: column - keyColumn, lineWidth: 0, flowCollectionPadding: false })
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => `${' '.repeat(column)}${line}`);
  const after = linesBefore(source, endOf(source, last));
  const kept = body.split(/(?<=\n)/);
  if (after >= kept.length) {
    return `${frontmatter.slice(0, opening.length + body.length)}${eol}${lines.join(eol)}${frontmatter.slice(opening.length + body.length)}`;
  }
  const at = opening.length + kept.slice(0, after).join('').length;
  return `${frontmatter.slice(0, at)}${lines.join(eol)}${eol}${frontmatter.slice(at)}`;
}

/** Just past the line that ends a pair's value, or its key when it has none. */
function endOf(source: string, pair: Pair): number {
  const node = isNode(pair.value) ? pair.value : (pair.key as Node);
  return lineEnd(source, node.range);
}

/** How many whole lines come before `offset`, which is at the start of a line. */
const linesBefore = (source: string, offset: number) =>
  source.slice(0, offset).split('\n').length - 1;

/** Whether `after` is `before` with one run of whole lines put in, and nothing else changed. */
function onlyAddsLines(before: string, after: string): boolean {
  const was = before.split(/(?<=\n)/);
  const now = after.split(/(?<=\n)/);
  let head = 0;
  while (head < was.length && was[head] === now[head]) head += 1;
  let tail = 0;
  while (
    tail < was.length - head &&
    tail < now.length - head &&
    was[was.length - 1 - tail] === now[now.length - 1 - tail]
  ) {
    tail += 1;
  }
  return head + tail === was.length;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
