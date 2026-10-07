import { createVaultPath, type VaultPath } from '@atlas/domain';
import { ApiError } from './api-error.ts';
import { isApiNotePath } from './paths.ts';

/*
 * A page of notes is continued from the last path handed out rather than from
 * a position, so a note created or removed between two pages moves nothing
 * that has not been read yet. The cursor is that path, encoded so callers
 * treat it as opaque.
 */

export function encodeCursor(path: VaultPath): string {
  return btoa(String.fromCodePoint(...new TextEncoder().encode(path)));
}

/**
 * The path a cursor carries. A page only ever ends on a note the API reads, so
 * a cursor carrying anything else — text that is not a path, a path outside
 * user space — is not one this API handed out, and is `invalid` rather than
 * read as a place past the end.
 */
export function decodeCursor(cursor: string): VaultPath {
  const path = decodedPath(cursor);
  if (path === null || !isApiNotePath(path)) throw notHandedOut();
  return path;
}

function decodedPath(cursor: string): VaultPath | null {
  try {
    const bytes = Uint8Array.from(atob(cursor), (character) => character.codePointAt(0) ?? 0);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const path = createVaultPath(text);
    // A path is handed out as it is spelled; `a//b.md` is no cursor, though it names `a/b.md`.
    return path === text ? path : null;
  } catch {
    // Not base64, not UTF-8, or not a vault path: all mean the same to the caller.
    return null;
  }
}

function notHandedOut(): ApiError {
  return new ApiError('invalid', 'cursor is not one this API handed out');
}

/**
 * The page of `items` after the cursor's path, at most `limit` long, in path
 * order, and the cursor for the page after it — null on the last page.
 */
export function pageAfter<T>({
  items,
  pathOf,
  cursor,
  limit,
}: {
  items: readonly T[];
  pathOf: (item: T) => VaultPath;
  cursor: string | undefined;
  limit: number;
}): { page: T[]; next: string | null } {
  const after = cursor === undefined ? null : decodeCursor(cursor);
  const matching = items
    .filter((item) => after === null || pathOf(item) > after)
    .sort((left, right) => comparePaths(pathOf(left), pathOf(right)));
  const page = matching.slice(0, limit);
  const last = page.at(-1);
  const next = matching.length > limit && last !== undefined ? encodeCursor(pathOf(last)) : null;
  return { page, next };
}

function comparePaths(left: VaultPath, right: VaultPath): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
