import { BOOKMARK_NODE, linkOfNode } from '../bookmarks/bookmark.ts';
import { BLOCK_ANCHOR_ATTR } from '../markdown/block-anchor.ts';
import { withoutAnchorAttr } from '../markdown/block-outline.ts';
import type { CalloutMarker } from '../markdown/callout.ts';
import type { EditorDocument, EditorMark, EditorNode } from '../markdown/editor-node.ts';
import { linkFragment } from '../markdown/link-fragment.ts';
import {
  formatWikiLink,
  splitWikiLinksAndEmbeds,
  type WikiLink,
  type WikiLinkOrEmbed,
} from '../markdown/wikilink.ts';
import { BLOCK_EMBED_NODE } from '../transclusion/block-embed.ts';
import { missingTransclusion, type Transclusion } from '../transclusion/transclusion-card.ts';
import { DroppedContent, type ExportDrops } from './export-drops.ts';
import { calloutName, rawMarkdownForExport } from './raw-markdown.ts';

/*
 * A note made ready for a Confluence page (P32-07): the same blocks, with
 * what only Atlas can draw turned into what a page can hold. A wiki link is
 * its words — its alias, or the title of the note it names; a shown block is
 * that block, quoted, with the note it came from; a callout is a quote that
 * opens with its name in bold. Every `^id` and comment is left out, and so
 * is anything the page could not reach — and each thing left out is named
 * in `dropped`, never lost without a word.
 */

