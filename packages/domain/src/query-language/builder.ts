/**
 * The query builder's view of a query (ADR-0019): what its dropdowns show and
 * change. It is the same {@link AtlasQuery} the text is, in a shape a form can
 * hold — a list of conditions all joined by AND or all by OR, each plain or
 * negated. A query that brackets AND inside OR cannot be one such list, so it
 * is not forced into one: {@link builderFromQuery} says why, and it stays text.
 */

import {
  fieldText,
  NO_SPAN,
  type AtlasQuery,
  type Comparison,
  type Condition,
  type Expression,
  type FieldRef,
  type QueryValue,
} from './ast.ts';
import { splitWikiLinks } from '../markdown/wikilink.ts';
import { MAX_QUERY_LIMIT } from '../query/view-query.ts';
import { comparisonsFor, conditionsOf } from './check.ts';
import type { FieldKind, QueryField } from './fields.ts';
import { countedLabel } from './moving-date.ts';

/** How a condition compares: one of the comparisons, or whether there is a value at all. */
export type BuilderOperator = Comparison | 'isEmpty' | 'isNotEmpty';

export interface BuilderCondition {
  /** The field as written: `status`, `project.owner`. */
  readonly field: string;
  readonly op: BuilderOperator;
  /** Null for the operators that take none. */
  readonly value: QueryValue | null;
  /** Written `NOT …`. */
  readonly negated: boolean;
}

export interface BuilderQuery {
  readonly types: readonly string[];
  /** Whether a note must meet every condition, or any one of them. */
  readonly match: 'all' | 'any';
  readonly conditions: readonly BuilderCondition[];
  readonly sort: readonly { readonly field: string; readonly direction: 'asc' | 'desc' }[];
  /** A group, then a sub-group; at most two. */
  readonly group: readonly string[];
  readonly show: readonly string[];
  readonly includeArchived: boolean;
  readonly limit: number | null;
}

export type BuilderReading =
  | { readonly ok: true; readonly builder: BuilderQuery }
  | { readonly ok: false; readonly reason: string };

const MIXED =
  'This query brackets conditions together — AND with OR, or NOT over a group — which the builder cannot show as one list. Edit it as text.';

const LINKS_TO = 'This query says LINKS TO, which the builder has no control for. Edit it as text.';

export function builderFromQuery(query: AtlasQuery): BuilderReading {
  const said = query.where === null ? [] : conditionsOf(query.where);
  if (said.some((condition) => condition.kind === 'linksTo'))
    return { ok: false, reason: LINKS_TO };
  const flat = flatten(query.where);
  if (flat === null) return { ok: false, reason: MIXED };
  return {
    ok: true,
    builder: {
      types: query.from.map((name) => name.text),
      match: flat.match,
      conditions: flat.conditions,
      sort: query.sort.map((key) => ({ field: text(key.field), direction: key.direction })),
      group: query.group.map(text),
      show: query.show.map(text),
      includeArchived: query.includeArchived,
      limit: query.limit,
    },
  };
}

export function queryFromBuilder(builder: BuilderQuery): AtlasQuery {
  // A comparison still waiting for its value asks nothing yet, so it is not in the query.
  const conditions = builder.conditions.filter(isComplete).map(conditionFrom);
  const where: Expression | null =
    conditions.length === 0
      ? null
      : conditions.length === 1
        ? (conditions[0] as Expression)
        : { kind: builder.match === 'all' ? 'and' : 'or', operands: conditions, span: NO_SPAN };
  return {
    from: builder.types.map((type) => ({ text: type, span: NO_SPAN })),
    where,
    sort: builder.sort.map((key) => ({ field: fieldRef(key.field), direction: key.direction })),
    group: builder.group.map(fieldRef),
    show: builder.show.map(fieldRef),
    includeArchived: builder.includeArchived,
    // A limit the text could not read back is brought within what it can.
    limit:
      builder.limit === null || !Number.isFinite(builder.limit)
        ? null
        : Math.min(Math.max(1, Math.floor(builder.limit)), MAX_QUERY_LIMIT),
  };
}

/** A new, empty query over one type: what the builder starts from. */
export function blankBuilder(type: string): BuilderQuery {
  return {
    types: [type],
    match: 'all',
    conditions: [],
    sort: [],
    group: [],
    show: [],
    includeArchived: false,
    limit: null,
  };
}

