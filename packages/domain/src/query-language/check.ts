/**
 * Checking a parsed query against the vault's types (ADR-0019).
 *
 * The parser knows the grammar; this knows the vault. It finds the first
 * thing that cannot mean anything here — a type that does not exist, a field
 * no listed type has, `<` on a select, a word where a date belongs — and
 * points at it. A query that passes compiles to SQL that can run.
 */

import { isDateLike } from '../index/property-value.ts';
import { isTagName } from '../tags/tag-name.ts';
import type { ObjectType } from '../types/property-def.ts';
import { RELATIVE_DATE_NAMES } from '../query/view-query.ts';
import type { AtlasQuery, Comparison, Condition, Expression, QueryValue } from './ast.ts';
import { resolveField, type FieldKind, type QueryField } from './fields.ts';
import { opText } from './parse.ts';
import { QueryTextError } from './query-text-error.ts';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Kinds whose values have an order: `<`, `>` and the rest mean something. */
const ORDERED: readonly FieldKind[] = ['number', 'date', 'modified', 'progress'];
/** Kinds whose values are words to search in. */
const WORDY: readonly FieldKind[] = [
  'text',
  'url',
  'select',
  'multiSelect',
  'relation',
  'title',
  'path',
  'type',
];
const DATES: readonly FieldKind[] = ['date', 'modified'];

/** The operators a field of this kind can be compared with, in the builder's order. */
export function comparisonsFor(kind: FieldKind): Comparison[] {
  if (kind === 'checkbox' || kind === 'tag') return ['=', '!='];
  const ordered: Comparison[] = ORDERED.includes(kind) ? ['<', '<=', '>', '>='] : [];
  const wordy: Comparison[] = WORDY.includes(kind) ? ['contains', 'startsWith'] : [];
  return ['=', '!=', ...ordered, ...wordy];
}

/** Whether a query can sort by this field: by its first value, which a tag has no order to give. */
export function isSortable(field: QueryField): boolean {
  return field.kind !== 'tag';
}

/**
 * Whether a query can group by this field. A note sits in one group, so a
 * field that holds several values — tags, a multi-select, a relation to many —
 * has no one group to put it in.
 */
export function isGroupable(field: QueryField): boolean {
  return groupRefusal(field) === null;
}

/**
 * Why a field cannot group notes, in words, or null when it can — the one
 * wording a query's check and a view's Group control both give.
 */
export function groupRefusal(field: Pick<QueryField, 'kind' | 'text' | 'many'>): string | null {
  if (!field.many) return null;
  return `A note can have several ${field.kind === 'tag' ? 'tags' : `of ${field.text}`}, so it cannot be grouped by it.`;
}

/** Throws a {@link QueryTextError} at the first thing in the query the vault cannot answer. */
export function checkAtlasQuery(query: AtlasQuery, types: readonly ObjectType[]): void {
  checkFrom(query, types);
  const from = query.from.map((name) => name.text);
  const field = (ref: Parameters<typeof resolveField>[0]) => resolveField(ref, types, from);

  if (query.where !== null) {
    checkConditionCount(query.where);
    checkExpression(query.where, field);
  }
  for (const key of query.sort) {
    if (!isSortable(field(key.field))) {
      throw new QueryTextError(
        'A note can have many tags, so it cannot be sorted by one.',
        key.field.span,
      );
    }
  }
  const grouped = new Set<string>();
  for (const level of query.group) {
    const resolved = field(level);
    const refusal = groupRefusal(resolved);
    if (refusal !== null) throw new QueryTextError(refusal, level.span);
    // As a view's subGroupBy: splitting each group by what made it splits nothing.
    if (grouped.has(resolved.text)) {
      throw new QueryTextError(
        `Each ${resolved.text} group holds one ${resolved.text}, so it cannot be split by it again.`,
        level.span,
      );
    }
    grouped.add(resolved.text);
  }
  for (const shown of query.show) field(shown);
}

function checkFrom(query: AtlasQuery, types: readonly ObjectType[]): void {
  const seen = new Set<string>();
  for (const name of query.from) {
    if (!IDENTIFIER.test(name.text) || !types.some((type) => type.name === name.text)) {
      throw new QueryTextError(`There is no type called ${name.text}.`, name.span);
    }
    if (seen.has(name.text)) throw new QueryTextError(`${name.text} is listed twice.`, name.span);
    seen.add(name.text);
  }
}

type Resolve = (ref: Condition['field']) => QueryField;

