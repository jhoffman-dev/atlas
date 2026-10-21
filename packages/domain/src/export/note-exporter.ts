import { EMBEDDABLE_IMAGE_EXTENSIONS } from '../attachments/image-file.ts';
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
import type { Transclusion } from '../transclusion/transclusion-card.ts';
import { DroppedContent } from './export-drops.ts';
import { PageScopes, RAW_BLOCK, rawMarkdownOf, type ExportScope } from './export-scope.ts';
import {
  calloutName,
  imageWords,
  ON_THE_WEB,
  rawMarkdownForExport,
  REACHABLE,
  unlinkable,
} from './raw-markdown.ts';
import type { RawPartsReader } from './raw-parts.ts';

/** What an export reads from outside the note. */
export interface ExportSources {
  /** The title of the note a link's target names; null when it names none the export may read. */
  readonly titleOf: (target: string) => string | null;
  /** What a block shown in place shows. */
  readonly shown: (link: WikiLinkOrEmbed) => Transclusion;
  /** What markdown the editor does not model holds, as the markdown reader reads it. */
  readonly readRaw: RawPartsReader;
}

/** A whole note shown in place (`![[Note]]`), read for the export. */
export interface EmbeddedNote {
  readonly title: string;
  readonly doc: EditorDocument;
}

/**
 * What an export that leaves Atlas whole (#501) adds to those: where a link
 * goes in it, the address each image is copied to, and the notes embedded
 * whole. Left out, the export reads as one for a page elsewhere (P32-07).
 */
export interface StandaloneSources extends ExportSources {
  /** The address a link to `target` takes in the export — another note exported beside it; null leaves the link as words. */
  readonly hrefOf: (target: string) => string | null;
  /**
   * The address an image is written with: its copy beside the export, or
   * the picture itself as a `data:` URL. Null when it could not be copied.
   * Asked with the image's `src`, or an embed's target (`![[Plan.png]]`).
   */
  readonly imageSrc: (src: string) => string | null;
  /** The note an embed of a whole note shows; null when it names none the export may read. */
  readonly embedded: (link: WikiLinkOrEmbed) => EmbeddedNote | null;
}

const ITALIC: EditorMark = { type: 'italic' };
const BOLD: EditorMark = { type: 'bold' };

const text = (words: string, marks?: readonly EditorMark[]): EditorNode => ({
  type: 'text',
  text: words,
  ...(marks !== undefined && marks.length > 0 && { marks }),
});

const paragraph = (content: readonly EditorNode[]): EditorNode => ({ type: 'paragraph', content });

/** Whether a link names a picture by its extension: `![[Plan.png]]`. */
export function namesAnImage(target: string): boolean {
  const extension = /\.([A-Za-z0-9]+)$/.exec(target.trim())?.[1]?.toLowerCase();
  return extension !== undefined && EMBEDDABLE_IMAGE_EXTENSIONS.includes(extension);
}

/**
 * The blocks of a note, made ready to leave Atlas: links as words (or, for a
 * standalone export, links to the notes exported beside it), shown blocks
 * as quotes from their notes, and anything left out named in `dropped`.
 * A callout becomes a quote for a page elsewhere, and stays one for an
 * export that leaves Atlas whole, which other tools read as it is.
 */
export class Exporter {
  readonly dropped = new DroppedContent();
  private readonly scopes: PageScopes;
  /** The note whose blocks are being exported: the page's own, or one a block is shown from. */
  private scope: ExportScope | null = null;
  /** How many notes embedded whole the blocks being exported are inside: one level is opened. */
  private embedDepth = 0;

  constructor(
    private readonly context: {
      title: string;
      sources: ExportSources;
      standalone?: Omit<StandaloneSources, keyof ExportSources>;
    },
  ) {
    this.scopes = new PageScopes(context.sources.readRaw);
  }

