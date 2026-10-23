import { Node } from '@tiptap/core';
import { Fragment, Slice, type Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { BLOCK_ANCHOR_ATTR, withoutBlockIds, withoutMarkerLines } from '@dfai/domain';

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
      // Read only from `data-markdown`, by the parse rule: a bare `markdown`
      // attribute, which Tiptap would read by default, is not DFAI's.
      markdown: { default: '', parseHTML: () => null },
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
          const markdown = sourceFromAttribute(element.getAttribute('data-markdown'));
          return markdown === null ? false : { markdown };
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('rawBlockPaste'),
        props: {
          // A block moved within the note is the same block, source and all.
          transformPasted: (slice, view) =>
            view.dragging?.move === true ? slice : pastedSlice(slice),
        },
      }),
    ];
  },

  // A paste into another app gets the source: a raw block has no text of its own.
  // DFAI's marker lines, which every reader hides, are left out of it.
  renderText({ node }) {
    return withoutMarkerLines(String(node.attrs['markdown'] ?? ''));
  },

  renderHTML({ node }) {
    const markdown = String(node.attrs['markdown'] ?? '');
    const attributes = {
      'data-raw-block': '',
      // Percent-encoded: serialisers leave `<` bare in an attribute, which
      // would put the source's tags into the HTML of a page made from the note.
      'data-markdown': encodeURIComponent(markdown),
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
 * A pasted slice with each raw block's source as a paste may bring it: no
 * DFAI marker — a highlight's anchor, a tombstone — which a copy would
 * duplicate or a web page forge, and no block id, which the note may hold
 * already (ADR-0022). A raw block left with nothing is dropped.
 */
function pastedSlice(slice: Slice): Slice {
  const content = pastedFragment(slice.content);
  if (content === slice.content) return slice;
  if (content.childCount === 0) return Slice.empty;
  // An open side stays open only where its node is still the one it opened into.
  const openStart = content.firstChild === slice.content.firstChild ? slice.openStart : 0;
  const openEnd = content.lastChild === slice.content.lastChild ? slice.openEnd : 0;
  return new Slice(content, openStart, openEnd);
}

function pastedFragment(fragment: Fragment): Fragment {
  let changed = false;
  const children: PmNode[] = [];
  fragment.forEach((child) => {
    const pasted = pastedNode(child);
    if (pasted !== child) changed = true;
    if (pasted !== null) children.push(pasted);
  });
  return changed ? Fragment.from(children) : fragment;
}

function pastedNode(node: PmNode): PmNode | null {
  if (node.type.name !== 'rawBlock') {
    if (node.isLeaf) return node;
    const content = pastedFragment(node.content);
    if (content === node.content) return node;
    // A container left without the content it must hold goes with its raw blocks.
    return node.type.validContent(content) ? node.copy(content) : null;
  }
  const markdown = String(node.attrs['markdown'] ?? '');
  const pasted = withoutBlockIds(withoutMarkerLines(markdown));
  if (pasted === markdown) return node;
  if (pasted.trim() === '') return null;
  return node.type.create({ ...node.attrs, markdown: pasted }, null, node.marks);
}

/** The source `data-markdown` holds, or null without one or with one DFAI did not write. */
const sourceFromAttribute = (encoded: string | null): string | null => {
  if (encoded === null) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    // Not percent-encoding, so not ours: the code block's rule reads it instead.
    return null;
  }
};

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
