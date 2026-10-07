/**
 * How a dashboard names what it counts: "12 tasks", "across 16 phases",
 * "7 without a phase", "94%". The nouns are the vault's own type and property
 * names, so these are the only place their plurals are made.
 */

import { humanizeKey } from '../page/property-label.ts';
import { linkedNames, withNoteNames, type NoteNames } from '../types/relation-names.ts';

/** English plurals, for the regular nouns type and property names are. */
export function pluralOf(noun: string): string {
  const word = noun.trim();
  if (word === '') return word;
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/** "1 task", "12 tasks". */
export function countOf(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun.trim() : pluralOf(noun)}`;
}

/** A property key as a lower-case noun: `blocked_by` reads "blocked by". */
export function nounOf(key: string): string {
  return humanizeKey(key).toLowerCase();
}

/** "7 without a phase", "2 without an estimate": the notes a chart has no bar for. */
export function withoutValue(count: number, key: string): string {
  const noun = nounOf(key);
  return `${count} without ${articleFor(noun)} ${noun}`;
}

/**
 * "a" or "an" by how the word sounds, not how it is spelled: "an hour" (a
 * silent h), "a unit" and "a user" (a vowel said as "you").
 */
function articleFor(noun: string): 'a' | 'an' {
  if (/^(hour|honest|honou?r|heir)/.test(noun)) return 'an';
  if (/^(uni[tvocfq]|us[eu]|ute|uti|eu|ewe|one\b|once)/.test(noun)) return 'a';
  return /^[aeiou]/.test(noun) ? 'an' : 'a';
}

/**
 * A part of a whole as a whole percentage. Rounded, except that it never says
 * 100% before the last one is done or 0% once the first one is: 199 of 200 is
 * 99%, not 100%.
 */
export function percentOf(part: number, whole: number): number {
  if (!(whole > 0) || !(part > 0)) return 0;
  if (part >= whole) return 100;
  return Math.min(Math.max(Math.round((part / whole) * 100), 1), 99);
}

/** A group's value as a chart labels it: a relation's by the note it links, the rest as written. */
export function groupName(label: string, names: NoteNames): string {
  return withNoteNames(label, names);
}

/** A donut's legend entry: a value humanised, a relation's note by its title, nothing as "No value". */
export function legendName(label: string, names: NoteNames): string {
  if (label === '') return 'No value';
  return linkedNames(label, names).length > 0 ? groupName(label, names) : humanizeKey(label);
}
