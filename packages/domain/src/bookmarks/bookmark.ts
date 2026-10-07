import type { EditorNode } from '../markdown/editor-node.ts';
import { resolveWikiLinkTarget } from '../markdown/resolve-wikilink.ts';
import type { WikiLink } from '../markdown/wikilink.ts';
import type { VaultPath } from '../vault/vault-path.ts';

/*
 * A bookmark: a link to a note shown as a card — the page's picture, its
 * title and a line of what it says — rather than as words in a sentence
 * (U-21). In the file it is the link alone in its paragraph, followed by a
 * comment every markdown reader hides, so Obsidian still shows a working
 * link and nothing else (ADR-0020):
 *
 *     [[Some Note]] <!-- atlas:bookmark -->
 *
 * The comment is what makes it a bookmark: a link alone on a line without it
 * is a link, as it always was.
 */

/** The comment that turns the link before it into a bookmark, as Atlas writes it. */
export const BOOKMARK_MARKER = '<!-- atlas:bookmark -->';

/** The editor node a bookmark is: a block of its own, holding the link. */
export const BOOKMARK_NODE = 'bookmark';

/** The marker as it may be read: spaces inside the comment are anyone's to vary. */
const MARKER = /^<!--[ \t]*atlas:bookmark[ \t]*-->$/;

/** Whether a piece of inline HTML is the bookmark marker. */
export function isBookmarkMarker(html: string): boolean {
  return MARKER.test(html.trim());
}

/** The bookmark node for a link. Its heading and alias are kept, to be written back. */
export function bookmarkNode(link: WikiLink): EditorNode {
  return {
    type: BOOKMARK_NODE,
    attrs: { target: link.target, heading: link.heading, alias: link.alias },
  };
}

/** The link a wiki link or a bookmark node holds. */
export function linkOfNode(node: EditorNode): WikiLink {
  const attrs = node.attrs ?? {};
  const text = (key: string) => (typeof attrs[key] === 'string' ? attrs[key] : null);
  return { target: text('target') ?? '', heading: text('heading'), alias: text('alias') };
}

/**
 * The note a bookmark opens: the one its link names — or, for a link to a
 * heading in the same note (`[[#Plans]]`), which names none, the note the
 * card is in. Null when the link names no note in the vault.
 */
export function bookmarkTarget({
  link,
  holder,
  notePaths,
}: {
  link: WikiLink;
  /** The note the bookmark is in. */
  holder: VaultPath;
  notePaths: readonly VaultPath[];
}): VaultPath | null {
  if (link.target.trim() === '' && link.heading !== null) return holder;
  return resolveWikiLinkTarget(link.target, notePaths);
}
