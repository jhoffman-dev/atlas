import { isArchivedPath } from '../archive/archive.ts';
import { fragmentContent } from '../markdown/block-outline.ts';
import type { EditorNode, EditorDocument } from '../markdown/editor-node.ts';
import { linkFragment, type LinkFragment } from '../markdown/link-fragment.ts';
import { wikiLinkLabel, type WikiLink } from '../markdown/wikilink.ts';
import { pageTitle } from '../page/page-title.ts';
import { noteTitle } from '../vault/vault-entry.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import { paragraphOfEmbed } from './block-embed.ts';

/** What a shown block draws (P26-03). */
export type Transclusion =
  | {
      /** The link names no note in the vault, or one that cannot be read. */
      readonly kind: 'missing-note';
      /** What the link shows, to say which note is missing. */
      readonly label: string;
    }
  | {
      /** The note is there, but holds no block with that id, or no such heading. */
      readonly kind: 'missing-block';
      readonly path: VaultPath;
      readonly title: string;
      readonly archived: boolean;
      readonly fragment: LinkFragment | null;
    }
  | {
      readonly kind: 'block';
      readonly path: VaultPath;
      /** The note's title as its page shows it: what the embed names as its source. */
      readonly title: string;
      /** In the Archive: still shown, and said to be archived. */
      readonly archived: boolean;
      readonly fragment: LinkFragment;
      /** The block, or the heading and what is under it, as blocks of their own. */
      readonly content: EditorDocument;
    };

/** The shown block of a link that names no note. */
export function missingTransclusion(link: WikiLink): Transclusion {
  return { kind: 'missing-note', label: wikiLinkLabel({ ...link, heading: null }) };
}

/**
 * What an embed shows of the note at `path`, read as `doc`: the block or the
 * section its link names. An embed inside that block is drawn as its link,
 * not opened in turn, so a note that shows a block showing it back — A in B
 * in A — stops after one level instead of going round for ever.
 */
export function transclusionOf({
  link,
  path,
  properties,
  doc,
}: {
  link: WikiLink;
  path: VaultPath;
  properties: Readonly<Record<string, unknown>>;
  doc: EditorDocument;
}): Transclusion {
  const title = pageTitle({ fileTitle: noteTitle(path), properties }).text;
  const archived = isArchivedPath(path);
  const fragment = linkFragment(link);
  const nodes = fragment === null ? null : fragmentContent(doc, fragment);
  if (fragment === null || nodes === null) {
    return { kind: 'missing-block', path, title, archived, fragment };
  }
  return {
    kind: 'block',
    path,
    title,
    archived,
    fragment,
    content: { type: 'doc', content: nodes.map(oneLevel) },
  };
}

/** A block with every shown block inside it made its link again. */
function oneLevel(node: EditorNode): EditorNode {
  const asLink = paragraphOfEmbed(node);
  if (asLink !== null) return asLink;
  return node.content === undefined ? node : { ...node, content: node.content.map(oneLevel) };
}
