import {
  compileLinkHintsQuery,
  isArchivedPath,
  LINK_HINTS_QUERY_COLUMNS,
  type LinkHints,
  type LinkUse,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';

const MARKDOWN = /\.(md|markdown)$/i;

/** What a link field's suggestions are read from, beyond a relation's own notes. */
export interface LinkHintsRead {
  /** Every note a link may be offered to, for `[[` in a plain text field. */
  readonly notes: readonly { readonly path: string; readonly title: string }[];
  readonly hints: LinkHints;
}

type Row = readonly unknown[];

/**
 * The notes a link field may suggest, their aliases and how much each is
 * linked (#465), in one read of the index — made only once a picker opens.
 * An archived note is never offered; a row the index answers that cannot be
 * read is skipped. An index that cannot answer is passed on, for the picker
 * to say so.
 */
export async function readLinkHints({
  index,
}: {
  index: Pick<IndexPort, 'query'>;
}): Promise<LinkHintsRead> {
  const { sql, parameters } = compileLinkHintsQuery();
  const result = await index.query(sql, parameters);
  const [kindAt, pathAt, textAt, usesAt, lastAt] = LINK_HINTS_QUERY_COLUMNS.map((column) =>
    result.columns.indexOf(column),
  ) as [number, number, number, number, number];
  const notes: { path: string; title: string }[] = [];
  const aliases = new Map<string, string[]>();
  const uses = new Map<string, LinkUse>();
  for (const row of result.rows) {
    const path = row[pathAt];
    if (typeof path !== 'string') continue;
    const kind = row[kindAt];
    if (kind === 'note') addNote(notes, path, row[textAt]);
    else if (kind === 'alias') addAlias(aliases, path, row[textAt]);
    else if (kind === 'use') addUse(uses, path, row, { usesAt, lastAt });
  }
  return { notes, hints: { aliases, uses } };
}

function addNote(notes: { path: string; title: string }[], path: string, title: unknown): void {
  if (typeof title === 'string' && MARKDOWN.test(path) && !isArchivedPath(path)) {
    notes.push({ path, title });
  }
}

function addAlias(aliases: Map<string, string[]>, path: string, alias: unknown): void {
  if (typeof alias !== 'string') return;
  aliases.set(path, [...(aliases.get(path) ?? []), alias]);
}

function addUse(
  uses: Map<string, LinkUse>,
  path: string,
  row: Row,
  { usesAt, lastAt }: { usesAt: number; lastAt: number },
): void {
  const count = row[usesAt];
  const last = row[lastAt];
  if (typeof count !== 'number') return;
  uses.set(path, { count, last: typeof last === 'number' ? last : 0 });
}
