/**
 * The keyboard rules of a cell being edited (brief §5.4): ↵ commits, Esc
 * cancels, Tab and ⇧Tab move to the next and previous cell, across the row
 * and on to the next. Pure, so the editors share one reading of the keys.
 */

/** The keys an editor reads, as a keyboard event names them. */
export interface EditorKey {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

export type EditorKeyAction = 'commit' | 'cancel' | 'next' | 'previous';

/** What a key asks of the editor, or null for a key that is the field's own. */
export function editorKeyAction({
  key,
  shiftKey,
  altKey,
  ctrlKey,
  metaKey,
}: EditorKey): EditorKeyAction | null {
  // A chord belongs to the app or the browser, except ⇧Tab.
  if (altKey || ctrlKey || metaKey) return null;
  if (key === 'Tab') return shiftKey ? 'previous' : 'next';
  if (shiftKey) return null;
  if (key === 'Enter') return 'commit';
  if (key === 'Escape') return 'cancel';
  return null;
}

/** A cell, by the row it is in and the column it is under. */
export interface CellAt {
  readonly path: string;
  readonly column: string;
}

/**
 * The cell Tab or ⇧Tab reaches from `at`: the next column of the row, then
 * the first column of the next row; null past the last cell of the last row
 * (or before the first of the first), where the edit ends instead.
 */
export function neighbourCell({
  paths,
  columns,
  at,
  step,
}: {
  /** The rows' paths in the order the table shows them. */
  paths: readonly string[];
  /** The columns that edit, in the order the table shows them. */
  columns: readonly string[];
  at: CellAt;
  step: 1 | -1;
}): CellAt | null {
  const row = paths.indexOf(at.path);
  const column = columns.indexOf(at.column);
  if (row === -1 || column === -1) return null;
  const flat = row * columns.length + column + step;
  if (flat < 0 || flat >= paths.length * columns.length) return null;
  const path = paths[Math.floor(flat / columns.length)];
  const next = columns[flat % columns.length];
  return path === undefined || next === undefined ? null : { path, column: next };
}

/** How many options a picker gives a number key: 1 to 8, the eight GTD statuses (Q3). */
export const NUMBER_KEYS = 8;

/**
 * The option a number key picks in a status picker: `1` the first, up to the
 * eighth. The filter wins once it holds text starting with a digit — a
 * status that begins with a number is being searched for, not picked — and
 * a key past the options picks nothing.
 */
export function optionPickedByNumber({
  key,
  filter,
  count,
}: {
  key: string;
  filter: string;
  count: number;
}): number | null {
  if (!/^[1-8]$/.test(key)) return null;
  if (/^\d/.test(filter)) return null;
  const at = Number(key) - 1;
  return at < count ? at : null;
}

/**
 * Whether a number cell takes what was typed so far: digits, one leading
 * minus and one point, on the way to a number — never a letter.
 */
export function acceptsNumberDraft(text: string): boolean {
  return /^-?\d*\.?\d*$/.test(text);
}

/** A number cell's value: what it holds as a number, or null once it is empty. */
export function numberOf(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === '-' || trimmed === '.' || trimmed === '-.') return null;
  return Number(trimmed);
}

/** Whether text is a day as a date cell commits one: `YYYY-MM-DD`. */
export function isIsoDay(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(text);
}
