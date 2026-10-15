import type { PropertyKind } from '../types/property-def.ts';
import { choiceNamed, type FilterChoice } from './filter-choices.ts';
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

/** Kinds whose value can only be one of their choices: a checkbox is true or false. */
const CHOICES_ONLY: readonly PropertyKind[] = ['checkbox'];

/**
 * What a person typed as a filter's value, as the value to store, by the kind
 * of the property it filters and the values it offers (`filterChoices`).
 *
 * A table shows a select's option as its label — `next-action` reads "Next
 * Action" — and the index compares with what the file holds, exactly. So text
 * naming a choice, by its label or its value in any spelling, is stored as that
 * choice's value; otherwise "Next Action" would match no task at all (#212).
 *
 * The index compares a number column with a number, so `phase is 14` on a
 * number property is stored as 14. Every other column holds text, which never
 * equals a number — `room is 007` on a text property must stay the text "007".
 * So only a declared number property reads digits as a number. Blank is no
 * value, and so is anything a checkbox cannot hold.
 */
export function filterValueFrom(
  typed: string,
  kind?: PropertyKind,
  choices: readonly FilterChoice[] = [],
): string | number | null {
  const text = typed.trim();
  if (text === '') return null;
  const named = choiceNamed(choices, text);
  if (named !== null) return named.value;
  if (kind !== undefined && CHOICES_ONLY.includes(kind)) return null;
  return kind === 'number' && NUMBER.test(text) ? Number(text) : text;
}

/**
 * A filter as a sentence, for the list of what a view is filtered by:
 * "Status is not done", "Due is less than @tomorrow", "Phase is empty".
 */
export function describeFilter({
  filter,
  label,
  choices = [],
}: {
  filter: QueryFilter;
  /** The property's label, as its column heading reads. */
  label: string;
  /** The values the property offers, so a stored one reads as its label: "Next Action". */
  choices?: readonly FilterChoice[];
}): string {
  const words = `${label} ${filterOperatorWords(filter.operator)}`;
  if (!operatorTakesValue(filter.operator)) return words;
  const value = String(filter.value ?? '');
  const shown = choices.find((choice) => choice.value === value)?.label ?? value;
  return `${words} ${shown}`.trim();
}
