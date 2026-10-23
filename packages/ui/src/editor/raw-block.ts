import { Node, type NodeViewRenderer } from '@tiptap/core';
import { DOMSerializer, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { BLOCK_ANCHOR_ATTR, isTombstoneBlock, type HighlightView } from '@dfai/domain';
import { HighlightBlockView } from './highlight-block-view.tsx';

/**
 * Which raw blocks offer to open their place elsewhere: a highlight in its
 * literature note offers "Open in PDF" (#506). Asked each time a block is
 * rendered, so the extensions need not be built again when the answer
 * changes; a block already drawn keeps what it was drawn with until it is
 * rendered again.
 */
export interface ReaderLinks {
  /** The link's words for the block with id `id`, or null when it offers none. */
  labelFor(id: string): string | null;
}

/**
 * The highlights of a literature note, which its raw blocks are drawn as
 * (#523): the quote and its comment, the marker hidden. Asked when a block
 * is drawn, from the block itself, so what it shows is its own bytes.
 */
export interface HighlightBlocks {
  /** The highlight the block with this markdown and `^id` is, or null when it is none. */
  viewOf(block: { readonly markdown: string; readonly id: string }): HighlightView | null;
  /** Writes highlight `id`'s comment, as the literature note's own writes do; rejects with why not. */
  editComment(edit: { readonly id: string; readonly comment: string }): Promise<void>;
  /** An area highlight's picture, found as the note's images are. */
  loadImage(src: string): Promise<string | null>;
}

export interface RawBlockOptions {
  /** Null where no raw block offers a link: a note read elsewhere, or one that is no literature note. */
  readonly readerLinks: ReaderLinks | null;
  /** Null where no raw block is a highlight: a note read elsewhere, or one that is no literature note. */
  readonly highlights: HighlightBlocks | null;
}

/**
 * A block of markdown the editor does not model — a table, an image, raw HTML.
 * It is an atom: shown as its source and carried through a save untouched, so an
 * unsupported construct is never approximated and quietly rewritten. A
 * highlight in its literature note is one too, drawn as its quote and comment
 * (#523), and saved from its bytes as every raw block is: its comment is
 * written by the literature note's own write, never by the editor's save.
 */
export const RawBlock = Node.create<RawBlockOptions>({
  name: 'rawBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addOptions() {
    return { readerLinks: null, highlights: null };
  },

  addAttributes() {
    return {
      markdown: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'pre[data-raw-block]' }];
  },

  renderHTML({ node }) {
    return rawBlockSpec(node, this.options.readerLinks);
  },

  addNodeView() {
    const { highlights, readerLinks } = this.options;
    if (highlights === null) return null;
    return highlightOrSource(highlights, readerLinks);
  },
});

/** The block's source, as a `pre`, with its reader link when it offers one. */
function rawBlockSpec(node: ProseMirrorNode, readerLinks: ReaderLinks | null) {
  const markdown = String(node.attrs['markdown'] ?? '');
  const attributes = {
    'data-raw-block': '',
    class: classOf(markdown),
    title: 'Not editable yet — saved unchanged',
  };
  const id = node.attrs[BLOCK_ANCHOR_ATTR];
  const label = typeof id === 'string' ? (readerLinks?.labelFor(id) ?? null) : null;
  if (label === null) return ['pre', attributes, markdown] as const;
  return ['pre', attributes, markdown, readerLink(id as string, label)] as const;
}

function classOf(markdown: string): string {
  // A removed highlight's tombstone is hidden by every reader (ADR-0043 §5), and here.
  if (isTombstoneBlock(markdown)) return 'raw-block raw-block--comment raw-block--hidden';
  return isComment(markdown) ? 'raw-block raw-block--comment' : 'raw-block';
}

/**
 * Each block drawn as the highlight it is, or as its source when it is none.
 * Which one is settled when the block is drawn: a block whose bytes change
 * is drawn again, so a source that became a highlight — or stopped being
 * one — is drawn as what it now is.
 */
function highlightOrSource(
  highlights: HighlightBlocks,
  readerLinks: ReaderLinks | null,
): NodeViewRenderer {
  const highlightView = ReactNodeViewRenderer(HighlightBlockView, {
    update: ({ oldNode, newNode, updateProps }) => {
      if (!sameBlock(oldNode, newNode)) return false;
      updateProps();
      return true;
    },
  });
  return (props) => {
    const markdown = String(props.node.attrs['markdown'] ?? '');
    const id = props.node.attrs[BLOCK_ANCHOR_ATTR];
    if (typeof id === 'string' && highlights.viewOf({ markdown, id }) !== null) {
      return highlightView(props);
    }
    const { dom } = DOMSerializer.renderSpec(document, rawBlockSpec(props.node, readerLinks));
    return { dom, update: () => false };
  };
}

const sameBlock = (one: ProseMirrorNode, other: ProseMirrorNode): boolean =>
  one.attrs['markdown'] === other.attrs['markdown'] &&
  one.attrs[BLOCK_ANCHOR_ATTR] === other.attrs[BLOCK_ANCHOR_ATTR];

/**
 * The block's own link — `[[#^id]]`, a place in this note — which the note's
 * editor follows as any link it is clicked on, so where it leads is the
 * link rules', not the block's.
 */
const readerLink = (id: string, label: string) =>
  [
    'a',
    {
      class: 'raw-block__open wikilink',
      'data-wikilink': '',
      'data-heading': `#^${id}`,
      role: 'link',
      tabindex: '0',
      contenteditable: 'false',
    },
    label,
  ] as const;

/**
 * Whether a raw block is one HTML comment and nothing else — a marker DFAI
 * writes around a meeting's summary (#186), say — which nobody reads: it is
 * drawn small and muted rather than as a block of source.
 */
const isComment = (markdown: string): boolean =>
  /^<!--(?:(?!-->)[\s\S])*-->$/.test(markdown.trim());
