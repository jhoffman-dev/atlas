import { Node } from '@tiptap/core';
import { BLOCK_ANCHOR_ATTR, isTombstoneBlock } from '@dfai/domain';

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

export interface RawBlockOptions {
  /** Null where no raw block offers a link: a note read elsewhere, or one that is no literature note. */
  readonly readerLinks: ReaderLinks | null;
}

/**
 * A block of markdown the editor does not model — a table, an image, raw HTML.
 * It is an atom: shown as its source and carried through a save untouched, so an
 * unsupported construct is never approximated and quietly rewritten.
 */
export const RawBlock = Node.create<RawBlockOptions>({
  name: 'rawBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addOptions() {
    return { readerLinks: null };
  },

  addAttributes() {
    return {
      markdown: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'pre[data-raw-block]',
        // Above the code block's `pre` rule (priority 50), which would otherwise
        // take a pasted raw block and save its source as a fenced block (#541).
        priority: 60,
        // The source is read from its attribute, not the element's text, which
        // also holds the reader link's words. Without one, the rule passes and
        // the code block keeps the text.
        getAttrs: (element) => {
          const markdown = element.getAttribute('data-markdown');
          return markdown === null ? false : { markdown };
        },
      },
    ];
  },

  // A paste into another app gets the source: a raw block has no text of its own.
  // A removed highlight's tombstone is a marker every reader hides, so it gets none.
  renderText({ node }) {
    const markdown = String(node.attrs['markdown'] ?? '');
    return isTombstoneBlock(markdown) ? '' : markdown;
  },

  renderHTML({ node }) {
    const markdown = String(node.attrs['markdown'] ?? '');
    const attributes = {
      'data-raw-block': '',
      'data-markdown': markdown,
      class: isComment(markdown) ? 'raw-block raw-block--comment' : 'raw-block',
      title: 'Not editable yet — saved unchanged',
    };
    const id = node.attrs[BLOCK_ANCHOR_ATTR];
    const label = typeof id === 'string' ? (this.options.readerLinks?.labelFor(id) ?? null) : null;
    if (label === null) return ['pre', attributes, markdown];
    return ['pre', attributes, markdown, readerLink(id as string, label)];
  },
});

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
