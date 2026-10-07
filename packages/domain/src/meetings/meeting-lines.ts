import { blockIdAtEnd } from '../markdown/block-anchor.ts';

/** One line of a file, its text without the line break, and its 1-based number. */
export interface NumberedLine {
  readonly text: string;
  readonly line: number;
}

/** A run of non-blank lines: one markdown block, as the contract writes them. */
export interface LineBlock {
  readonly text: string;
  readonly line: number;
}

/**
 * The lines of `text`, numbered from `firstLine`. A Windows line end's `\r` is
 * left off the text, as it ends nothing a rule here reads.
 */
export function numberedLines(text: string, firstLine: number): NumberedLine[] {
  return text.split('\n').map((raw, index) => ({
    text: raw.endsWith('\r') ? raw.slice(0, -1) : raw,
    line: firstLine + index,
  }));
}

/** The blocks of `text`: runs of non-blank lines, joined by `\n`, with the line each starts on. */
export function lineBlocks(text: string, firstLine: number): LineBlock[] {
  const blocks: LineBlock[] = [];
  let current: NumberedLine[] = [];
  const close = () => {
    const first = current[0];
    if (first !== undefined) {
      blocks.push({ text: current.map((each) => each.text).join('\n'), line: first.line });
    }
    current = [];
  };
  for (const each of numberedLines(text, firstLine)) {
    if (each.text.trim() === '') close();
    else current.push(each);
  }
  close();
  return blocks;
}

/** The block id that ends `text` (ADR-0022), and the text before it. */
export function withoutBlockId(text: string): {
  readonly rest: string;
  readonly blockId: string | null;
} {
  const anchor = blockIdAtEnd(text);
  return anchor === null
    ? { rest: text, blockId: null }
    : { rest: text.slice(0, anchor.start), blockId: anchor.id };
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/** Which lines are fenced code, fences included, and the fence left open at the end, if any. */
export interface FenceReading {
  readonly fenced: readonly boolean[];
  readonly unclosed: NumberedLine | null;
}

/**
 * The fenced code in `lines`, as CommonMark reads it: a fence of three or more
 * backticks or tildes is closed only by a fence of the same character, at
 * least as long, with nothing after it.
 */
export function readFences(lines: readonly NumberedLine[]): FenceReading {
  const fenced: boolean[] = [];
  let open: { readonly fence: string; readonly line: NumberedLine } | null = null;
  for (const each of lines) {
    if (open === null) {
      const opening = FENCE_OPEN.exec(each.text);
      const fence = opening?.[1];
      // A backtick fence's info string cannot hold a backtick.
      const isFence =
        fence !== undefined && !(fence.startsWith('`') && opening?.[2]?.includes('`'));
      if (isFence) open = { fence, line: each };
      fenced.push(open !== null);
      continue;
    }
    fenced.push(true);
    const fence = FENCE_CLOSE.exec(each.text)?.[1];
    const closes = fence?.[0] === open.fence[0] && (fence?.length ?? 0) >= open.fence.length;
    if (closes) open = null;
  }
  return { fenced, unclosed: open?.line ?? null };
}
