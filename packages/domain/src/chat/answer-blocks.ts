/**
 * An answer's markdown, cut into the blocks the citation check judges one by
 * one (#37): paragraphs, list items, quotes and tables say something, so each
 * must cite where it came from; headings, rules and fenced code do not.
 *
 * This is not a markdown parser. It reads the shapes a model writes an answer
 * in — the line kinds CommonMark starts a block with — and nothing it cannot
 * read is lost: every line of the answer lands in some block, as text.
 */

export type AnswerBlockKind =
  'paragraph' | 'item' | 'quote' | 'table' | 'heading' | 'rule' | 'code';

/** One block of an answer, with its markers taken off: what the block says, as written. */
export interface RawAnswerBlock {
  readonly kind: AnswerBlockKind;
  /** The block's text: a quote without its `>`, an item without its marker, code without its fences. */
  readonly text: string;
  /** A list item's marker as written (`-`, `2.`); null for every other block. */
  readonly marker: string | null;
  /** How deep a list item is nested, from 0; 0 for every other block. */
  readonly depth: number;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const RULE = /^ {0,3}([-*_])(?: *\1){2,} *$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(?:\s+(.*))?$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const TABLE = /^\s*\|/;

/** What the block being read is, while lines may still join it. */
interface Open {
  kind: 'paragraph' | 'item' | 'quote' | 'table';
  lines: string[];
  marker: string | null;
  depth: number;
  /** Where an item's own text starts: a later line indented this far is still the item. */
  indent: number;
  /** A blank line came after it: only an indented line, for an item, may still join it. */
  broken: boolean;
}

/** Cuts an answer into its blocks, in order. */
export function answerBlocks(answer: string): RawAnswerBlock[] {
  const reader = new BlockReader();
  const lines = answer.replace(/\r\n?/g, '\n').split('\n');
  for (let at = 0; at < lines.length; at += 1) at = reader.line(lines, at);
  return reader.finish();
}

class BlockReader {
  private readonly blocks: RawAnswerBlock[] = [];
  private open: Open | null = null;
  /** The indent of each list level still open, outermost first. */
  private levels: number[] = [];

  /** Reads the line at `at`; returns the last line it took (a fence takes several). */
  line(lines: readonly string[], at: number): number {
    const line = lines[at] as string;
    if (line.trim() === '') return this.blank(at);
    const fence = FENCE.exec(line);
    if (fence !== null) return this.fence(lines, at, fence[1] as string);
    if (HEADING.test(line)) return this.alone('heading', headingText(line), at);
    if (RULE.test(line)) return this.alone('rule', line.trim(), at);
    const item = ITEM.exec(line);
    if (item !== null) return this.item(item, at);
    const quote = QUOTE.exec(line);
    if (quote !== null) return this.quote(quote[1] as string, at);
    if (TABLE.test(line)) return this.table(line, at);
    return this.text(line, at);
  }

  finish(): RawAnswerBlock[] {
    this.close();
    return this.blocks;
  }

  private blank(at: number): number {
    if (this.open === null) return at;
    if (this.open.kind === 'item') this.open.broken = true;
    else this.close();
    return at;
  }

  private fence(lines: readonly string[], at: number, opener: string): number {
    this.close();
    this.levels = [];
    const closer = new RegExp(`^ {0,3}${opener[0] === '`' ? '`' : '~'}{${opener.length},}\\s*$`);
    let end = at + 1;
    while (end < lines.length && !closer.test(lines[end] as string)) end += 1;
    this.push({ kind: 'code', text: lines.slice(at + 1, end).join('\n'), marker: null, depth: 0 });
    // An unclosed fence runs to the end of the answer.
    return Math.min(end, lines.length - 1);
  }

  private alone(kind: 'heading' | 'rule', text: string, at: number): number {
    this.close();
    this.levels = [];
    this.push({ kind, text, marker: null, depth: 0 });
    return at;
  }

  private item(match: RegExpExecArray, at: number): number {
    this.close();
    const indent = (match[1] as string).length;
    // An item is nested in the one above while it starts at or past that item's text.
    while (this.levels.length > 0 && (this.levels.at(-1) as number) > indent) this.levels.pop();
    const depth = this.levels.length;
    const marker = match[2] as string;
    const textAt = indent + marker.length + 1;
    this.levels.push(textAt);
    this.open = { ...opened('item', match[3] ?? ''), marker, depth, indent: textAt };
    return at;
  }

  private quote(text: string, at: number): number {
    if (this.open?.kind !== 'quote') this.begin('quote');
    this.open?.lines.push(text);
    return at;
  }

  private table(line: string, at: number): number {
    if (this.open?.kind !== 'table') this.begin('table');
    this.open?.lines.push(line.trim());
    return at;
  }

  private text(line: string, at: number): number {
    const open = this.open;
    const indent = line.length - line.trimStart().length;
    if (open?.kind === 'item' && (!open.broken || indent >= open.indent)) {
      open.lines.push(open.broken ? `\n${line.trim()}` : line.trim());
      open.broken = false;
      return at;
    }
    // A lazy line carries on the paragraph or quote it follows, as CommonMark reads it.
    if (open !== null && open.kind !== 'item' && open.kind !== 'table') {
      open.lines.push(line.trim());
      return at;
    }
    this.begin('paragraph');
    this.levels = [];
    this.open?.lines.push(line.trim());
    return at;
  }

  private begin(kind: Open['kind']): void {
    this.close();
    if (kind !== 'paragraph') this.levels = [];
    this.open = opened(kind, null);
  }

  private close(): void {
    const open = this.open;
    if (open === null) return;
    this.open = null;
    this.push({
      kind: open.kind,
      text: open.lines.join('\n'),
      marker: open.marker,
      depth: open.depth,
    });
  }

  private push(block: RawAnswerBlock): void {
    this.blocks.push(block);
  }
}

/** A heading without its `#` marks, before and closing. */
function headingText(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/\s+#+$/, '');
}

function opened(kind: Open['kind'], first: string | null): Open {
  return {
    kind,
    lines: first === null ? [] : [first],
    marker: null,
    depth: 0,
    indent: 0,
    broken: false,
  };
}
