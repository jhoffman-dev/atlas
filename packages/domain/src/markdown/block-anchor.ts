/*
 * Block ids (P26-01, ADR-0022): Obsidian's `^abc123`, which names one block
 * so a link can point at it — `[[Note#^abc123]]` — or show it in place,
 * `![[Note#^abc123]]`. An id is written only when something first refers to
 * the block, and never otherwise: a note nobody links into keeps its bytes.
 *
 * A paragraph, a heading or a list item carries its id at the end of its own
 * text, after a space, as Obsidian writes it:
 *
 *     The plan, roughly. ^f3k9x2
 *     ## Packing ^h2k8d1
 *     - Pack the tent ^a81b0c
 *
 * Any other block — a table, a quote, a callout, code — carries it on a line
 * of its own after it, a blank line between, as Obsidian writes one:
 *
 *     | a | b |
 *     | - | - |
 *
 *     ^q7w2e4
 *
 * These are the rules, read the same by the editor, the index and a write to
 * another note. What counts as a block is the markdown reader's to say.
 */

/** The editor attribute a block's id is held in, off its text. */
export const BLOCK_ANCHOR_ATTR = 'anchor';

/** How long a new id is: six of `ID_ALPHABET`, as Obsidian makes them. */
export const NEW_BLOCK_ID_LENGTH = 6;

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ID = /^[A-Za-z0-9-]+$/;
const STANDALONE = /^\^([A-Za-z0-9-]+)[ \t]*$/;

/** Where an id ends a block's text: its id, and where the space before it starts. */
export interface TrailingAnchor {
  readonly id: string;
  /** The offset of the whitespace before the `^`: what is cut to take the id off. */
  readonly start: number;
  /**
   * The offset of the one space, tab or line break an id is written after
   * (`blockAnchorSuffix`): any other whitespace before it is the text's own.
   */
  readonly separator: number;
}

/**
 * The id that ends a run of text — ` ^id` after a space, a tab or a line
 * break — whether or not words come before it: the last piece of a
 * paragraph's text, say, after a link. `trailingBlockAnchor` is the rule for
 * a whole block.
 */
export function blockIdAtEnd(text: string): TrailingAnchor | null {
  let end = text.length;
  // A line of a note saved on Windows ends in `\r`, which ends no id.
  while (end > 0 && (isSpace(text[end - 1]) || text[end - 1] === '\r')) end -= 1;
  const caret = text.lastIndexOf('^', end - 1);
  if (caret < 1 || !isBlockId(text.slice(caret + 1, end))) return null;
  const before = text[caret - 1];
  if (!isSpace(before) && before !== '\n') return null;
  const separator = before === '\n' && text[caret - 2] === '\r' ? caret - 2 : caret - 1;
  let start = separator;
  while (start > 0 && isSpace(text[start - 1])) start -= 1;
  if (before !== '\n' && start > 0 && text[start - 1] === '\n') {
    start -= text[start - 2] === '\r' ? 2 : 1;
    while (start > 0 && isSpace(text[start - 1])) start -= 1;
  }
  return { id: text.slice(caret + 1, end), start, separator };
}

/** Whether `text` can be a block id: letters, digits and dashes, and at least one. */
export function isBlockId(text: string): boolean {
  return ID.test(text);
}

/**
 * The id at the end of a paragraph's or a list item's text — ` ^id`, after a
 * space, a tab or a line break, then nothing but spaces — or null. Text must
 * come before it: a block that is only `^id` is `standaloneBlockAnchor`'s.
 * An escaped caret, `\^id`, is text.
 */
export function trailingBlockAnchor(source: string): TrailingAnchor | null {
  const anchor = blockIdAtEnd(source);
  return anchor === null || source.slice(0, anchor.start).trim() === '' ? null : anchor;
}

/**
 * Whether any line of `markdown` ends as an id would — cheaply, before
 * anything is parsed. A note with none holds no block ids; one with some may.
 */
export function mayHoldBlockIds(markdown: string): boolean {
  if (!markdown.includes('^')) return false;
  return markdown
    .split('\n')
    .some((line) => blockIdAtEnd(line) !== null || standaloneBlockAnchor(line.trim()) !== null);
}

/**
 * The id a paragraph that is only `^id` gives the block before it, or null.
 * Whether there is a block before it that takes one is the reader's to say.
 */
export function standaloneBlockAnchor(source: string): string | null {
  return STANDALONE.exec(source)?.[1] ?? null;
}

/**
 * How an id is written: after a paragraph's or an item's text (`inline`), or
 * on a line of its own after any other block (`line`), in the note's own
 * line ending.
 */
export type AnchorStyle = 'inline' | 'line';

export function blockAnchorSuffix(
  id: string,
  style: AnchorStyle,
  lineEnding: '\n' | '\r\n' = '\n',
): string {
  return style === 'inline' ? ` ^${id}` : `${lineEnding}${lineEnding}^${id}`;
}

/**
 * A new id no block in the note has yet: six lower-case letters and digits,
 * drawn from `random` (a number in [0, 1), as the app's random source gives).
 */
export function newBlockId(random: () => number, taken: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let id = '';
    for (let index = 0; index < NEW_BLOCK_ID_LENGTH; index += 1) {
      const pick = Math.min(ID_ALPHABET.length - 1, Math.floor(random() * ID_ALPHABET.length));
      id += ID_ALPHABET[pick];
    }
    if (!taken.has(id)) return id;
  }
  // Two billion ids and a note of a few hundred blocks: only a random source
  // that repeats itself gets here, and looping on it would hang the app.
  throw new Error('No new block id could be drawn.');
}

const MAX_ATTEMPTS = 1000;

const isSpace = (char: string | undefined): boolean => char === ' ' || char === '\t';
