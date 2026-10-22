/*
 * Which `%%` of a comment Obsidian would read as a comment's start or end
 * (ADR-0043 §2): those in text, counted the way `noteBlocks` counts them in
 * the note — never inside a fence, an indented code block, an inline code
 * span or HTML, and one `%%` per pair of `%` in a run (`%%%` is one mark and
 * a stray `%`). A balanced comment cannot hide what comes after it, so only
 * an odd count is escaped. This reads a comment on its own, an approximation
 * of the parser that reads the note (as Obsidian's own reading is of it).
 */

interface PercentRun {
  readonly start: number;
  readonly end: number;
}

const FENCE_OPEN = /^[ \t]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/;
const INLINE_HTML = /<!--[\s\S]*?-->|<\/?[A-Za-z][^>\n]*>/y;
const marksIn = (run: PercentRun): number => Math.floor((run.end - run.start) / 2);

/** The comment's lines with the `%%` that would leave a comment open past it escaped as `%\%`. */
export function escapeUnbalancedMarks(lines: readonly string[]): string[] {
  if (lines.length === 0) return [];
  const text = lines.join('\n');
  const runs = percentRunsOutsideCode(lines, text);
  let odd = runs.reduce((sum, run) => sum + marksIn(run), 0) % 2 === 1;
  let escaped = text;
  for (const run of [...runs].reverse()) {
    if (!odd) break;
    const marks = marksIn(run);
    if (marks === 0) continue;
    escaped = `${escaped.slice(0, run.start)}%${'\\%'.repeat(run.end - run.start - 1)}${escaped.slice(run.end)}`;
    odd = marks % 2 === 0;
  }
  return escaped.split('\n');
}

/** The runs of `%` in text, by offset in the lines joined with `\n`. */
function percentRunsOutsideCode(lines: readonly string[], text: string): PercentRun[] {
  const runs: PercentRun[] = [];
  let fence: { char: string; length: number } | null = null;
  let previous: 'blank' | 'paragraph' | 'code' = 'blank';
  let offset = 0;
  let paragraph: { start: number; end: number } | null = null;
  const endParagraph = () => {
    if (paragraph !== null) runs.push(...percentRunsOfParagraph(text, paragraph));
    paragraph = null;
  };
  lines.forEach((line) => {
    const lineStart = offset;
    offset += line.length + 1;
    if (fence !== null) {
      const closes = new RegExp(`^[ \\t]*${fence.char}{${fence.length},}[ \\t]*$`).test(line);
      if (closes) fence = null;
      return;
    }
    if (line.trim() === '') {
      endParagraph();
      previous = 'blank';
      return;
    }
    const opens = fenceOpenedBy(line);
    if (opens !== null) {
      endParagraph();
      fence = opens;
      previous = 'code';
      return;
    }
    if (/^( {4}|\t)/.test(line) && previous !== 'paragraph') {
      previous = 'code';
      return;
    }
    previous = 'paragraph';
    paragraph = { start: paragraph?.start ?? lineStart, end: lineStart + line.length };
  });
  endParagraph();
  return runs;
}

function fenceOpenedBy(line: string): { char: string; length: number } | null {
  const match = FENCE_OPEN.exec(line);
  const marks = match?.[1];
  if (marks === undefined) return null;
  // A backtick fence's info string holds no backtick; otherwise it is an inline code span.
  if (marks.startsWith('`') && (match?.[2] ?? '').includes('`')) return null;
  return { char: marks.charAt(0), length: marks.length };
}

/** Walks the paragraph's text, skipping code spans and inline HTML. */
function percentRunsOfParagraph(text: string, span: { start: number; end: number }): PercentRun[] {
  const runs: PercentRun[] = [];
  let at = span.start;
  while (at < span.end) {
    const char = text.charAt(at);
    if (char === '\\' && '`<'.includes(text.charAt(at + 1))) at += 2;
    else if (char === '`') at = afterCodeSpan(text, at, span.end);
    else if (char === '<') at = afterInlineHtml(text, at);
    else if (char === '%') {
      const end = runEnd(text, at, '%', span.end);
      runs.push({ start: at, end });
      at = end;
    } else at += 1;
  }
  return runs;
}

function runEnd(text: string, from: number, char: string, limit: number): number {
  let end = from;
  while (end < limit && text.charAt(end) === char) end += 1;
  return end;
}

/** Past the span a run of backticks opens, or past the run itself when no run of the same length closes it. */
function afterCodeSpan(text: string, from: number, limit: number): number {
  const opening = runEnd(text, from, '`', limit);
  const length = opening - from;
  for (let at = opening; at < limit;) {
    if (text.charAt(at) !== '`') at += 1;
    else {
      const end = runEnd(text, at, '`', limit);
      if (end - at === length) return end;
      at = end;
    }
  }
  return opening;
}

function afterInlineHtml(text: string, from: number): number {
  INLINE_HTML.lastIndex = from;
  const match = INLINE_HTML.exec(text);
  return match === null ? from + 1 : from + match[0].length;
}
