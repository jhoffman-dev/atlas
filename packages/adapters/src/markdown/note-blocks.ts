import { splitFrontmatter, type NoteBlocks, type TextSpan } from '@dfai/domain';
import type { Nodes, Root, RootContent } from 'mdast';
import { parseBodyToMdast } from './markdown-blocks.ts';

/*
 * What a literature note's highlights are read from (ADR-0043 §2): its
 * top-level block quotes and what Obsidian `%%` comments hide, found by the
 * parser that renders the note, so DFAI, its index and the editor read the
 * same blocks. The frontmatter is not parsed; the body's offsets are moved
 * to the whole note's.
 */

/** The top-level block quotes of a note's text, and the spans its `%%` comments hide. */
export function noteBlocks(text: string): NoteBlocks {
  const { body, bodyOffset } = splitFrontmatter(text);
  const root = parseBodyToMdast(body);
  const quotes = root.children.flatMap((node, at) => {
    const quote = spanOf(node, bodyOffset);
    if (node.type !== 'blockquote' || quote === null) return [];
    const next = root.children[at + 1];
    const paragraphAfter = next?.type === 'paragraph' ? spanOf(next, bodyOffset) : null;
    return [{ ...quote, paragraphAfter }];
  });
  return { quotes, hidden: obsidianComments(root, text, bodyOffset) };
}

function spanOf(node: RootContent, offset: number): TextSpan | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined
    ? null
    : { start: start + offset, end: end + offset };
}

/**
 * What Obsidian's `%%` comments hide: from one `%%` to the next, or to the end
 * of the note when none closes it. Obsidian does not parse these as CommonMark
 * does, so this is an approximation (ADR-0043 §8): a `%%` counts only in text
 * the parser reads as words — never in code, an inline code span or HTML,
 * which Obsidian shows or hides as they are — and a `%%` inside code does not
 * close a comment either.
 */
function obsidianComments(root: Root, text: string, offset: number): TextSpan[] {
  const marks = textSpans(root).flatMap(({ start, end }) =>
    [...text.slice(start + offset, end + offset).matchAll(/%%/g)].map(
      (match) => start + offset + match.index,
    ),
  );
  const hidden: TextSpan[] = [];
  for (let at = 0; at < marks.length; at += 2) {
    const close = marks[at + 1];
    hidden.push({
      start: marks[at] as number,
      end: close === undefined ? text.length : close + 2,
    });
  }
  return hidden;
}

/** The source spans of every text node, in document order; code, maths and HTML carry none. */
function textSpans(node: Nodes): TextSpan[] {
  if (node.type === 'text') {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    return start === undefined || end === undefined ? [] : [{ start, end }];
  }
  return 'children' in node ? node.children.flatMap((child) => textSpans(child as Nodes)) : [];
}
