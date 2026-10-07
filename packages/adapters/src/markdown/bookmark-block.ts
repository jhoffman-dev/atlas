import {
  BOOKMARK_MARKER,
  bookmarkNode,
  formatWikiLink,
  isBookmarkMarker,
  linkOfNode,
  splitWikiLinksAndEmbeds,
  type EditorNode,
} from '@atlas/domain';
import type { Paragraph, RootContent } from 'mdast';
import './mdast-custom-nodes.ts';

/** A bookmark's line: the link, any spaces, the marker comment, any spaces — and nothing else. */
const BOOKMARK_LINE = /^(\[\[[^\n]*\]\])[ \t]*(<!--[^\n]*-->)[ \t]*$/;

/**
 * A top-level paragraph that is a bookmark (ADR-0020): one wiki link, then
 * the marker comment, and nothing else — `[[Note]] <!-- atlas:bookmark -->`.
 * Null for anything else, a link alone on its line included: without the
 * marker, a link is a link.
 *
 * Read from the paragraph's own line, not from how remark split it: a name
 * like `_draft_`, `a*b*c` or `a<b>` is markup to remark, but still one link.
 * The marker must still be the comment remark read, where the line has it.
 */
export function bookmarkFromMdast(node: RootContent, body: string): EditorNode | null {
  if (node.type !== 'paragraph') return null;
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) return null;
  const line = BOOKMARK_LINE.exec(body.slice(start, end));
  const [whole, linkSource, markerSource] = line ?? [];
  if (whole === undefined || linkSource === undefined || markerSource === undefined) return null;
  const marker = node.children.at(-1);
  const markerAt = start + whole.lastIndexOf(markerSource);
  if (marker?.type !== 'html' || marker.position?.start.offset !== markerAt) return null;
  if (marker.value !== markerSource || !isBookmarkMarker(markerSource)) return null;
  const pieces = splitWikiLinksAndEmbeds(linkSource);
  const [link] = pieces;
  if (pieces.length !== 1 || link?.kind !== 'wikiLink' || link.embed) return null;
  return bookmarkNode({ target: link.target, heading: link.heading, alias: link.alias });
}

/** A bookmark as markdown writes it: the link, a space, the marker. */
export function bookmarkToMdast(node: EditorNode): Paragraph {
  return {
    type: 'paragraph',
    children: [
      { type: 'wikiLink', value: formatWikiLink(linkOfNode(node)) },
      { type: 'text', value: ' ' },
      { type: 'html', value: BOOKMARK_MARKER },
    ],
  };
}