function flatten(
  where: Expression | null,
): { match: 'all' | 'any'; conditions: BuilderCondition[] } | null {
  if (where === null) return { match: 'all', conditions: [] };
  if (where.kind !== 'and' && where.kind !== 'or') {
    const single = builderCondition(where);
    return single === null ? null : { match: 'all', conditions: [single] };
  }
  const operands = sameKindOperands(where.kind, where.operands);
  const conditions = operands.map(builderCondition);
  if (conditions.some((condition) => condition === null)) return null;
  return {
    match: where.kind === 'and' ? 'all' : 'any',
    conditions: conditions as BuilderCondition[],
  };
}

/** `a AND (b AND c)` is one list of three: brackets around the same joiner change nothing. */
function sameKindOperands(kind: 'and' | 'or', operands: readonly Expression[]): Expression[] {
  return operands.flatMap((operand) =>
    operand.kind === kind ? sameKindOperands(kind, operand.operands) : [operand],
  );
}

function builderCondition(expression: Expression): BuilderCondition | null {
  const negated = expression.kind === 'not';
  const inner = negated ? expression.operand : expression;
  if (inner.kind === 'compare') {
    return { field: text(inner.field), op: inner.op, value: inner.value, negated };
  }
  if (inner.kind === 'empty') {
    return {
      field: text(inner.field),
      op: inner.negated ? 'isNotEmpty' : 'isEmpty',
      value: null,
      negated,
    };
  }
  return null;
}

/** Whether a condition asks something: it has its value, or needs none. */
export function isComplete(condition: BuilderCondition): boolean {
  return !operatorTakesQueryValue(condition.op) || condition.value !== null;
}

function conditionFrom(condition: BuilderCondition): Expression {
  const field = fieldRef(condition.field);
  const plain: Condition =
    condition.op === 'isEmpty' || condition.op === 'isNotEmpty' || condition.value === null
      ? { kind: 'empty', field, negated: condition.op === 'isNotEmpty', span: NO_SPAN }
      : { kind: 'compare', field, op: condition.op, value: condition.value, span: NO_SPAN };
  return condition.negated ? { kind: 'not', operand: plain, span: NO_SPAN } : plain;
}

const text = fieldText;

function fieldRef(written: string): FieldRef {
  const [first = '', second] = written.split('.');
  const name = { text: second ?? first, span: NO_SPAN };
  return { via: second === undefined ? null : { text: first, span: NO_SPAN }, name, span: NO_SPAN };
}

/** Which control picks a field's value. */
export type ValueEditor = 'options' | 'note' | 'date' | 'boolean' | 'tag' | 'number' | 'text';

const EDITORS: Readonly<Record<FieldKind, ValueEditor>> = {
  select: 'options',
  multiSelect: 'options',
  type: 'options',
  relation: 'note',
  date: 'date',
  modified: 'date',
  checkbox: 'boolean',
  tag: 'tag',
  number: 'number',
  text: 'text',
  url: 'text',
  thumbnail: 'text',
  title: 'text',
  path: 'text',
};

/** The control for a field's value; searching words is always typed, whatever the kind. */
export function valueEditorFor(field: QueryField, op: BuilderOperator): ValueEditor {
  if (op === 'contains' || op === 'startsWith') return 'text';
  return EDITORS[field.kind];
}

const OPERATOR_WORDS: Readonly<Record<BuilderOperator, string>> = {
  '=': 'is',
  '!=': 'is not',
  '<': 'is less than',
  '<=': 'is at most',
  '>': 'is more than',
  '>=': 'is at least',
  contains: 'contains',
  startsWith: 'starts with',
  isEmpty: 'is empty',
  isNotEmpty: 'is not empty',
};

const DATE_WORDS: Readonly<Partial<Record<BuilderOperator, string>>> = {
  '<': 'is before',
  '<=': 'is on or before',
  '>': 'is after',
  '>=': 'is on or after',
};

/** An operator as the words in the builder's sentence: a date is "before", a number "less than". */
export function builderOperatorWords(op: BuilderOperator, kind: FieldKind): string {
  const dated = kind === 'date' || kind === 'modified';
  return (dated ? DATE_WORDS[op] : undefined) ?? OPERATOR_WORDS[op];
}

