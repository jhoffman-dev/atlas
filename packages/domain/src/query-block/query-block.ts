import type { EditorNode } from '../markdown/editor-node.ts';

/*
 * A live query inside a note (P30-05): a fenced code block whose language is
 * `atlas-query`, drawn by Atlas as the answer to the query it holds, and by
 * Obsidian as the code block it is. The fence's text is the whole of it —
 * an optional `layout:` line, then an Atlas query (ADR-0019) in which `this`
 * names the note the block is in.
 *
 *     ```atlas-query
 *     layout: list
 *     FROM meeting WHERE people = this SORT BY date DESC
 *     ```
 *
 * Only a block of the note's own is one, as a shown block is (ADR-0022): in a
 * list, a quote or a callout the fence stays the code block it is written as.
 */

/** The editor node a query block is: a block of its own, holding the fence's text. */
export const QUERY_BLOCK_NODE = 'queryBlock';

/** The fence's language that makes a code block a query block. */
export const QUERY_BLOCK_LANGUAGE = 'atlas-query';

/** How a query block draws its rows. */
export const QUERY_BLOCK_LAYOUTS = ['table', 'list'] as const;
export type QueryBlockLayout = (typeof QUERY_BLOCK_LAYOUTS)[number];

/** A fenced code block as the file holds it: its info string cut in two, and its text. */
export interface FencedCode {
  readonly language: string | null;
  /** What follows the language on the fence's line, or null when nothing does. */
  readonly meta: string | null;
  readonly text: string;
}

/** What a query block's text says: the layout and the query, or why it cannot be run. */
export type QueryBlockReading =
  | { readonly ok: true; readonly layout: QueryBlockLayout; readonly query: string }
  | { readonly ok: false; readonly problem: string };

/** The node for a query block holding `text`, the fence's text as written. */
export function queryBlockNode(text: string): EditorNode {
  return { type: QUERY_BLOCK_NODE, attrs: { text } };
}

/**
 * The query block a fenced code block of the note's own stands as, or null.
 * A fence that says anything after `atlas-query` is left a code block: a
 * query block is written back with its language alone, and the rest would go.
 */
export function queryBlockOfCode(code: FencedCode): EditorNode | null {
  if (code.language !== QUERY_BLOCK_LANGUAGE || code.meta !== null) return null;
  return queryBlockNode(code.text);
}

/** The fence's text a query block node holds. */
export function queryBlockText(node: EditorNode): string {
  const text = node.attrs?.['text'];
  return typeof text === 'string' ? text : '';
}

/**
 * A query block as markdown holds it, for a copy taken as plain text: its
 * text fenced with its language, the fence a backtick longer than any run
 * of backticks inside, as CommonMark needs and the file's writer does.
 */
export function queryBlockFence(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  const body = text === '' ? '' : `${text}\n`;
  return `${fence}${QUERY_BLOCK_LANGUAGE}\n${body}${fence}`;
}

/**
 * The code block a query block is written as where only a code block can
 * stand — inside a quote, a list or a cell: the same fence, which is how the
 * file holds it anyway.
 */
export function codeOfQueryBlock(node: EditorNode): EditorNode | null {
  if (node.type !== QUERY_BLOCK_NODE) return null;
  const text = queryBlockText(node);
  return {
    type: 'codeBlock',
    attrs: { language: QUERY_BLOCK_LANGUAGE },
    ...(text === '' ? {} : { content: [{ type: 'text', text }] }),
  };
}

/**
 * A `layout:` line, its value being the rest of the line. Any space `trim`
 * would take — a no-break space pasted in, say — is a space here too, so a
 * line that looks right reads right.
 */
const LAYOUT_LINE = /^\s*layout:\s*(.*?)\s*$/;

/**
 * Reads a query block's text: a first line (after any blank ones) saying
 * `layout: table` or `layout: list`, which may be left out for a table, and
 * the query after it.
 */
export function readQueryBlock(text: string): QueryBlockReading {
  const lines = text.split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim() !== '');
  const layoutLine = first === -1 ? null : LAYOUT_LINE.exec(lines[first] ?? '');
  const query = layoutLine === null ? text : lines.slice(first + 1).join('\n');
  const layout = layoutLine === null ? 'table' : layoutLine[1];
  if (!isQueryBlockLayout(layout)) return { ok: false, problem: layoutProblem(layout ?? '') };
  if (query.trim() === '') return { ok: false, problem: EMPTY_PROBLEM };
  return { ok: true, layout, query };
}

const EMPTY_PROBLEM =
  'This query block has no query yet. Write one, such as FROM task WHERE status != done.';

function isQueryBlockLayout(layout: string | undefined): layout is QueryBlockLayout {
  return QUERY_BLOCK_LAYOUTS.some((known) => known === layout);
}

function layoutProblem(layout: string): string {
  return layout === ''
    ? 'Say how to show the rows after layout: — table or list.'
    : `A query block shows a table or a list; “${layout}” is neither.`;
}
