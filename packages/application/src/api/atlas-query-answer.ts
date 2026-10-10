import {
  DEFAULT_QUERY_LIMIT,
  groupResultRows,
  MAX_QUERY_LIMIT,
  noteNames,
  positionIn,
  toBoardRows,
  type BoardRow,
  type CompiledAtlasQuery,
  type RowGroup,
  type VaultPath,
} from '@atlas/domain';
import { readNamedNotes } from '../graph/load-graph.ts';
import { AtlasQueryError, runAtlasQuery, type AtlasQueryAnswer } from '../query/run-atlas-query.ts';
import { loadObjectTypes } from '../types/load-types.ts';
import { listVaultNotes } from '../vault/read-vault.ts';
import { ApiError, messageWithoutPaths } from './api-error.ts';
import type { ApiQueryGroup, ApiRows } from './contract.ts';
import type { VaultRequest } from './vault-request.ts';

/*
 * An Atlas query (ADR-0019) answered for the API, shared by /v1/atlas-query
 * and the views route. The compiled query reads the vault's own notes only —
 * rows, relation hops and the notes groups are named by — so nothing here
 * filters rows after the index answers, and a page fills to its limit.
 */

/** What an Atlas query is checked and resolved against: the vault's types and notes, as the app has them. */
export async function vaultQueryContext(request: VaultRequest) {
  const [types, notePaths] = await Promise.all([
    loadObjectTypes({ fs: request.fs, markdown: request.markdown }),
    listVaultNotes({ fs: request.fs }),
  ]);
  return { types, notePaths };
}

/** A query's text, as asked for through the API. */
export interface AskedAtlasQuery {
  readonly text: string;
  /** The caller's limit, or null for the text's own LIMIT (or the default) alone. */
  readonly asked: number | null;
  /** The note the query is shown on, which `this` names; null for none. */
  readonly thisNote?: VaultPath | null;
}

/**
 * A query's text run against the request's vault, one row past the page so
 * `truncated` can say whether more matched.
 */
export async function answerAtlasQueryPage(
  request: VaultRequest,
  { text, asked, thisNote = null }: AskedAtlasQuery,
): Promise<{ answer: AtlasQueryAnswer; rows: ApiRows }> {
  const answer = await answerAtlasQuery(request, {
    text,
    thisNote,
    fetchLimit: (textLimit) => Math.min(rowLimit(textLimit, asked) + 1, MAX_QUERY_LIMIT),
  });
  return { answer, rows: pageOf(answer, rowLimit(answer.query.limit, asked)) };
}

/**
 * Runs a query's text against the request's vault. A problem in the text is
 * `invalid`, with where it is; the index refusing the SQL is `query_failed`;
 * a `this` naming a note the vault does not have is `not_found`.
 */
async function answerAtlasQuery(
  request: VaultRequest,
  {
    text,
    thisNote,
    fetchLimit,
  }: {
    text: string;
    thisNote: VaultPath | null;
    fetchLimit: (textLimit: number | null) => number;
  },
): Promise<AtlasQueryAnswer> {
  try {
    const context = await vaultQueryContext(request);
    if (thisNote !== null && !context.notePaths.includes(thisNote)) {
      throw new ApiError('not_found', `No note at ${thisNote}`);
    }
    return await runAtlasQuery({ index: request.index, text, ...context, thisNote, fetchLimit });
  } catch (error) {
    if (error instanceof AtlasQueryError && error.problem !== null) {
      const { span, message } = error.problem;
      const at = { ...positionIn(text, span.start), start: span.start, end: span.end };
      throw new ApiError('invalid', `Line ${at.line}, column ${at.column}: ${message}`, { at });
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError('query_failed', messageWithoutPaths(error));
  }
}

/** The rows to answer with: the text's own LIMIT when it is smaller than the one asked for. */
function rowLimit(textLimit: number | null, asked: number | null): number {
  return Math.min(textLimit ?? MAX_QUERY_LIMIT, asked ?? textLimit ?? DEFAULT_QUERY_LIMIT);
}

/**
 * The rows up to the limit. One more than the limit was asked for, so
 * `truncated` says whether more matched; at the row cap, a full window errs
 * towards saying more did.
 */
function pageOf({ result }: AtlasQueryAnswer, limit: number): ApiRows {
  const full = result.rows.length > limit || result.rows.length === MAX_QUERY_LIMIT;
  return {
    columns: result.columns,
    rows: result.rows.slice(0, limit),
    truncated: result.truncated || full,
    sql: result.sql,
  };
}

/** The rows' groups as the app draws a list of them, each row named by its place in `rows`. */
export async function groupsOf(
  request: VaultRequest,
  compiled: CompiledAtlasQuery,
  { columns, rows }: ApiRows,
): Promise<ApiQueryGroup[]> {
  const boardRows = toBoardRows({ columns, rows });
  // A relation's groups are named for the note, so only then are the titles read.
  const byRelation = compiled.groups.some((field) => field.kind === 'relation');
  const names = noteNames(byRelation ? await readNamedNotes({ index: request.index }) : null);
  const places = new Map(boardRows.map((row, place) => [row, place]));
  return groupResultRows({ rows: boardRows, groups: compiled.groups, names }).map((group) =>
    toApiGroup(group, places),
  );
}

/** A group with each of its rows named by its place among the rows answered. */
export function toApiGroup(group: RowGroup, places: ReadonlyMap<BoardRow, number>): ApiQueryGroup {
  return {
    label: group.label,
    value: group.value,
    rows: group.rows.map((row) => placeOf(row, places)),
    groups: group.subgroups.map((subgroup) => toApiGroup(subgroup, places)),
  };
}

function placeOf(row: BoardRow, places: ReadonlyMap<BoardRow, number>): number {
  const place = places.get(row);
  // Every grouped row is one of the rows it was handed; a stray one is our bug, not the caller's.
  if (place === undefined)
    throw new Error(`a group holds a row that was not answered: ${row.path}`);
  return place;
}
