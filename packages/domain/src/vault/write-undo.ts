import { splitFrontmatter } from '../markdown/markdown-document.ts';
import type { VaultPath } from './vault-path.ts';

/**
 * One write to a note, as it found the file and as it left it (#320): the
 * whole text both times — frontmatter and body — so taking it back puts back
 * the very bytes it replaced (ADR-0003), comments, quoting and line endings
 * and all, rather than writing the old values out afresh.
 */
export interface WriteRecord {
  readonly path: VaultPath;
  readonly before: string;
  readonly after: string;
}

/** What taking a write back comes to, given the file as it is now. */
export type WriteUndo =
  | { readonly kind: 'restore'; readonly contents: string }
  /** The file already says what it said before the write: nothing to put back. */
  | { readonly kind: 'already' }
  /** The file moved on since the write, so it is left alone; `part` says where it changed. */
  | { readonly kind: 'changed'; readonly part: 'frontmatter' | 'body' };

/**
 * Whether a write can be taken back, and with what. Only while the file holds
 * exactly what the write left — to the byte — does the undo put back what was
 * there before; any later change, a property or a word of the body, wins over
 * the undo, which is then refused rather than written over it.
 */
export function writeUndo({ record, now }: { record: WriteRecord; now: string }): WriteUndo {
  if (now === record.after) return { kind: 'restore', contents: record.before };
  if (now === record.before) return { kind: 'already' };
  const left = splitFrontmatter(record.after);
  const found = splitFrontmatter(now);
  return { kind: 'changed', part: left.frontmatter === found.frontmatter ? 'body' : 'frontmatter' };
}
