import type { VaultPath } from '../vault/vault-path.ts';
import { isRecord, readPath } from './stranded-edit.ts';

/** One comment typed in a highlight's field (#534) and not written, with the comment it was typed over. */
export interface StrandedComment {
  /** The highlight's `^id`. */
  readonly id: string;
  /** The words typed. */
  readonly comment: string;
  /** The comment the field started from: written over only while the note still holds it. */
  readonly base: string;
}

/**
 * The comments a closing note could not write, kept until the note is opened
 * again, as its typing is (`StrandedEdit`). They go back into their fields
 * over the comment they started from, so writing them still checks the note
 * has not moved on meanwhile.
 */
export interface StrandedComments {
  readonly path: VaultPath;
  readonly comments: readonly StrandedComment[];
  readonly reason: string;
  /** When they were kept, in milliseconds since the epoch. */
  readonly keptAt: number;
}

function readComment(value: unknown): StrandedComment | null {
  if (!isRecord(value)) return null;
  const { id, comment, base } = value;
  if (typeof id !== 'string' || id === '') return null;
  if (typeof comment !== 'string' || typeof base !== 'string') return null;
  return { id, comment, base };
}

/** Kept comments, out of whatever was stored; anything not that shape reads as nothing. */
export function parseStrandedComments(stored: unknown): StrandedComments | null {
  if (!isRecord(stored)) return null;
  const path = readPath(stored['path']);
  const { comments, reason, keptAt } = stored;
  if (path === null || typeof reason !== 'string' || !Array.isArray(comments)) return null;
  if (typeof keptAt !== 'number' || !Number.isFinite(keptAt)) return null;
  const read = comments.map(readComment);
  if (read.length === 0 || read.some((each) => each === null)) return null;
  return { path, comments: read.filter((each) => each !== null), reason, keptAt };
}
