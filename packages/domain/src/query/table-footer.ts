/**
 * What a table's footer says beside its count (Table.dc.html): how many rows
 * each group holds, and how the table is arranged — "Grouped by status ·
 * sorted by phase".
 */

import { optionLabel } from '../page/status-tone.ts';

/** The least a footer needs to know of a group: its value, its field's kind, and its rows. */
export interface TotalledGroup {
  readonly label: string;
  readonly kind: string;
  readonly rows: readonly unknown[];
}

/** A sort as the footer names it: its property's label, and which way it runs. A bare label runs ascending. */
export type SortedBy = string | { readonly label: string; readonly direction: 'asc' | 'desc' };

/** The kinds whose value is an option the type declares, read as its header reads it. */
const OPTION_KINDS: readonly string[] = ['select', 'multiSelect'];

/**
 * Whether a label is plain words — each "Status", "Due Date" or "date" — that
 * read lower-cased mid-sentence, as against an initialism or a name ("ID",
 * "GitHub repo", "QA"), which is written as it is. Either the whole label is
 * lowered or none of it, never "due Date".
 */
function readsAsWords(label: string): boolean {
  return /^(?:\p{Lu}?[\p{Ll}-]*)(?:\s+\p{Lu}?[\p{Ll}-]*)*$/u.test(label.trim());
}

/** A label as it reads mid-sentence: "Status" becomes "status", "GitHub repo" stays. */
function inSentence(label: string): string {
  return readsAsWords(label) ? label.toLowerCase() : label;
}

/**
 * "Grouped by status · sorted by phase, then due date (descending)": each
 * part only while it holds, and null for a table that is neither grouped nor
 * sorted. A descending sort says so; ascending is the plain reading.
 */
export function tableArrangement({
  groupedBy,
  sortedBy,
}: {
  /** The grouping property's label; null when the table does not group. */
  groupedBy: string | null;
  /** The sorts in the order they apply. */
  sortedBy: readonly SortedBy[];
}): string | null {
  const parts: string[] = [];
  if (groupedBy !== null) parts.push(`grouped by ${inSentence(groupedBy)}`);
  if (sortedBy.length > 0) parts.push(`sorted by ${sortedBy.map(sortWords).join(', then ')}`);
  const [head, ...rest] = parts;
  if (head === undefined) return null;
  return [head.charAt(0).toUpperCase() + head.slice(1), ...rest].join(' · ');
}

function sortWords(sort: SortedBy): string {
  if (typeof sort === 'string') return inSentence(sort);
  const words = inSentence(sort.label);
  return sort.direction === 'desc' ? `${words} (descending)` : words;
}

/**
 * "174 done", "10 backlog", "3 Larkspur Payroll": each group's count under
 * its value, read as its header reads it — an option by its label, lowered
 * when it is plain words; a relation's value is a note's name and is kept.
 * An empty group is left out. Two groups whose values read the same (`Done`
 * and `done` are two options) are told apart by their values as written.
 */
export function groupTotals(groups: readonly TotalledGroup[]): string[] {
  const kept = groups.filter((group) => group.rows.length > 0);
  const read = kept.map((group) =>
    OPTION_KINDS.includes(group.kind) ? inSentence(optionLabel(group.label)) : group.label,
  );
  const seen = new Map<string, number>();
  for (const words of read) seen.set(words, (seen.get(words) ?? 0) + 1);
  return kept.map((group, at) => {
    const words = read[at] ?? group.label;
    return `${group.rows.length} ${(seen.get(words) ?? 0) > 1 ? group.label : words}`;
  });
}
