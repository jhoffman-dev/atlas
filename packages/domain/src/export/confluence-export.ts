import { linkOfNode } from '../bookmarks/bookmark.ts';
import type { EditorDocument } from '../markdown/editor-node.ts';
import type { WikiLinkOrEmbed } from '../markdown/wikilink.ts';
import { BLOCK_EMBED_NODE } from '../transclusion/block-embed.ts';
import { missingTransclusion } from '../transclusion/transclusion-card.ts';
import type { ExportDrops } from './export-drops.ts';
import { Exporter, type ExportSources } from './note-exporter.ts';
import type { RawPartsReader } from './raw-parts.ts';

export type { ExportSources } from './note-exporter.ts';

/*
 * A note made ready for a Confluence page (P32-07): the same blocks, with
 * what only DFAI can draw turned into what a page can hold. A wiki link is
 * its words — its alias, or the title of the note it names; a shown block is
 * that block, quoted, with the note it came from; a callout is a quote that
 * opens with its name in bold. Every `^id` and comment is left out, and so
 * is anything the page could not reach — and each thing left out is named
 * in `dropped`, never lost without a word.
 */

export interface ConfluenceExport {
  /** The note's blocks as the page holds them, for the markdown writer. */
  readonly doc: EditorDocument;
  readonly dropped: readonly ExportDrops[];
}

/** A note, read as `doc`, ready to be written as a Confluence page's markdown. */
export function exportForConfluence({
  doc,
  title,
  propertyKeys,
  sources,
}: {
  doc: EditorDocument;
  /** The note's own title: what a link to one of its own blocks is shared as. */
  title: string;
  /** Its frontmatter's keys, as written: properties stay in DFAI. */
  propertyKeys: readonly string[];
  sources: ExportSources;
}): ConfluenceExport {
  const exporter = new Exporter({ title, sources });
  for (const key of propertyKeys) exporter.dropped.add('property', key);
  const content = exporter.document(doc.content);
  return { doc: { type: 'doc', content }, dropped: exporter.dropped.list() };
}

/** The links of the blocks shown in place in `doc`: what an export will ask `shown` for. */
export function shownBlocksOf(doc: EditorDocument): WikiLinkOrEmbed[] {
  return doc.content
    .filter((node) => node.type === BLOCK_EMBED_NODE)
    .map((node) => ({ ...linkOfNode(node), embed: true }));
}

/**
 * The targets whose titles exporting these documents will ask for — a
 * note's own, and each block it shows — so they can be read before it runs.
 * Found by the export itself, so it can never ask for one not listed here.
 */
export function linkTargetsOf(docs: readonly EditorDocument[], readRaw: RawPartsReader): string[] {
  const asked = new Set<string>();
  const sources: ExportSources = {
    titleOf: (target) => {
      asked.add(target);
      return null;
    },
    shown: missingTransclusion,
    readRaw,
  };
  for (const doc of docs) new Exporter({ title: '', sources }).document(doc.content);
  return [...asked];
}