/**
 * How many conditions one query may hold: each binds a few values, and the
 * index binds at most 32766 in one statement. Far past anything typed.
 */
export const MAX_QUERY_CONDITIONS = 2000;

function checkConditionCount(where: Expression): void {
  const conditions = conditionsOf(where);
  const past = conditions[MAX_QUERY_CONDITIONS];
  if (past !== undefined) {
    throw new QueryTextError(
      `A query holds ${MAX_QUERY_CONDITIONS} conditions at most.`,
      past.span,
    );
  }
}

function conditionsOf(expression: Expression): Condition[] {
  if (expression.kind === 'compare' || expression.kind === 'empty') return [expression];
  if (expression.kind === 'not') return conditionsOf(expression.operand);
  return expression.operands.flatMap(conditionsOf);
}

function checkExpression(expression: Expression, field: Resolve): void {
  switch (expression.kind) {
    case 'and':
    case 'or':
      expression.operands.forEach((operand) => checkExpression(operand, field));
      return;
    case 'not':
      checkExpression(expression.operand, field);
      return;
    case 'empty':
      field(expression.field);
      return;
    case 'compare':
      checkComparison(expression, field(expression.field));
  }
}

function checkComparison(
  condition: Extract<Condition, { kind: 'compare' }>,
  field: QueryField,
): void {
  const { op, value } = condition;
  if (!comparisonsFor(field.kind).includes(op)) {
    const allowed = comparisonsFor(field.kind).map(opText).join(', ');
    throw new QueryTextError(
      `${field.text} is ${article(field.kind)}; it can be compared with ${allowed}.`,
      condition.span,
    );
  }
  const problem = valueProblem(field, op, value);
  if (problem !== null) throw new QueryTextError(problem, value.span);
}

/** Why this value cannot be compared with this field, or null when it can. */
function valueProblem(field: QueryField, op: Comparison, value: QueryValue): string | null {
  if (value.kind === 'relativeDate') {
    if (!DATES.includes(field.kind)) return `@${value.name} is a date, and ${field.text} is not.`;
    return RELATIVE_DATE_NAMES.includes(`@${value.name}`)
      ? null
      : `There is no date called @${value.name}. Try ${RELATIVE_DATE_NAMES.join(', ')}.`;
  }
  if (op === 'contains' || op === 'startsWith') {
    return value.kind === 'text' || value.kind === 'number' ? null : `${opText(op)} takes text.`;
  }
  return VALUE_RULES[field.kind](value, field);
}

type ValueRule = (
  value: Exclude<QueryValue, { kind: 'relativeDate' }>,
  field: QueryField,
) => string | null;

const textual: ValueRule = (value, field) => {
  if (value.kind === 'text' || value.kind === 'number') return null;
  if (value.kind === 'tag') return `#${value.name} is a tag; compare it with tag.`;
  if (value.kind === 'link')
    return `[[${value.target}]] is a link, and ${field.text} is not a relation.`;
  return `${field.text} holds text, not true or false.`;
};

const numeric: ValueRule = (value, field) =>
  value.kind === 'number' ? null : `${field.text} is a number: compare it with a number.`;

const dated: ValueRule = (value, field) =>
  value.kind === 'text' && isDateLike(value.text)
    ? null
    : `${field.text} is a date: compare it with a date like 2026-09-30, or @today.`;

const VALUE_RULES: Readonly<Record<FieldKind, ValueRule>> = {
  text: textual,
  url: textual,
  select: textual,
  multiSelect: textual,
  thumbnail: textual,
  title: textual,
  path: textual,
  type: textual,
  number: numeric,
  progress: numeric,
  date: dated,
  modified: dated,
  checkbox: (value, field) =>
    value.kind === 'boolean' ? null : `${field.text} is a checkbox: compare it with true or false.`,
  relation: (value, field) =>
    value.kind === 'link' || value.kind === 'text'
      ? null
      : `${field.text} points at a note: compare it with a link like [[Julie]].`,
  tag: (value) => {
    const name = value.kind === 'tag' ? value.name : value.kind === 'text' ? value.text : null;
    return name !== null && isTagName(name) ? null : 'tag is compared with a tag, like #q3.';
  },
};

function article(kind: FieldKind): string {
  const words: Readonly<Partial<Record<FieldKind, string>>> = {
    text: 'text',
    multiSelect: 'a multi-select',
    modified: 'a date',
    progress: 'a number',
    title: 'text',
    path: 'text',
    type: 'a type',
    url: 'a link',
    tag: 'a tag',
  };
  return words[kind] ?? `a ${kind}`;
}