/** What an export reads from outside the note. */
export interface ExportSources {
  /** The title of the note a link's target names; null when it names none the export may read. */
  readonly titleOf: (target: string) => string | null;
  /** What a block shown in place shows. */
  readonly shown: (link: WikiLinkOrEmbed) => Transclusion;
}

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
  /** Its frontmatter's keys, as written: properties stay in Atlas. */
  propertyKeys: readonly string[];
  sources: ExportSources;
}): ConfluenceExport {
  const exporter = new Exporter({ title, sources });
  for (const key of propertyKeys) exporter.dropped.add('property', key);
  const content = exporter.nodes(doc.content);
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
export function linkTargetsOf(docs: readonly EditorDocument[]): string[] {
  const asked = new Set<string>();
  const sources: ExportSources = {
    titleOf: (target) => {
      asked.add(target);
      return null;
    },
    shown: missingTransclusion,
  };
  for (const doc of docs) new Exporter({ title: '', sources }).nodes(doc.content);
  return [...asked];
}

const ITALIC: EditorMark = { type: 'italic' };
const BOLD: EditorMark = { type: 'bold' };
/** Where a page's link may go: the web, or an email. A note's path, or an app's, goes nowhere. */
const REACHABLE = /^(?:https?:|mailto:)/i;
/** Where a page's image may come from: the web. */
const ON_THE_WEB = /^https?:/i;
const RAW_BLOCK = 'rawBlock';

const text = (words: string, marks?: readonly EditorMark[]): EditorNode => ({
  type: 'text',
  text: words,
  ...(marks !== undefined && marks.length > 0 && { marks }),
});

const paragraph = (content: readonly EditorNode[]): EditorNode => ({ type: 'paragraph', content });

class Exporter {
  readonly dropped = new DroppedContent();

  constructor(private readonly context: { title: string; sources: ExportSources }) {}

  nodes(nodes: readonly EditorNode[]): EditorNode[] {
    return nodes.flatMap((node) => this.node(this.withoutId(node)));
  }

  private node(node: EditorNode): EditorNode[] {
    switch (node.type) {
      case BLOCK_EMBED_NODE:
        return this.shownBlock({ ...linkOfNode(node), embed: true });
      case BOOKMARK_NODE:
        return [paragraph(this.linkText({ ...linkOfNode(node), embed: false }))];
      case 'callout':
        return [this.callout(node)];
      case RAW_BLOCK:
        return [this.raw(node)];
      case 'wikiLink':
        return this.linkText({ ...linkOfNode(node), embed: node.attrs?.['embed'] === true }, node);
      case 'image':
        return [this.image(node)];
      case 'text':
        return [this.withReachableLinks(node)];
      default:
        return [node.content === undefined ? node : { ...node, content: this.nodes(node.content) }];
    }
  }

  private withoutId(node: EditorNode): EditorNode {
    const id = node.attrs?.[BLOCK_ANCHOR_ATTR];
    if (typeof id !== 'string') return node;
    if (id !== '') this.dropped.add('block-id', id);
    return { ...node, attrs: withoutAnchorAttr(node.attrs ?? {}) };
  }

  /** A link as its words, keeping the look it had; where it went is dropped. */
  private linkText(link: WikiLinkOrEmbed, from?: EditorNode): EditorNode[] {
    this.dropped.add(link.embed ? 'embed' : 'link', formatWikiLink(link));
    return [text(this.wordsOf(link), from?.marks)];
  }

  /** What a link reads as: its alias, else the note's title and the heading it points at. */
  private wordsOf(link: WikiLink): string {
    if (link.alias !== null && link.alias.trim() !== '') return link.alias;
    const fragment = linkFragment(link);
    const heading = fragment?.kind === 'heading' ? fragment.heading : null;
    if (link.target.trim() === '') return heading ?? this.context.title;
    const note = this.context.sources.titleOf(link.target) ?? link.target;
    return heading === null ? note : `${note} › ${heading}`;
  }

  /**
   * A block shown in place, as the blocks it shows, quoted under the note
   * they came from. Markdown the editor does not model cannot be quoted
   * here, so such blocks follow the note's name unquoted.
   */
  private shownBlock(link: WikiLinkOrEmbed): EditorNode[] {
    const shown = this.context.sources.shown(link);
    if (shown.kind !== 'block') {
      this.dropped.add('missing-embed', formatWikiLink(link));
      return [paragraph([text(`[Not found: ${this.wordsOf(link)}]`)])];
    }
    const source = paragraph([text(`From ${shown.title}`, [ITALIC])]);
    const content = this.nodes(shown.content.content);
    if (content.some((node) => node.type === RAW_BLOCK)) return [source, ...content];
    return [{ type: 'blockquote', content: [source, ...content] }];
  }

  /** A callout as a quote that opens with its name in bold, then its title. */
  private callout(node: EditorNode): EditorNode {
    const marker = calloutMarkerOf(node);
    if (marker.fold !== null) {
      this.dropped.add('callout-fold', `[!${marker.kind}]${marker.fold}`);
    }
    const name = calloutName(marker);
    const opening =
      marker.title === null
        ? [text(name, [BOLD])]
        : [text(`${name}:`, [BOLD]), text(` ${this.titleWords(marker.title)}`)];
    const content = this.nodes(node.content ?? []).filter((child) => !isEmptyParagraph(child));
    return { type: 'blockquote', content: [paragraph(opening), ...content] };
  }

  /** A callout's title, written as markdown, with each link in it as its words. */
  private titleWords(title: string): string {
    return splitWikiLinksAndEmbeds(title)
      .map((piece) => (piece.kind === 'text' ? piece.value : nodeWords(this.linkText(piece))))
      .join('');
  }

  private raw(node: EditorNode): EditorNode {
    const markdown = String(node.attrs?.['markdown'] ?? '');
    const exported = rawMarkdownForExport(markdown, {
      wordsOf: (link) => this.wordsOf(link),
      dropped: this.dropped,
    });
    return { ...node, attrs: { ...node.attrs, markdown: exported } };
  }

  /** An image on the web stays; one in the vault is named, as the page cannot reach it. */
  private image(node: EditorNode): EditorNode {
    const src = typeof node.attrs?.['src'] === 'string' ? node.attrs['src'] : '';
    if (ON_THE_WEB.test(src)) return node;
    this.dropped.add('image', src);
    const alt = typeof node.attrs?.['alt'] === 'string' ? node.attrs['alt'].trim() : '';
    return text(`[Image: ${alt === '' ? src : alt}]`, node.marks);
  }

  /** Text whose link goes somewhere the page cannot follow keeps its words and loses the link. */
  private withReachableLinks(node: EditorNode): EditorNode {
    const marks = node.marks ?? [];
    const kept = marks.filter((mark) => {
      if (mark.type !== 'link') return true;
      const href = typeof mark.attrs?.['href'] === 'string' ? mark.attrs['href'] : '';
      if (REACHABLE.test(href)) return true;
      this.dropped.add('link', href);
      return false;
    });
    return kept.length === marks.length ? node : text(node.text ?? '', kept);
  }
}

function calloutMarkerOf(node: EditorNode): CalloutMarker {
  const attrs = node.attrs ?? {};
  const value = (key: string) => (typeof attrs[key] === 'string' ? attrs[key] : null);
  return { kind: value('kind') ?? 'note', title: value('title'), fold: value('fold') };
}

const isEmptyParagraph = (node: EditorNode): boolean =>
  node.type === 'paragraph' && (node.content ?? []).length === 0;

const nodeWords = (nodes: readonly EditorNode[]): string =>
  nodes.map((node) => node.text ?? '').join('');
