/**
 * A table cell's value, as its editor commits it and as the view draws it.
 *
 * A cell is a note's property: what the editor typed or picked is written to
 * the note's frontmatter as it is typed — text, a number, a tick, a day, a
 * link or several — and an emptied cell takes the value out rather than
 * leaving an empty string behind. Text is written trimmed, as the index reads
 * it back (`cellShownValue`), so a cell edited again is judged against what
 * it was written as rather than refused as changed.
 */
export function cellWriteValue(value: unknown): unknown {
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (value === undefined) return null;
  if (Array.isArray(value) && value.length === 0) return null;
  return value;
}

/**
 * A committed value as the view reads it back, so a cell can be drawn with
 * it before the index has: text trimmed, a number kept a number, a tick as
 * its text and several values as one comma-separated cell — how the index's
 * view of a type pivots a note's properties into columns.
 */
export function cellShownValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(cellShownValue).filter((item) => item !== null);
    return items.length === 0 ? null : items.map(String).join(', ');
  }
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (typeof value === 'boolean') return String(value);
  return value ?? null;
}

/** Whether two reads of a cell show the same value: nothing is nothing, however it is spelled. */
export function sameCellValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(emptied(left)) === JSON.stringify(emptied(right));
}

function emptied(value: unknown): unknown {
  return value === undefined || value === '' ? null : value;
}
