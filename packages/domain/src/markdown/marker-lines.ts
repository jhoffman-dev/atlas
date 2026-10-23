import { standaloneBlockAnchor, trailingBlockAnchor } from './block-anchor.ts';

/*
 * DFAI's markers (ADR-0042) are HTML comments that start `atlas:` — a
 * highlight's anchor, a removed highlight's tombstone, a ledger's version —
 * which every reader hides. A marker on a line of its own, quoted or not, is
 * that line's whole content; one after other words (a bookmark's) is not.
 */
const MARKER_LINE = /^(?:[ \t]*>)*[ \t]*<!--[ \t]*atlas:(?:(?!-->)[^\r\n])*-->[ \t]*\r?$/;

/**
 * `markdown` without its marker lines: what a person reading it sees, for a
 * paste into another app. Nothing when it held markers alone; other lines
 * are kept as written, line endings and all.
 */
export function withoutMarkerLines(markdown: string): string {
  const kept = markdown.split('\n').filter((line) => !MARKER_LINE.test(line));
  if (kept.every((line) => line.trim() === '')) return '';
  return kept.join('\n').replace(/\r$/, '');
}

/**
 * `markdown` without its block ids (ADR-0022): each line's ` ^id`, and each
 * line that is only `^id` with the blank lines before it. A source pasted
 * with an id would give the note a second block of that id.
 */
export function withoutBlockIds(markdown: string): string {
  const kept: string[] = [];
  for (const line of markdown.split('\n')) {
    const bare = line.replace(/\r$/, '');
    if (standaloneBlockAnchor(bare.trim()) !== null) {
      while (kept.length > 0 && kept[kept.length - 1]?.trim() === '') kept.pop();
      continue;
    }
    const anchor = trailingBlockAnchor(bare);
    kept.push(anchor === null ? line : bare.slice(0, anchor.start) + line.slice(bare.length));
  }
  return kept.join('\n').replace(/\r$/, '');
}
