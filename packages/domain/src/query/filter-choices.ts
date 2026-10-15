/**
 * The values a filter's value box offers for a property (#212).
 *
 * A table draws a value the way a person reads it — `next-action` as "Next
 * Action", a relation's `[[Project Alpha]]` as "Project Alpha" — but a filter
 * compares with what the file holds. Each choice keeps both: the label is what
 * is offered and shown, the value is what the filter stores.
 */

import { optionLabel } from '../page/status-tone.ts';
import type { PropertyKind } from '../types/property-def.ts';
import { withNoteNames, type NoteNames } from '../types/relation-names.ts';
import { RELATIVE_DATE_NAMES } from './view-query.ts';

/** One value a filter can compare with, and how it reads. */
export interface FilterChoice {
  readonly value: string;
  readonly label: string;
}

/** What the vault knows that a property's choices are drawn from. */
export interface FilterChoiceSources {
  /** The vault's tags, as they are written. */
  readonly tags: readonly string[];
  /** For each relation property, the notes it can point at: their links, by title. */
  readonly related: Readonly<Record<string, readonly FilterChoice[]>>;
}

export const NO_CHOICE_SOURCES: FilterChoiceSources = { tags: [], related: {} };

/** The property that holds a note's tags, whatever kind it is declared as. */
export const TAGS_PROPERTY = 'tags';

const CHECKBOX_CHOICES: readonly FilterChoice[] = [
  { value: 'true', label: 'true' },
  { value: 'false', label: 'false' },
];

const RELATIVE_DATE_LABELS: Readonly<Record<string, string>> = {
  '@today': 'Today',
  '@yesterday': 'Yesterday',
  '@tomorrow': 'Tomorrow',
  '@weekAgo': 'A week ago',
  '@weekAhead': 'A week from today',
  '@monthAhead': 'A month from today',
};

const DATE_CHOICES: readonly FilterChoice[] = RELATIVE_DATE_NAMES.map((name) => ({
  value: name,
  label: RELATIVE_DATE_LABELS[name] ?? name,
}));

/**
 * What a property's filter can be set to: a select's declared options, a
 * checkbox's two states, a date's relative days, a relation's notes and the
 * vault's tags for `tags`. A kind with nothing to offer offers nothing, and
 * is typed instead.
 */
export function filterChoices(
  property: {
    readonly key: string;
    readonly kind?: PropertyKind;
    readonly options?: readonly string[];
  },
  sources: FilterChoiceSources,
): FilterChoice[] {
  const tags = property.key === TAGS_PROPERTY ? sources.tags.map(plainChoice) : [];
  switch (property.kind) {
    case 'select':
    case 'multiSelect':
      return distinct([...(property.options ?? []).map(optionChoice), ...tags]);
    case 'checkbox':
      return [...CHECKBOX_CHOICES];
    case 'date':
      return [...DATE_CHOICES];
    case 'relation':
      return [...(sources.related[property.key] ?? [])];
    default:
      return distinct(tags);
  }
}

/**
 * The notes a relation can point at as choices: the link a file holds — what
 * a filter compares with — offered by the title a table shows, in title order.
 */
export function relatedChoices(links: readonly string[], names: NoteNames): FilterChoice[] {
  return links
    .map((link) => ({ value: link, label: withNoteNames(link, names) }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

const optionChoice = (option: string): FilterChoice => ({
  value: option,
  label: optionLabel(option),
});

const plainChoice = (value: string): FilterChoice => ({ value, label: value });

/** The first of each value: a tag a select also declares is offered once. */
function distinct(choices: readonly FilterChoice[]): FilterChoice[] {
  const seen = new Set<string>();
  return choices.filter((choice) => {
    if (seen.has(choice.value)) return false;
    seen.add(choice.value);
    return true;
  });
}

/** The choices whose label or value holds what was typed, in their own order; all of them for nothing typed. */
export function matchingChoices(
  choices: readonly FilterChoice[],
  typed: string,
): readonly FilterChoice[] {
  const wanted = typed.trim().toLowerCase();
  if (wanted === '') return choices;
  return choices.filter(
    (choice) =>
      choice.label.toLowerCase().includes(wanted) || choice.value.toLowerCase().includes(wanted),
  );
}

/**
 * The choice a typed value names: its value exactly, else its label or value
 * however it is cased or spaced — so "Next Action", "next action" and
 * "next-action" are one status. Null when it names none.
 */
export function choiceNamed(choices: readonly FilterChoice[], typed: string): FilterChoice | null {
  const text = typed.trim();
  const wanted = spelled(text);
  return (
    choices.find((choice) => choice.value === text) ??
    choices.find(
      (choice) => spelled(choice.label) === wanted || spelled(choice.value) === wanted,
    ) ??
    null
  );
}

/** Text as a slug, so case, spaces and underscores do not tell two spellings apart. */
const spelled = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
