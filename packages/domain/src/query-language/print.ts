/**
 * Writing an {@link AtlasQuery} back as text — what the builder does to show
 * the text of what was picked, and what the text form round-trips through.
 *
 * One canonical spelling: keywords in capitals, clauses in the order of the
 * grammar, a value quoted only when it has to be. Text typed by hand is saved
 * as typed; this is only for a query the builder made.
 */

import { fieldText, numberText, type AtlasQuery, type Expression, type QueryValue } from './ast.ts';
import { splitWikiLinks } from '../markdown/wikilink.ts';
import { opText } from './parse.ts';

const BARE_WORD = /^[\p{L}\p{N}_][\p{L}\p{N}_-]*$/u;
const NUMBER = /^-?\d+(?:\.\d+)?$/;

/**
 * Words a bare value would be read as something else: a keyword where the
 * parser could expect one after a value, or a boolean.
 */
const RESERVED = new Set([
  'AND',
  'OR',
  'NOT',
  'TRUE',
  'FALSE',
  'WHERE',
  'SORT',
  'GROUP',
  'SHOW',
  'INCLUDE',
  'LIMIT',
  'THEN',
  'ASC',
  'DESC',
  'FROM',
  'IS',
  'EMPTY',
  'CONTAINS',
  'STARTS',
  'WITH',
  'BY',
  'ARCHIVED',
  'THIS',
]);

export function printAtlasQuery(query: AtlasQuery): string {
  const parts = [`FROM ${query.from.map((name) => name.text).join(', ')}`];
  if (query.where !== null) parts.push(`WHERE ${printExpression(query.where, 'or')}`);
  if (query.sort.length > 0) {
    const keys = query.sort.map(
      (key) => `${fieldText(key.field)}${key.direction === 'desc' ? ' DESC' : ''}`,
    );
    parts.push(`SORT BY ${keys.join(', ')}`);
  }
  if (query.group.length > 0) parts.push(`GROUP BY ${query.group.map(fieldText).join(' THEN ')}`);
  if (query.show.length > 0) parts.push(`SHOW ${query.show.map(fieldText).join(', ')}`);
  if (query.includeArchived) parts.push('INCLUDE ARCHIVED');
  if (query.limit !== null) parts.push(`LIMIT ${query.limit}`);
  return parts.join(' ');
}

const BINDING: Readonly<Record<'or' | 'and' | 'not', number>> = { or: 0, and: 1, not: 2 };

/** An expression, in brackets when the place it sits binds tighter than it does. */
function printExpression(expression: Expression, within: 'or' | 'and' | 'not'): string {
  switch (expression.kind) {
    case 'compare':
      return `${fieldText(expression.field)} ${opText(expression.op)} ${printValue(expression.value)}`;
    case 'empty':
      return `${fieldText(expression.field)} IS ${expression.negated ? 'NOT ' : ''}EMPTY`;
    case 'linksTo':
      return `LINKS TO ${printValue(expression.value)}`;
    case 'not':
      return `NOT ${printExpression(expression.operand, 'not')}`;
    default: {
      const joiner = expression.kind === 'and' ? ' AND ' : ' OR ';
      const text = expression.operands
        .map((operand) => printExpression(operand, expression.kind))
        .join(joiner);
      return BINDING[within] > BINDING[expression.kind] ? `(${text})` : text;
    }
  }
}

export function printValue(value: QueryValue): string {
  switch (value.kind) {
    case 'number':
      return numberText(value);
    case 'boolean':
      return value.value ? 'true' : 'false';
    case 'link':
      return linkReadsBack(value.target) ? `[[${value.target}]]` : quoted(value.target);
    case 'tag':
      return /\s/.test(value.name) ? quoted(value.name) : `#${value.name}`;
    case 'relativeDate':
      return `@${value.name}`;
    case 'this':
      return 'this';
    case 'text':
      return isBare(value.text) ? value.text : quoted(value.text);
  }
}

/** Whether `[[target]]` reads back as this target; `|Atlas` does not, so it is written as text. */
function linkReadsBack(target: string): boolean {
  const pieces = splitWikiLinks(`[[${target}]]`);
  const [piece] = pieces;
  return pieces.length === 1 && piece?.kind === 'wikiLink' && piece.target.trim() === target;
}

function isBare(text: string): boolean {
  return BARE_WORD.test(text) && !NUMBER.test(text) && !RESERVED.has(text.toUpperCase());
}

function quoted(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}
