import type { EditorDocument, EditorMark, EditorNode } from '../markdown/editor-node.ts';
import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';

/**
 * Work a closing pane could not write, kept until the note is opened again.
 *
 * `modified` is the file's modification time at the moment the work was kept,
 * or `null` when the file could not be read then — it had gone. Comparing it
 * with the file as it is when the work is handed back is how a change made in
 * between is noticed rather than written over.
 */
export interface StrandedEdit {
  readonly path: VaultPath;
  readonly doc: EditorDocument;
  readonly reason: string;
  readonly modified: number | null;
  /** When it was kept, in milliseconds since the epoch. */
  readonly keptAt: number;
}

/**
 * How long kept work waits to be taken back.
 *
 * Something has to end it: a note that was deleted after its work was kept can
 * never be opened again, and nothing else would ever clear that entry. A month
 * is long enough that nobody loses work they were going to come back for.
 */
export const STRANDED_EDIT_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export function isStrandedEditExpired({ edit, now }: { edit: StrandedEdit; now: number }): boolean {
  return now - edit.keptAt > STRANDED_EDIT_LIFETIME_MS;
}

/**
 * Kept work, dated no later than now.
 *
 * Work stamped after now was kept while the clock was ahead. Its age is
 * negative, so it would never expire until the clock caught up; expiring it
 * instead would lose work over a wrong clock. Dated now, it gets its whole
 * lifetime from the first moment the clock is right.
 */
export function redateStrandedEdit({
  edit,
  now,
}: {
  edit: StrandedEdit;
  now: number;
}): StrandedEdit {
  return edit.keptAt > now ? { ...edit, keptAt: now } : edit;
}

/**
 * Whether the file moved on after the work was kept.
 *
 * A file that could not be read when the work was kept, and can be now, has
 * certainly changed.
 */
export function changedSinceStranded({
  edit,
  modified,
}: {
  edit: StrandedEdit;
  modified: number;
}): boolean {
  return edit.modified !== modified;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isEditorMark(value: unknown): value is EditorMark {
  return (
    isRecord(value) &&
    typeof value['type'] === 'string' &&
    (value['attrs'] === undefined || isRecord(value['attrs']))
  );
}

function isEditorNode(value: unknown): value is EditorNode {
  if (!isRecord(value) || typeof value['type'] !== 'string') return false;
  const { content, text, marks, attrs } = value;
  if (content !== undefined && !(Array.isArray(content) && content.every(isEditorNode))) {
    return false;
  }
  if (text !== undefined && typeof text !== 'string') return false;
  if (marks !== undefined && !(Array.isArray(marks) && marks.every(isEditorMark))) return false;
  return attrs === undefined || isRecord(attrs);
}

function readDoc(value: unknown): EditorDocument | null {
  if (!isRecord(value) || value['type'] !== 'doc') return null;
  const { content } = value;
  return Array.isArray(content) && content.every(isEditorNode) ? { type: 'doc', content } : null;
}

function readPath(value: unknown): VaultPath | null {
  if (typeof value !== 'string' || value === '') return null;
  try {
    return createVaultPath(value);
  } catch {
    // A path that no longer parses names no note that could be opened, so
    // there is nothing to hand its work back to.
    return null;
  }
}

/**
 * Kept work, out of whatever was stored. Anything not recognisably the shape
 * that is written reads as nothing, rather than handing a broken document to
 * the editor.
 */
export function parseStrandedEdit(stored: unknown): StrandedEdit | null {
  if (!isRecord(stored)) return null;
  const path = readPath(stored['path']);
  const doc = readDoc(stored['doc']);
  const { reason, modified, keptAt } = stored;
  if (path === null || doc === null || typeof reason !== 'string') return null;
  if (modified !== null && typeof modified !== 'number') return null;
  if (typeof keptAt !== 'number' || !Number.isFinite(keptAt)) return null;
  return { path, doc, reason, modified, keptAt };
}
