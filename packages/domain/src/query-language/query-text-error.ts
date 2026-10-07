import type { Span } from './ast.ts';

/**
 * Something wrong with a query's text, and where: the editor underlines
 * `span` and says `message`, so a mistake is pointed at rather than described.
 */
export class QueryTextError extends Error {
  readonly span: Span;

  constructor(message: string, span: Span) {
    super(message);
    this.name = 'QueryTextError';
    this.span = span;
  }
}

/** A problem as plain data, for handing across to the page that shows it. */
export interface QueryProblem {
  readonly message: string;
  readonly span: Span;
}

export function problemOf(error: QueryTextError): QueryProblem {
  return { message: error.message, span: error.span };
}

/** Where a problem starts, as a person counts it: line and column from 1. */
export interface TextPosition {
  readonly line: number;
  readonly column: number;
}

/**
 * The line and column of an offset into a query's text (a span's `start`).
 * Columns count characters, not UTF-16 units, so an emoji is one column, as an
 * editor shows it. An offset past either end is held to the text.
 */
export function positionIn(text: string, offset: number): TextPosition {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)));
  const lineStart = before.lastIndexOf('\n') + 1;
  return {
    line: before.split('\n').length,
    column: [...before.slice(lineStart)].length + 1,
  };
}
