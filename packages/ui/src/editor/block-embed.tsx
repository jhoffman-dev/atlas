import { useEffect, useMemo, useRef, useState } from 'react';
import { mergeAttributes, Node, type AnyExtension } from '@tiptap/core';
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type NodeViewProps,
} from '@tiptap/react';
import {
  BLOCK_EMBED_NODE,
  linkOfNode,
  type EditorDocument,
  type Transclusion,
  type WikiLink,
} from '@atlas/domain';
import { Icon } from '../icon.tsx';
import { linkAttributes } from './link-attributes.ts';
import { showAsRead } from './block-anchor.ts';

/** Where a shown block comes from: the note it names, read by the page. */
export interface TransclusionSource {
  /** What the embed shows of the block its link names. */
  readonly load: (link: WikiLink) => Promise<Transclusion>;
  /** A picture in a shown block, as its own note names it. */
  readonly loadImage: (args: { path: string; src: string }) => Promise<string | null>;
  /**
   * Calls `listener` whenever a shown block may have changed — a note was
   * saved, made or moved — so each is read again.
   */
  readonly subscribe: (listener: () => void) => () => void;
}

export interface BlockEmbedOptions {
  /** Null where embeds are only drawn, not read: a feed, a picture of a page. */
  readonly source: TransclusionSource | null;
  /**
   * The nodes a shown block is drawn with: the note's reading schema, handed
   * in by the editor's own set (`extensions.ts`), which holds this node too.
   */
  readonly reading: ((loadImage: (src: string) => Promise<string | null>) => AnyExtension[]) | null;
}

type EmbedState = Transclusion | { readonly kind: 'loading' | 'failed' };

const linkOf = (attrs: Record<string, unknown>): WikiLink =>
  linkOfNode({ type: BLOCK_EMBED_NODE, attrs });

function EmbedView({ node, extension, selected }: NodeViewProps) {
  const { source, reading } = extension.options as BlockEmbedOptions;
  const link = linkOf(node.attrs);
  const state = useTransclusion(source, link);
  const title =
    state.kind === 'block' || state.kind === 'missing-block' ? state.title : link.target;
  const classes = ['block-embed'];
  if (state.kind === 'missing-note' || state.kind === 'missing-block' || state.kind === 'failed')
    classes.push('block-embed--broken');
  if ((state.kind === 'block' || state.kind === 'missing-block') && state.archived)
    classes.push('block-embed--archived');
  if (selected) classes.push('block-embed--selected');
  return (
    <NodeViewWrapper
      className={classes.join(' ')}
      data-block-embed={link.target}
      role="group"
      aria-label={`Embedded block from ${title || 'this note'}`}
    >
      <div className="block-embed__source" contentEditable={false}>
        <Icon name="doc" size={13} />
        <span
          className="block-embed__name wikilink"
          role="link"
          tabIndex={0}
          data-wikilink={link.target}
          {...(link.heading !== null && { 'data-heading': link.heading })}
          title="Open the block where it is written"
        >
          {title || 'This note'}
        </span>
        {(state.kind === 'block' || state.kind === 'missing-block') && state.archived && (
          <span className="block-embed__chip">Archived</span>
        )}
      </div>
      <EmbedBody state={state} link={link} options={{ source, reading }} />
    </NodeViewWrapper>
  );
}

/** What the embed shows, read again whenever its source says a note may have changed. */
function useTransclusion(source: TransclusionSource | null, link: WikiLink): EmbedState {
  const { target, heading, alias } = link;
  // What was last read is kept while the block is read again, so a save does not flash it.
  const [state, setState] = useState<EmbedState>({ kind: 'loading' });
  const [revision, setRevision] = useState(0);

  useEffect(() => source?.subscribe(() => setRevision((count) => count + 1)), [source]);

  useEffect(() => {
    if (source === null) return;
    let cancelled = false;
    const settle = (next: EmbedState) => {
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

  return state;
}

function EmbedBody({
  state,
  link,
  options,
}: {
  state: EmbedState;
  link: WikiLink;
  options: BlockEmbedOptions;
}) {
  const { source, reading } = options;
  if (state.kind === 'block' && source !== null && reading !== null) {
    return <EmbedContent doc={state.content} path={state.path} source={source} reading={reading} />;
  }
  if (state.kind === 'loading') return <p className="block-embed__note">Loading…</p>;
  return <p className="block-embed__note block-embed__note--warn">{problemOf(state, link)}</p>;
}

/** Why an embed shows nothing, in a sentence. */
function problemOf(state: EmbedState, link: WikiLink): string {
  if (state.kind === 'missing-note') {
    return `No note is called “${state.label}” — it may have been renamed or deleted.`;
  }
  if (state.kind === 'missing-block') {
    const fragment = state.fragment;
    if (fragment?.kind === 'heading') {
      return `“${state.title}” has no heading “${fragment.heading}” any more.`;
    }
    const id = fragment?.kind === 'block' ? fragment.id : (link.heading ?? '');
    return `“${state.title}” has no block ^${id} — it may have been deleted.`;
  }
  return 'This block could not be read just now.';
}

/**
 * The shown block, drawn as its own note draws it — through the reading
 * schema, so nothing can be typed into it here (P26-04 is where that would
 * change), and a picture in it is found beside its own note.
 */
function EmbedContent({
  doc,
  path,
  source,
  reading,
}: {
  doc: EditorDocument;
  path: string;
  source: TransclusionSource;
  reading: NonNullable<BlockEmbedOptions['reading']>;
}) {
  const extensions = useMemo(
    () => reading((src: string) => source.loadImage({ path, src })),
    [reading, source, path],
  );
  const editor = useEditor(
    {
      extensions,
      editable: false,
      content: doc as object,
      editorProps: {
        attributes: {
          class: 'editor editor--reading block-embed__body',
          'aria-label': 'Embedded block',
        },
      },
    },
    [extensions],
  );
  // A source saved elsewhere arrives as a new document. Every block is read
  // again whenever any note changes, so one that reads the same is left as
  // drawn rather than drawn again (A26-01).
  const drawn = useRef(JSON.stringify(doc));
  useEffect(() => {
    const next = JSON.stringify(doc);
    if (editor === null || next === drawn.current) return;
    drawn.current = next;
    showAsRead(editor, doc);
  }, [editor, doc]);
  return <EditorContent editor={editor} />;
}

/**
 * A block of another note shown in this one (P26-03, ADR-0022): a block of
 * its own, selected and deleted as one thing, read-only, live. In the file it
 * is `![[Note#^id]]` alone on its line. Where no source is given it is drawn
 * plainly — the embed as a link — so a feed or a picture of the page still
 * shows it, and still opens it.
 *
 * Like a card, it is one of the note's own blocks only (`TopLevelDocument`).
 */
export const BlockEmbed = Node.create<BlockEmbedOptions>({
  name: BLOCK_EMBED_NODE,
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { source: null, reading: null };
  },

  addAttributes() {
    return linkAttributes('data-block-embed');
  },

  parseHTML() {
    return [{ tag: 'div[data-block-embed]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const link = linkOf(node.attrs);
    return [
      'div',
      mergeAttributes({ class: 'block-embed block-embed--plain' }, HTMLAttributes),
      [
        'a',
        {
          'data-wikilink': link.target,
          ...(link.heading !== null && { 'data-heading': link.heading }),
          class: 'wikilink',
          role: 'link',
          tabindex: '0',
        },
        `${link.target}${link.heading ?? ''}`,
      ],
    ];
  },

  addNodeView() {
    return this.options.source === null ? null : ReactNodeViewRenderer(EmbedView);
  },
});