/** The dates that move, as the builder offers them: `@today` reads "Today". */
export const MOVING_DATES: readonly { readonly value: string; readonly label: string }[] = [
  { value: '@today', label: 'Today' },
  { value: '@yesterday', label: 'Yesterday' },
  { value: '@tomorrow', label: 'Tomorrow' },
  { value: '@weekAgo', label: 'A week ago' },
  { value: '@weekAhead', label: 'A week from now' },
  { value: '@monthAhead', label: 'A month from now' },
  { value: '@startOfWeek', label: 'Start of this week' },
];

/**
 * The moving dates the date control offers while it holds `text`: the list,
 * and `text` itself when it is a count from today — `@-30d` reads "30 days
 * ago" — so a count typed as text is shown as the date it is, not as no day.
 */
export function movingDateChoices(
  text: string,
): readonly { readonly value: string; readonly label: string }[] {
  const label = text.startsWith('@') ? countedLabel(text.slice(1)) : null;
  return label === null ? MOVING_DATES : [...MOVING_DATES, { value: text, label }];
}

/** The operators the builder offers for a field, emptiness last. */
export function builderOperatorsFor(field: QueryField): BuilderOperator[] {
  return [...comparisonsFor(field.kind), 'isEmpty', 'isNotEmpty'];
}

export function operatorTakesQueryValue(op: BuilderOperator): boolean {
  return op !== 'isEmpty' && op !== 'isNotEmpty';
}

const NUMBER = /^-?\d+(?:\.\d+)?$/;

/**
 * What was typed or picked, as the value the field compares with: digits for
 * a number, true or false for a checkbox, a link for a relation, a tag for
 * `tag`, `@today` as a moving date. Blank is no value yet.
 */
export function valueFromInput(
  field: QueryField,
  op: BuilderOperator,
  input: string,
): QueryValue | null {
  const typed = input.trim();
  if (typed === '') return null;
  const span = NO_SPAN;
  const editor = valueEditorFor(field, op);
  if (editor === 'text') return { kind: 'text', text: typed, span };
  if (editor === 'date' && typed.startsWith('@')) {
    return { kind: 'relativeDate', name: typed.slice(1), span };
  }
  if (editor === 'number' && NUMBER.test(typed))
    return { kind: 'number', number: Number(typed), text: typed, span };
  if (editor === 'boolean') return { kind: 'boolean', value: typed.toLowerCase() === 'true', span };
  // Shown as `this`, read back as `this`; a note called "this" is [[this]].
  if (editor === 'note' && typed === 'this') return { kind: 'this', span };
  if (editor === 'note') return { kind: 'link', target: linkTarget(typed), span };
  if (editor === 'tag') return { kind: 'tag', name: typed.replace(/^#/, ''), span };
  return { kind: 'text', text: typed, span };
}

/** The note a picked or typed link names: `Atlas` for `[[Atlas|the app]]` or `Atlas|the app`. */
function linkTarget(typed: string): string {
  const [piece] = splitWikiLinks(typed.startsWith('[[') ? typed : `[[${typed}]]`);
  return piece?.kind === 'wikiLink' && piece.target.trim() !== '' ? piece.target.trim() : typed;
}

/** A value as its control shows it. */
export function valueInputText(value: QueryValue | null): string {
  if (value === null) return '';
  switch (value.kind) {
    case 'number':
      return String(value.number);
    case 'boolean':
      return String(value.value);
    case 'link':
      return value.target;
    case 'tag':
      return value.name;
    case 'relativeDate':
      return `@${value.name}`;
    case 'this':
      return 'this';
    case 'text':
      return value.text;
  }
}

/** A condition on a field just picked: its first operator, and a value when there is an obvious one. */
export function startingCondition(field: QueryField): BuilderCondition {
  const op = builderOperatorsFor(field)[0] ?? '=';
  const first = field.options[0];
  const value: QueryValue | null =
    field.kind === 'checkbox'
      ? { kind: 'boolean', value: true, span: NO_SPAN }
      : first === undefined
        ? null
        : { kind: 'text', text: first, span: NO_SPAN };
  return { field: field.text, op, value, negated: false };
}
