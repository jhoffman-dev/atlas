import type { EditorNode } from '../markdown/editor-node.ts';
import { linkOfNode } from '../bookmarks/bookmark.ts';
import { linkFragment } from '../markdown/link-fragment.ts';
import type { WikiLink, WikiLinkOrEmbed } from '../markdown/wikilink.ts';

/*
 * A block shown in another note (P26-03, ADR-0022): `![[Note#^abc123]]` or
 * `![[Note#Heading]]`, alone in a paragraph of its own, is drawn as the block
 * or the section it names, live, read from its note. In the file it stays
 * exactly that line, so Obsidian shows the same block.
 *
 * Only a paragraph of the note's own holding the embed and nothing else is
 * one. An embed in a sentence, in a list or a quote, or of a whole note is
 * the link it always was.
 */

/** The editor node a shown block is: a block of its own, holding the link. */
export const BLOCK_EMBED_NODE = 'blockEmbed';

/**
 * Whether a link is one shown in place as a block: an embed naming a block
 * or a heading of a note. `![[Paper.pdf#page=3]]` names a page of a file,
 * not a block of a note, and stays a link (A26-01).
 */
export function isTransclusion(link: WikiLinkOrEmbed): boolean {
  return link.embed && linkFragment(link) !== null && namesANote(link.target);
}

/**
 * The files Obsidian opens that are not notes, by extension: a link to one
 * names that file. Any other name — `Meeting 2026.09.27`, `Mr. Smith` — is a
 * note's, however many dots it has.
 */
const OTHER_FILES: ReadonlySet<string> = new Set([
  'pdf',
  'canvas',
  'base',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'svg',
  'webp',
  'avif',
  'heic',
  'heif',
  'mp3',
  'wav',
  'm4a',
  'ogg',
  'flac',
  '3gp',
  'webm',
  'mp4',
  'mov',
  'mkv',
  'ogv',
]);

/** Whether a link's target names a note rather than another kind of file. */
function namesANote(target: string): boolean {
  const extension = /\.([A-Za-z0-9]+)$/.exec(target.trim())?.[1]?.toLowerCase();
  return extension === undefined || !OTHER_FILES.has(extension);
}

/**
 * The embed a paragraph stands as, as a block of its own (P26-03): a
 * paragraph of the note's own — `topLevel` — holding one embed of a note's
 * block or heading and nothing else but spaces. Null for anything else. The
 * one rule the markdown reader and the editor's picker both ask.
 */
export function shownBlockLink(
  paragraph: EditorNode,
  { topLevel }: { topLevel: boolean },
): WikiLinkOrEmbed | null {
  if (!topLevel || paragraph.type !== 'paragraph') return null;
  const parts = (paragraph.content ?? []).filter(
    (part) => part.type !== 'text' || (part.text ?? '').trim() !== '',
  );
  const [only] = parts;
  // A link in bold or italic is words with a look, not a block of its own.
  if (parts.length !== 1 || only?.type !== 'wikiLink' || (only.marks ?? []).length > 0) return null;
  const link = { ...linkOfNode(only), embed: only.attrs?.['embed'] === true };
  return isTransclusion(link) ? link : null;
}

/** The node for a shown block. Its alias is kept, to be written back. */
export function blockEmbedNode(link: WikiLink): EditorNode {
  return {
    type: BLOCK_EMBED_NODE,
    attrs: { target: link.target, heading: link.heading, alias: link.alias },
  };
}

/**
 * The paragraph a shown block is written as where only a paragraph can
 * stand — inside a quote, a list or a cell, or inside another shown block:
 * the embed's link, alone, which is how the file holds it anyway.
 */
export function paragraphOfEmbed(node: EditorNode): EditorNode | null {
  if (node.type !== BLOCK_EMBED_NODE) return null;
  const attrs = node.attrs ?? {};
  const text = (key: string) => (typeof attrs[key] === 'string' ? attrs[key] : null);
  return {
    type: 'paragraph',
    content: [
      {
        type: 'wikiLink',
        attrs: {
          target: text('target') ?? '',
          heading: text('heading'),
          alias: text('alias'),
          embed: true,
        },
      },
    ],
  };
}
