import type { EditorDocument, EditorNode } from '../markdown/editor-node.ts';
import { linkFragment } from '../markdown/link-fragment.ts';
import type { WikiLinkOrEmbed } from '../markdown/wikilink.ts';
import { linkOfNode } from '../bookmarks/bookmark.ts';
import type { ExportDrops } from './export-drops.ts';
import { Exporter, namesAnImage, type StandaloneSources } from './note-exporter.ts';
import { ON_THE_WEB } from './raw-markdown.ts';

/*
 * A note made to leave Atlas whole (#501): Markdown any other tool reads,
 * and the page a PDF or a Google Doc is made from. A wiki link becomes a
 * link to the note's file where that note is exported beside it, else its
 * words; a block shown in place, or a whole note embedded, is quoted under
 * the note it came from; each image is the copy the export makes of it.
 * Callouts stay callouts, and links stay as written. What could not come
 * along is named in `dropped`, as a Confluence export names it.
 */

export interface StandaloneExport {
  /** The note's blocks as the export holds them, for the markdown writer or the page renderer. */
  readonly doc: EditorDocument;
  readonly dropped: readonly ExportDrops[];
}

/** A note, read as `doc`, made to leave Atlas whole. */
export function exportStandalone({
  doc,
  title,
  sources,
}: {
  doc: EditorDocument;
  /** The note's own title: what a link to one of its own blocks reads as. */
  title: string;
  sources: StandaloneSources;
}): StandaloneExport {
  const { hrefOf, imageSrc, embedded, ...base } = sources;
  const exporter = new Exporter({
    title,
    sources: base,
    standalone: { hrefOf, imageSrc, embedded },
  });
  const content = exporter.document(doc.content);
  return { doc: { type: 'doc', content }, dropped: exporter.dropped.list() };
}

/**
 * The embeds of whole notes in `doc` that a standalone export opens: each
 * paragraph holding one and nothing else, at any depth. What the export will
 * ask `embedded` for, so those notes can be read before it runs.
 */
export function embeddedNotesOf(doc: EditorDocument): WikiLinkOrEmbed[] {
  const found: WikiLinkOrEmbed[] = [];
  visit(doc.content, (node) => {
    if (node.type !== 'paragraph') return;
    const parts = (node.content ?? []).filter(
      (part) => part.type !== 'text' || (part.text ?? '').trim() !== '',
    );
    const [only] = parts;
    if (parts.length !== 1 || only?.type !== 'wikiLink' || only.attrs?.['embed'] !== true) return;
    const link = { ...linkOfNode(only), embed: true };
    if (linkFragment(link) === null && !namesAnImage(link.target)) found.push(link);
  });
  return found;
}

/**
 * Every picture in the vault the documents show, once each, in order: each
 * image's `src`, and each embed of a picture by its target. What a
 * standalone export will ask `imageSrc` for. One on the web is left where it is.
 */
export function exportImageSourcesOf(docs: readonly EditorDocument[]): string[] {
  const sources: string[] = [];
  const add = (src: string) => {
    if (src.trim() !== '' && !ON_THE_WEB.test(src) && !sources.includes(src)) sources.push(src);
  };
  for (const doc of docs) {
    visit(doc.content, (node) => {
      const src = node.attrs?.['src'];
      if (node.type === 'image' && typeof src === 'string') add(src);
      const target = node.attrs?.['target'];
      if (
        node.type === 'wikiLink' &&
        node.attrs?.['embed'] === true &&
        typeof target === 'string'
      ) {
        if (namesAnImage(target)) add(target);
      }
    });
  }
  return sources;
}

function visit(nodes: readonly EditorNode[], each: (node: EditorNode) => void): void {
  for (const node of nodes) {
    each(node);
    visit(node.content ?? [], each);
  }
}
