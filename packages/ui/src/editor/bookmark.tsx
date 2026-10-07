import { useEffect, useState } from 'react';
import { mergeAttributes, Node } from '@tiptap/core';
import { Fragment, Slice, type Node as ProseMirrorNode, type Schema } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import {
  BLOCK_EMBED_NODE,
  BOOKMARK_NODE,
  linkOfNode,
  nestedBlockOf,
  wikiLinkLabel,
  type EditorNode,
  type WikiLink,
} from '@atlas/domain';
import {
  BookmarkCard,
  bookmarkClass,
  type BookmarkPreview,
  type BookmarkState,
} from '../bookmark-card.tsx';
import { linkAttributes } from './link-attributes.ts';
import { requestLinkMenu } from './link-keys.ts';

/** Where a bookmark's card comes from: the note's file, read by the page. */
export interface BookmarkSource {
  /** What the card shows of the note a link opens. */
  readonly load: (link: WikiLink) => Promise<BookmarkPreview>;
  /**
   * Calls `listener` whenever a card may show something new — a note was
   * saved, made or moved — so each card reads its note again.
   */
  readonly subscribe: (listener: () => void) => () => void;
}

export interface BookmarkOptions {
  /** Null where cards are only drawn, not read: a feed, a picture of a page. */
  readonly source: BookmarkSource | null;
}

const linkOf = (attrs: Record<string, unknown>): WikiLink =>
  linkOfNode({ type: BOOKMARK_NODE, attrs });

function BookmarkView({ node, extension, selected, getPos }: NodeViewProps) {
  const { source } = extension.options as BookmarkOptions;
  const link = linkOf(node.attrs);
  const { target, heading, alias } = link;
  // What was last read is kept while the card is read again, so a save does not flash it.
  const [state, setState] = useState<BookmarkState>({ kind: 'loading' });
  const [revision, setRevision] = useState(0);

  useEffect(() => source?.subscribe(() => setRevision((count) => count + 1)), [source]);

  useEffect(() => {
    if (source === null) return;
    let cancelled = false;
    const settle = (next: BookmarkState) => {
      if (!cancelled) setState(next);
    };
    source
      .load({ target, heading, alias })
      .then(settle)
      .catch(() => settle({ kind: 'failed' }));
    return () => {
      cancelled = true;
    };
  }, [source, revision, target, heading, alias]);

  const title = state.kind === 'note' ? state.title : wikiLinkLabel(link);
  return (
    <NodeViewWrapper
      className={bookmarkClass(state, selected)}
      data-bookmark={target}
      data-wikilink={target}
      role="group"
      aria-label={`Bookmark: ${title}`}
    >
      <BookmarkCard
        label={wikiLinkLabel(link)}
        state={state}
        onOptions={(anchor) => {
          const at = getPos();
          if (at !== undefined) requestLinkMenu(anchor, at);
        }}
      />
    </NodeViewWrapper>
  );
}

/**
 * A link shown as a card (U-21, ADR-0020): a block of its own, selected and
 * deleted as one thing. In the file it is `[[Note]] <!-- atlas:bookmark -->`.
 * Where no source is given it is drawn plainly — the link inside a card — so
 * a feed or a picture of the page still shows it, and still opens it.
 *
 * A card is one of the note's own blocks only: it is in no group, and only
 * the document (`TopLevelDocument`) holds it, so no quote, callout, list item
 * or table cell can — by drag, by paste or by command. Pasted into one, it
 * becomes its link, where it was pasted.
 */
export const Bookmark = Node.create<BookmarkOptions>({
  name: BOOKMARK_NODE,
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { source: null };
  },

  addAttributes() {
    return linkAttributes('data-bookmark');
  },

  parseHTML() {
    return [{ tag: 'div[data-bookmark]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const link = linkOf(node.attrs);
    return [
      'div',
      mergeAttributes({ class: 'bookmark bookmark--plain' }, HTMLAttributes),
      [
        'a',
        { 'data-wikilink': link.target, class: 'wikilink', role: 'link', tabindex: '0' },
        wikiLinkLabel(link),
      ],
    ];
  },

  addNodeView() {
    return this.options.source === null ? null : ReactNodeViewRenderer(BookmarkView);
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          // The caret is inside another block, where a card cannot stand.
          transformPasted: (slice, view) =>
            view.state.selection.$from.depth > 1 ? linksForCards(slice, view.state.schema) : slice,
        },
      }),
    ];
  },
});

/** The document, which alone holds a card among its blocks. */
export const TopLevelDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: `(block | ${BOOKMARK_NODE} | ${BLOCK_EMBED_NODE})+`,
});

/**
 * A pasted slice with each card in it made its link (`nestedBlockOf`). A card
 * pasted on its own goes in as the link alone, into the line at the caret.
 */
function linksForCards(slice: Slice, schema: Schema): Slice {
  const only = slice.content.childCount === 1 ? slice.content.firstChild : null;
  const content = withLinksForCards(slice.content, schema);
  const card = only?.type.name === BOOKMARK_NODE || only?.type.name === BLOCK_EMBED_NODE;
  if (card && slice.openStart === 0 && slice.openEnd === 0) {
    return new Slice(content, 1, 1);
  }
  return new Slice(content, slice.openStart, slice.openEnd);
}

function withLinksForCards(fragment: Fragment, schema: Schema): Fragment {
  const nodes: ProseMirrorNode[] = [];
  fragment.forEach((node) => {
    if (node.type.name === BOOKMARK_NODE || node.type.name === BLOCK_EMBED_NODE) {
      nodes.push(schema.nodeFromJSON(nestedBlockOf(node.toJSON() as EditorNode)));
    } else {
      nodes.push(node.copy(withLinksForCards(node.content, schema)));
    }
  });
  return Fragment.from(nodes);
}