  /** A note's blocks, or the blocks shown from the note titled `shownFrom`. */
  document(nodes: readonly EditorNode[], shownFrom: string | null = null): EditorNode[] {
    const outer = this.scope;
    this.scope = shownFrom === null ? this.scopes.note(nodes) : this.scopes.shown(nodes, shownFrom);
    try {
      return this.nodes(nodes);
    } finally {
      this.scope = outer;
    }
  }

  private nodes(nodes: readonly EditorNode[]): EditorNode[] {
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
      case 'paragraph':
        return this.embeddedNote(node) ?? [this.descend(node)];
      case 'wikiLink':
        return this.link({ ...linkOfNode(node), embed: node.attrs?.['embed'] === true }, node);
      case 'image':
        return [this.image(node)];
      case 'text':
        return [this.withReachableLinks(node)];
      default:
        return [this.descend(node)];
    }
  }

  private descend(node: EditorNode): EditorNode {
    return node.content === undefined ? node : { ...node, content: this.nodes(node.content) };
  }

  private withoutId(node: EditorNode): EditorNode {
    const id = node.attrs?.[BLOCK_ANCHOR_ATTR];
    if (typeof id !== 'string') return node;
    if (id !== '') this.dropped.add('block-id', id);
    return { ...node, attrs: withoutAnchorAttr(node.attrs ?? {}) };
  }

  /** A link in a sentence: a picture it embeds, where the export copies pictures, else its words. */
  private link(link: WikiLinkOrEmbed, from: EditorNode): EditorNode[] {
    const standalone = this.context.standalone;
    if (standalone === undefined || !link.embed || !namesAnImage(link.target)) {
      return this.linkText(link, from);
    }
    const src = standalone.imageSrc(link.target);
    if (src === null) return this.linkText(link, from);
    const alt = link.alias ?? link.target;
    return [withMarks({ type: 'image', attrs: { src, alt, title: null } }, from.marks ?? [])];
  }

  /**
   * A link as its words, keeping the look it had — or, where the export
   * holds the note it names, a link to that note's file. Where else it went
   * is dropped.
   */
  private linkText(link: WikiLinkOrEmbed, from?: EditorNode): EditorNode[] {
    const href = link.embed ? null : (this.context.standalone?.hrefOf(link.target) ?? null);
    const marks = from?.marks ?? [];
    if (href !== null) {
      return [text(this.wordsOf(link), [...marks, { type: 'link', attrs: { href, title: null } }])];
    }
    this.dropped.add(link.embed ? 'embed' : 'link', formatWikiLink(link));
    return [text(this.wordsOf(link), marks)];
  }

  /**
   * What a link reads as: its alias, else the note's title and the heading it
   * points at — words that cannot become a link to somewhere else.
   */
  private wordsOf(link: WikiLink): string {
    return unlinkable(this.linkWords(link));
  }

  private linkWords(link: WikiLink): string {
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
    return this.quotedFrom(shown.title, this.document(shown.content.content, shown.title));
  }

  private quotedFrom(title: string, content: readonly EditorNode[]): EditorNode[] {
    const source = paragraph([text(`From ${unlinkable(title)}`, [ITALIC])]);
    if (content.some((node) => node.type === RAW_BLOCK)) return [source, ...content];
    return [{ type: 'blockquote', content: [source, ...content] }];
  }

  /**
   * A paragraph that is one embed of a whole note and nothing else, in an
   * export that leaves Atlas whole: that note's blocks, quoted under its
   * title, as a shown block is. One level is opened — an embed inside it is
   * its words — so two notes embedding each other end. Null for any other
   * paragraph, which is exported as it stands.
   */
  private embeddedNote(node: EditorNode): EditorNode[] | null {
    const standalone = this.context.standalone;
    if (standalone === undefined || this.embedDepth > 0) return null;
    const link = soleEmbedOf(node);
    if (link === null || linkFragment(link) !== null || namesAnImage(link.target)) return null;
    const note = standalone.embedded(link);
    if (note === null) return null;
    this.embedDepth += 1;
    try {
      return this.quotedFrom(note.title, this.document(note.doc.content, note.title));
    } finally {
      this.embedDepth -= 1;
    }
  }

  /**
   * A callout as a quote that opens with its name in bold, then its title —
   * or, in an export that leaves Atlas whole, the callout it is, which
   * other markdown tools draw as one.
   */
  private callout(node: EditorNode): EditorNode {
    if (this.context.standalone !== undefined) return this.descend(node);
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
    const { scope } = this;
    if (scope === null) throw new Error('A raw block was exported outside any note');
    const markdown = rawMarkdownOf(node);
    const parts = this.context.sources.readRaw(markdown, scope.definitions);
    const exported = rawMarkdownForExport(markdown, parts, {
      wordsOf: (link) => this.wordsOf(link),
      footnoteLabel: scope.footnoteLabel,
      escapeStrayFootnotes: scope.escapeStrayFootnotes,
      reread: (written) => this.context.sources.readRaw(written, scope.definitions),
      dropped: this.dropped,
    });
    return { ...node, attrs: { ...node.attrs, markdown: exported } };
  }

  /**
   * An image on the web stays. One in the vault is the copy the export
   * makes of it, where it makes one; otherwise it is named, as the page
   * cannot reach it. A link around it is kept where the page can follow it.
   */
  private image(node: EditorNode): EditorNode {
    const marks = this.reachableMarks(node.marks ?? []);
    const src = typeof node.attrs?.['src'] === 'string' ? node.attrs['src'] : '';
    if (ON_THE_WEB.test(src)) return withMarks(node, marks);
    const copied = this.context.standalone?.imageSrc(src) ?? null;
    if (copied !== null)
      return withMarks({ ...node, attrs: { ...node.attrs, src: copied } }, marks);
    this.dropped.add('image', src);
    const alt = typeof node.attrs?.['alt'] === 'string' ? node.attrs['alt'] : '';
    return text(imageWords(alt, src), marks);
  }

  /**
   * Text whose link goes somewhere the page cannot follow keeps its words and
   * loses the link — words that cannot become a link of their own there.
   */
  private withReachableLinks(node: EditorNode): EditorNode {
    const marks = node.marks ?? [];
    const kept = this.reachableMarks(marks);
    if (kept.length === marks.length) return node;
    const code = kept.some((mark) => mark.type === 'code');
    return text(code ? (node.text ?? '') : unlinkable(node.text ?? ''), kept);
  }

  /**
   * The marks, less a link the page cannot follow, which is listed. An
   * export that leaves Atlas whole keeps every link as it was written.
   */
  private reachableMarks(marks: readonly EditorMark[]): readonly EditorMark[] {
    if (this.context.standalone !== undefined) return marks;
    return marks.filter((mark) => {
      if (mark.type !== 'link') return true;
      const href = typeof mark.attrs?.['href'] === 'string' ? mark.attrs['href'] : '';
      if (REACHABLE.test(href)) return true;
      this.dropped.add('link', href);
      return false;
    });
  }
}

/** The one embed a paragraph holds and nothing else but spaces, unstyled; null for any other. */
function soleEmbedOf(node: EditorNode): WikiLinkOrEmbed | null {
  const parts = (node.content ?? []).filter(
    (part) => part.type !== 'text' || (part.text ?? '').trim() !== '',
  );
  const [only] = parts;
  if (parts.length !== 1 || only?.type !== 'wikiLink' || (only.marks ?? []).length > 0) return null;
  if (only.attrs?.['embed'] !== true) return null;
  return { ...linkOfNode(only), embed: true };
}

/** An inline node with these marks: itself when they are its own. */
function withMarks(node: EditorNode, marks: readonly EditorMark[]): EditorNode {
  if (marks.length === (node.marks ?? []).length) return node;
  return {
    type: node.type,
    ...(node.attrs !== undefined && { attrs: node.attrs }),
    ...(node.text !== undefined && { text: node.text }),
    ...(marks.length > 0 && { marks }),
  };
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
