import { useEffect, useRef, useState } from 'react';
import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { QUERY_BLOCK_LANGUAGE, QUERY_BLOCK_NODE, queryBlockFence } from '@atlas/domain';
import { Icon } from '../icon.tsx';
import { GroupedResult, type GroupedResultProps } from '../query-language/grouped-result.tsx';

/** A query block's rows, ready to draw in the layout its text says. */
export type QueryBlockRows = Pick<GroupedResultProps, 'layout' | 'fields' | 'rows' | 'groups'>;

/** What a query block shows: its rows, or why it has none to show. */
export type QueryBlockShown =
  | {
      readonly kind: 'rows';
      readonly result: QueryBlockRows;
      /** Whether more notes matched than were drawn. */
      readonly truncated: boolean;
    }
  | { readonly kind: 'problem'; readonly message: string };

/** Where a query block's answer comes from: the note it is in, which `this` names. */
export interface QueryBlockSource {
  /** What a block holding `text` shows. */
  readonly run: (text: string) => Promise<QueryBlockShown>;
  /** Opens a note one of the rows names. */
  readonly onOpenNote: (path: string) => void;
  /** Calls `listener` whenever an answer may have changed — the index was refreshed. */
  readonly subscribe: (listener: () => void) => () => void;
}

export interface QueryBlockOptions {
  /** Null where a block is only drawn, not run: a feed, a picture of a page, a shown block. */
  readonly source: QueryBlockSource | null;
}

type QueryState = QueryBlockShown | { readonly kind: 'loading' | 'failed' };

/** How long typing must pause before the query is run again, as on the Query page. */
const TYPING_PAUSE_MS = 200;

const textOf = (attrs: Record<string, unknown>): string =>
  typeof attrs['text'] === 'string' ? attrs['text'] : '';

function QueryBlockView({ node, extension, editor, selected, updateAttributes }: NodeViewProps) {
  const { source } = extension.options as QueryBlockOptions;
  const text = textOf(node.attrs);
  // A block with nothing in it has nothing to show but its text, so it opens there.
  const [editing, setEditing] = useState(text.trim() === '');
  const state = useAnswer(source, useSettled(text, TYPING_PAUSE_MS));
  const classes = ['query-block'];
  if (selected) classes.push('query-block--selected');
  return (
    <NodeViewWrapper className={classes.join(' ')} role="group" aria-label="Query block">
      <div className="query-block__bar">
        <Icon name="filter" size={13} />
        <span className="query-block__name">Query</span>
        {state.kind === 'rows' && (
          <span className="query-block__count" role="status">
            {countOf(state.result.rows.length, state.truncated)}
          </span>
        )}
        {editor.isEditable && (
          <button
            type="button"
            className="query-block__toggle"
            aria-pressed={editing}
            onClick={() => setEditing((was) => !was)}
          >
            {editing ? 'Done' : 'Edit query'}
          </button>
        )}
      </div>
      {editing && editor.isEditable && (
        <QueryText
          text={text}
          onChange={(next) => updateAttributes({ text: next })}
          focusFirst={text.trim() === '' && editor.isFocused}
        />
      )}
      <QueryAnswer state={state} onOpenNote={source?.onOpenNote ?? noOpen} />
    </NodeViewWrapper>
  );
}

const noOpen = () => {};

/** The block's text, as the fence holds it, typed into as code is. */
function QueryText({
  text,
  onChange,
  focusFirst,
}: {
  text: string;
  onChange: (text: string) => void;
  /** Takes the caret when it appears: a block just made, to be written. */
  focusFirst: boolean;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [focusOnMount] = useState(focusFirst);
  useEffect(() => {
    if (focusOnMount) field.current?.focus();
  }, [focusOnMount]);
  return (
    <textarea
      ref={field}
      className="query-block__text"
      aria-label="Query text"
      spellCheck={false}
      rows={Math.max(2, text.split('\n').length)}
      placeholder={'layout: list\nFROM meeting WHERE people = this'}
      value={text}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** The answer, asked again when the text settles and whenever the source says it may have changed. */
function useAnswer(source: QueryBlockSource | null, text: string): QueryState {
  // What was last shown is kept while the query runs again, so a save does not flash it.
  const [state, setState] = useState<QueryState>({ kind: 'loading' });
  const [revision, setRevision] = useState(0);

  useEffect(() => source?.subscribe(() => setRevision((count) => count + 1)), [source]);

  useEffect(() => {
    if (source === null) return;
    let cancelled = false;
    const settle = (next: QueryState) => {
      if (!cancelled) setState(next);
    };
    source
      .run(text)
      .then(settle)
      .catch(() => settle({ kind: 'failed' }));
    return () => {
      cancelled = true;
    };
  }, [source, revision, text]);

  return state;
}

/** `value`, once it has held still for `delay` milliseconds. */
function useSettled(value: string, delay: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

function QueryAnswer({
  state,
  onOpenNote,
}: {
  state: QueryState;
  onOpenNote: (path: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  if (state.kind === 'loading') return <p className="query-block__note">Running the query…</p>;
  if (state.kind !== 'rows') {
    const message =
      state.kind === 'problem' ? state.message : 'This query could not be run just now.';
    return (
      <p className="query-block__note query-block__note--warn" role="alert">
        {message}
      </p>
    );
  }
  const toggle = (id: string) =>
    setCollapsed((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <div className="query-block__rows">
      <GroupedResult
        {...state.result}
        collapsed={collapsed}
        onToggleGroup={toggle}
        onOpenNote={onOpenNote}
      />
    </div>
  );
}

function countOf(count: number, truncated: boolean): string {
  const notes = count === 1 ? '1 note' : `${count} notes`;
  return truncated ? `${notes} (more were left out)` : notes;
}

/**
 * A live query in a note (P30-05): the answer to the query a fenced
 * `atlas-query` block holds, drawn as a table or a list, read-only, asked
 * again whenever the index changes. Its text is edited in place, behind
 * **Edit query**. In the file it stays the fence, so Obsidian shows the code.
 * Where no source is given it is drawn as that code.
 *
 * Like a card, it is one of the note's own blocks only (`TopLevelDocument`).
 */
export const QueryBlock = Node.create<QueryBlockOptions>({
  name: QUERY_BLOCK_NODE,
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { source: null };
  },

  addAttributes() {
    return {
      text: {
        default: '',
        parseHTML: (element) => element.textContent ?? '',
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    // Above the code block's own `pre` rule, which would otherwise take a
    // copied query block first and make a code block of it (the default is 50).
    return [{ tag: 'pre[data-query-block]', preserveWhitespace: 'full', priority: 60 }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'pre',
      mergeAttributes(
        { 'data-query-block': '', class: 'query-block query-block--plain' },
        HTMLAttributes,
      ),
      // The fence's language on the code, as a code block writes its own, so
      // anything that reads this as a code block still knows what it was.
      ['code', { class: `language-${QUERY_BLOCK_LANGUAGE}` }, textOf(node.attrs)],
    ];
  },

  /** A copy taken as plain text is the fence, as the file has it. */
  renderText({ node }) {
    return queryBlockFence(textOf(node.attrs));
  },

  addNodeView() {
    return this.options.source === null ? null : ReactNodeViewRenderer(QueryBlockView);
  },
});
