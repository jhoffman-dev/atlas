/**
 * What a table's footer says beside its count (Table.dc.html): how many rows
 * each group holds, and how the table is arranged — "Grouped by status ·
 * sorted by phase".
 */

/** The least a footer needs to know of a group: its value, its field's kind, and its rows. */
export interface TotalledGroup {
  readonly label: string;
  readonly kind: string;
  readonly rows: readonly unknown[];
}

/**
 * A property's label as it reads mid-sentence: "Status" becomes "status",
 * while "GitHub repo" and "ID" stay as written — only a sentence-case word
 * is lowered, since a name or an initialism is not.
 */
function inSentence(label: string): string {
  const [word = ''] = label.split(' ');
  const rest = word.slice(1);
  if (rest !== rest.toLowerCase()) return label;
  return word.charAt(0).toLowerCase() + label.slice(1);
}

/**
 * "Grouped by status · sorted by phase, then due date": each part only while
 * it holds, and null for a table that is neither grouped nor sorted.
 */
export function tableArrangement({
  groupedBy,
  sortedBy,
}: {
  /** The grouping property's label; null when the table does not group. */
  groupedBy: string | null;
  /** The sorts' labels in the order they apply. */
  sortedBy: readonly string[];
}): string | null {
  const parts: string[] = [];
  if (groupedBy !== null) parts.push(`grouped by ${inSentence(groupedBy)}`);
  if (sortedBy.length > 0) parts.push(`sorted by ${sortedBy.map(inSentence).join(', then ')}`);
  const [head, ...rest] = parts;
  if (head === undefined) return null;
  return [head.charAt(0).toUpperCase() + head.slice(1), ...rest].join(' · ');
}

/**
 * "174 done", "10 backlog": each group's count under its value. A select's
 * value reads as a word, so it is lowered; a relation's is a note's name and
 * is kept. An empty group is left out.
 */
export function groupTotals(groups: readonly TotalledGroup[]): string[] {
  return groups
    .filter((group) => group.rows.length > 0)
    .map(
      (group) =>
        `${group.rows.length} ${group.kind === 'select' ? group.label.toLowerCase() : group.label}`,
    );
}
