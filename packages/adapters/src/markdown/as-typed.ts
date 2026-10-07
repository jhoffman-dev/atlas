import type { Nodes, Root } from 'mdast';
import { readsAs, type Reading } from './reading.ts';

/** Markdown parsed once: its tree, and what it reads as to the editor. */
export interface ReadMarkdown {
  readonly root: Root;
  readonly reading: Reading;
}

/** One block, as `writeAsTyped` needs it. */
export interface BlockToWrite {
  /**
   * Remark's own rendering, every escape in place — what the block was always
   * written as, and what is written when nothing closer to what was typed
   * reads right.
   */
  readonly safe: string;
  /** As `safe`, but with typed addresses bare and links as their own bytes. */
  readonly typed: string;
  /** What the editor holds for the block: the reading every candidate must match. */
  readonly document: Reading;
  /** Parses markdown for the block, with whatever else in the note decides how it reads. */
  readonly read: (markdown: string) => ReadMarkdown;
}

/**
 * A block's markdown as close to what was typed as it can be written without
 * reading any differently from the document (A21-01). Remark escapes every
 * character that could start markup somewhere — `julie\@example.com`, `\[x]`,
 * `AT\&T` — and writes a link the editor made of a typed address as
 * `<julie@example.com>`. Each candidate that undoes some of that is kept only
 * if it reads back exactly as the editor's document; otherwise `safe` is.
 *
 * A bounded number of parses per block, however many escapes it holds.
 */
export function writeAsTyped(block: BlockToWrite): string {
  const { safe, typed } = block;
  if (typed === safe && !safe.includes('\\')) return safe;
  const bases = typed === safe ? [safe] : [typed, safe];
  for (const base of bases) {
    const written = leastEscaped(base, block);
    if (written !== null) return written;
  }
  return safe;
}

/**
 * `base` with as few of its escapes as read the same, or null if not even
 * `base` reads as the document. Three parses at most: `base`, with no escapes,
 * and with only the escapes whose character was markup when bare.
 */
function leastEscaped(base: string, block: BlockToWrite): string | null {
  const reads = (read: ReadMarkdown) => readsAs(read.reading, block.document);
  if (!base.includes('\\')) return base === block.safe || reads(block.read(base)) ? base : null;
  const escaped = block.read(base);
  const offsets = escapeOffsets(escaped.root, base);
  if (offsets.length > 0) {
    const bare = removeAt(base, offsets);
    const bareRead = block.read(bare);
    if (reads(bareRead)) return bare;
    const needed = markupWhenBare(bareRead.root, bare, offsets);
    if (needed.size > 0 && needed.size < offsets.length) {
      const fewer = removeAt(
        base,
        offsets.filter((offset) => !needed.has(offset)),
      );
      if (reads(block.read(fewer))) return fewer;
    }
  }
  return reads(escaped) ? base : null;
}

/** A backslash before ASCII punctuation: the only escapes remark writes in text. */
const isEscapable = (code: number) =>
  (code >= 0x21 && code <= 0x2f) ||
  (code >= 0x3a && code <= 0x40) ||
  (code >= 0x5b && code <= 0x60) ||
  (code >= 0x7b && code <= 0x7e);

/**
 * Where the backslash escapes are in the block, in order. Those in code, raw
 * HTML, a link's or an image's own bytes are not escapes, or are left alone:
 * a link kept as its bytes is written back escapes and all (ADR-0003).
 *
 * Scanned from the markdown rather than read off its text nodes, which lose
 * their positions when GFM finds an address among escapes.
 */
function escapeOffsets(root: Root, markdown: string): number[] {
  const found: number[] = [];
  let at = 0;
  for (const [start, end] of opaqueRanges(root, markdown)) {
    found.push(...escapesBetween(markdown, at, Math.min(start, markdown.length)));
    at = Math.max(at, end);
  }
  found.push(...escapesBetween(markdown, at, markdown.length));
  return found;
}

function escapesBetween(markdown: string, start: number, end: number): number[] {
  const found: number[] = [];
  for (let at = start; at < end - 1; at += 1) {
    if (markdown[at] === '\\' && isEscapable(markdown.charCodeAt(at + 1))) {
      found.push(at);
      at += 1;
    }
  }
  return found;
}

/** Nodes whose bytes are not text, or are kept as they were written. */
const OPAQUE: ReadonlySet<string> = new Set([
  'code',
  'inlineCode',
  'html',
  'linkReference',
  'image',
  'imageReference',
  'definition',
  'footnoteReference',
  'wikiLink',
]);

/**
 * The spans of `markdown`, in order, that `escapeOffsets` leaves alone. A
 * link counts when it is written as one — `[text](url)` or `<url>` — rather
 * than found by GFM in text, where an escape is only text's.
 */
function opaqueRanges(root: Root, markdown: string): [number, number][] {
  const ranges: [number, number][] = [];
  const visit = (node: Nodes) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    const written = node.type === 'link' && start !== undefined && '[<'.includes(markdown[start]!);
    if ((OPAQUE.has(node.type) || written) && start !== undefined && end !== undefined) {
      ranges.push([start, end]);
      return;
    }
    if ('children' in node) (node.children as Nodes[]).forEach(visit);
  };
  visit(root);
  return ranges.sort((a, b) => a[0] - b[0]);
}

/**
 * The escapes, by their offset in the escaped markdown, whose character in
 * `bare` is not plain text: it opened emphasis, a link, a heading, an entity.
 * One walk of the bare tree, whatever the number of escapes.
 */
function markupWhenBare(root: Root, bare: string, offsets: readonly number[]): Set<number> {
  const literal = literalRanges(root, bare);
  const needed = new Set<number>();
  let range = 0;
  offsets.forEach((offset, removedBefore) => {
    // Each escape removed ahead of this one moves its character back by one.
    const at = offset - removedBefore;
    while (range < literal.length && literal[range]![1] <= at) range += 1;
    const inside = range < literal.length && literal[range]![0] <= at;
    if (!inside) needed.add(offset);
  });
  return needed;
}

/**
 * The spans of `markdown` that read as exactly their own characters, in order.
 * Text whose value differs from its bytes — an entity, a quote's markers — is
 * left out, so an escape there is kept.
 */
function literalRanges(root: Root, markdown: string): [number, number][] {
  const ranges: [number, number][] = [];
  const visit = (node: Nodes) => {
    if (node.type === 'text') {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined && markdown.slice(start, end) === node.value)
        ranges.push([start, end]);
      return;
    }
    if ('children' in node) (node.children as Nodes[]).forEach(visit);
  };
  visit(root);
  return ranges.sort((a, b) => a[0] - b[0]);
}

/** `markdown` without the code units at `offsets`, which are in ascending order. */
function removeAt(markdown: string, offsets: readonly number[]): string {
  const pieces: string[] = [];
  let from = 0;
  for (const offset of offsets) {
    pieces.push(markdown.slice(from, offset));
    from = offset + 1;
  }
  pieces.push(markdown.slice(from));
  return pieces.join('');
}
