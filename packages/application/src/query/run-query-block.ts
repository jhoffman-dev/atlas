import { NO_SPAN, readQueryBlock, type ObjectType, type QueryBlockLayout } from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import { AtlasQueryError, runAtlasQuery, type AtlasQueryAnswer } from './run-atlas-query.ts';

export interface QueryBlockAnswer {
  /** How the block draws its rows, as its `layout:` line says. */
  readonly layout: QueryBlockLayout;
  readonly answer: AtlasQueryAnswer;
}

/**
 * Answers a query block in a note (P30-05): its text read for a layout and a
 * query, and the query run as any Atlas query is, with `this` naming the note
 * the block is in. A layout it cannot draw, or no query at all, is a problem
 * in its text, as a field that does not exist is.
 */
export async function runQueryBlock({
  index,
  text,
  types,
  notePaths,
  notePath,
}: {
  index: IndexPort;
  /** The fence's text, as the note holds it. */
  text: string;
  types: readonly ObjectType[];
  notePaths: readonly string[];
  /** The note the block is in. */
  notePath: string;
}): Promise<QueryBlockAnswer> {
  const reading = readQueryBlock(text);
  if (!reading.ok) {
    throw new AtlasQueryError(reading.problem, { message: reading.problem, span: NO_SPAN });
  }
  const answer = await runAtlasQuery({
    index,
    text: reading.query,
    types,
    notePaths,
    thisNote: notePath,
  });
  return { layout: reading.layout, answer };
}
