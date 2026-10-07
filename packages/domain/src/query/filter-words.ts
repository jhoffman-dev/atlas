import type { PropertyKind } from '../types/property-def.ts';
import type { FilterOperator, QueryFilter } from './view-query.ts';

const OPERATOR_WORDS: Readonly<Record<FilterOperator, string>> = {
  is: 'is',
  isNot: 'is not',
  contains: 'contains',
  startsWith: 'starts with',
  greaterThan: 'is more than',
  lessThan: 'is less than',
  isEmpty: 'is empty',
  isNotEmpty: 'is not empty',
};

/** A filter's operator as the words in a sentence: `isNot` is "is not". */
export function filterOperatorWords(operator: FilterOperator): string {
  return OPERATOR_WORDS[operator];
}

/** Whether a filter with this operator compares against a value at all. */
export function operatorTakesValue(operator: FilterOperator): boolean {
  return operator !== 'isEmpty' && operator !== 'isNotEmpty';
}

const NUMBER = /^-?\d+(?:\.\d+)?$/;

/**
 * What a person typed as a filter's value, as the value to store, by the kind
 * of the property it filters.
 *
 * The index compares a number column with a number, so `phase is 14` on a
 * number property is stored as 14. Every other column holds text, which never
 * equals a number — `room is 007` on a text property must stay the text "007".
 * So only a declared number property reads digits as a number. Blank is no value.
 */
export function filterValueFrom(typed: string, kind?: PropertyKind): string | number | null {
  const text = typed.trim();
  if (text === '') return null;
  return kind === 'number' && NUMBER.test(text) ? Number(text) : text;
}

/**
 * A filter as a sentence, for the list of what a view is filtered by:
 * "Status is not done", "Due is less than @tomorrow", "Phase is empty".
 */
export function describeFilter({
  filter,
  label,
}: {
  filter: QueryFilter;
  /** The property's label, as its column heading reads. */
  label: string;
}): string {
  const words = `${label} ${filterOperatorWords(filter.operator)}`;
  if (!operatorTakesValue(filter.operator)) return words;
  return `${words} ${String(filter.value ?? '')}`.trim();
}
