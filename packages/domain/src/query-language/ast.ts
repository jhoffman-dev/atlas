/**
 * An Atlas query, as data (ADR-0019).
 *
 * The text a person writes and the builder's dropdowns both edit this: the
 * parser reads text into it, the printer writes it back, and the compiler
 * turns it into SQL over the index. Every part remembers where in the text it
 * came from, so a problem with it can point there.
 */

/** Where something is in the text: from `start` up to, not including, `end`. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** No place in any text: what the builder gives the parts it makes. */
export const NO_SPAN: Span = { start: 0, end: 0 };

export interface Name {
  readonly text: string;
  readonly span: Span;
}

/**
 * A field: a property of the note — `status` — or, one hop through a
 * relation, a property of the note it points at — `project.owner`.
 */
export interface FieldRef {
  readonly via: Name | null;
  readonly name: Name;
  readonly span: Span;
}

export type Comparison = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'contains' | 'startsWith';

export const COMPARISONS: readonly Comparison[] = [
  '=',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  'contains',
  'startsWith',
];

/**
 * A value as written: a word or a quoted string (`text`), a number, `true` or
 * `false`, a link (`[[Julie]]`), a tag (`#q3`) or a date that moves (`@today`).
 */
export type QueryValue =
  | { readonly kind: 'text'; readonly text: string; readonly span: Span }
  | {
      readonly kind: 'number';
      readonly number: number;
      /** As written — `1.0`, `007` — so text it is compared with keeps its spelling. */
      readonly text?: string;
      readonly span: Span;
    }
  | { readonly kind: 'boolean'; readonly value: boolean; readonly span: Span }
  | { readonly kind: 'link'; readonly target: string; readonly span: Span }
  | { readonly kind: 'tag'; readonly name: string; readonly span: Span }
  | { readonly kind: 'relativeDate'; readonly name: string; readonly span: Span };

export type Condition =
  | {
      readonly kind: 'compare';
      readonly field: FieldRef;
      readonly op: Comparison;
      readonly value: QueryValue;
      readonly span: Span;
    }
  | {
      /** `IS EMPTY`, or with `negated`, `IS NOT EMPTY`. */
      readonly kind: 'empty';
      readonly field: FieldRef;
      readonly negated: boolean;
      readonly span: Span;
    };

export type Expression =
  | Condition
  | { readonly kind: 'and' | 'or'; readonly operands: readonly Expression[]; readonly span: Span }
  | { readonly kind: 'not'; readonly operand: Expression; readonly span: Span };

export interface SortKey {
  readonly field: FieldRef;
  readonly direction: 'asc' | 'desc';
}

export interface AtlasQuery {
  /** The types whose notes are listed: `FROM task, project`. */
  readonly from: readonly Name[];
  readonly where: Expression | null;
  readonly sort: readonly SortKey[];
  /** `GROUP BY project THEN status`: a group, then, optionally, a sub-group. */
  readonly group: readonly FieldRef[];
  /** `SHOW due, project.owner`: the columns; empty, they are chosen for you. */
  readonly show: readonly FieldRef[];
  /** Archived notes are left out unless the query says `INCLUDE ARCHIVED`. */
  readonly includeArchived: boolean;
  /** `LIMIT 50`; null is the app's default. */
  readonly limit: number | null;
}

/** The most levels a result can be grouped into: a group and a sub-group. */
export const MAX_GROUP_LEVELS = 2;

/**
 * A number as a query writes it: as it was written when it was, and otherwise
 * in plain digits — never `1e+22`, which the text could not read back.
 */
export function numberText(value: { readonly number: number; readonly text?: string }): string {
  return (
    value.text ??
    value.number.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 })
  );
}

/** A field as it is written: `status`, `project.owner`. */
export function fieldText(field: FieldRef): string {
  return field.via === null ? field.name.text : `${field.via.text}.${field.name.text}`;
}
