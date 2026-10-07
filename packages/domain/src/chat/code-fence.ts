/**
 * Where a streamed markdown reply is inside a fenced code block (``` or ~~~),
 * as CommonMark reads one: a model shows a tool call there as an example, and
 * an example is not a call.
 */

interface OpenFence {
  readonly marker: string;
  readonly length: number;
}

/** A fence line: up to three spaces, then three or more of one marker, then anything. */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_START = /^ {0,3}(`{3,}|~{3,})/;

export interface CodeFenceTracker {
  /** Takes the next run of the reply's text, in order. */
  advance(text: string): void;
  /** Whether what comes next sits in code: inside a fence, or on a fence's own line. */
  inCode(): boolean;
}

export function createCodeFenceTracker(): CodeFenceTracker {
  let open: OpenFence | null = null;
  let line = '';
  return {
    advance(text) {
      const lines = `${line}${text}`.split('\n');
      line = lines.pop() ?? '';
      for (const complete of lines) open = fenceAfter(open, complete);
    },
    inCode: () => open !== null || FENCE_START.test(line),
  };
}

function fenceAfter(open: OpenFence | null, line: string): OpenFence | null {
  const match = FENCE_LINE.exec(line.replace(/\r$/, ''));
  const run = match?.[1] ?? '';
  const rest = match?.[2] ?? '';
  const marker = run.charAt(0);
  if (open !== null) {
    const closes = marker === open.marker && run.length >= open.length && rest.trim() === '';
    return closes ? null : open;
  }
  // A backtick fence's info string may not hold a backtick; that line is inline code.
  if (match === null || (marker === '`' && rest.includes('`'))) return null;
  return { marker, length: run.length };
}
