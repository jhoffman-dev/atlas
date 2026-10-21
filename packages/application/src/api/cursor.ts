import { createVaultPath, type InboxKey, type VaultPath } from '@dfai/domain';
import { ApiError } from './api-error.ts';
import { isApiNotePath } from './paths.ts';

/*
 * A page of notes is continued from the last path handed out rather than from
 * a position, so a note created or removed between two pages moves nothing
 * that has not been read yet. The cursor is that path, encoded so callers
 * treat it as opaque.
 */

export function encodeCursor(path: VaultPath): string {
  return encodedText(path);
}

function encodedText(text: string): string {
  return btoa(String.fromCodePoint(...new TextEncoder().encode(text)));
}

/** The text a cursor carries, or null when it is not base64 of UTF-8. */
function decodedText(cursor: string): string | null {
  try {
    const bytes = Uint8Array.from(atob(cursor), (character) => character.codePointAt(0) ?? 0);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Not base64, or not UTF-8: both mean the same to the caller.
    return null;
  }
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
  const text = decodedText(cursor);
  return text === null ? null : spelledPath(text);
}

/** The path `text` is, spelled as handed out — `a//b.md` is none, though it names `a/b.md` — or null. */
function spelledPath(text: unknown): VaultPath | null {
  if (typeof text !== 'string') return null;
  try {
    const path = createVaultPath(text);
    return path === text ? path : null;
  } catch {
    // Not a vault path: no cursor this API handed out.
    return null;
  }
}

/*
 * The Inbox is newest first, not in path order (#167), so its cursor is where
 * the last note listed stands in that order — when it last changed, and its
 * path — read on from without counting, so filing or editing notes between
 * two pages skips and repeats none.
 */

export function encodeInboxCursor({ modified, path }: InboxKey): string {
  return encodedText(JSON.stringify([modified, path]));
}

/** The place in the Inbox a cursor carries; `invalid` when it is not one this API handed out. */
export function decodeInboxCursor(cursor: string): InboxKey {
  const key = decodedInboxKey(cursor);
  if (key === null || !isApiNotePath(key.path)) throw notHandedOut();
  return key;
}

function decodedInboxKey(cursor: string): InboxKey | null {
  const text = decodedText(cursor);
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON: no cursor this API handed out.
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return null;
  const [modified, raw] = parsed as unknown[];
  const path = spelledPath(raw);
  if (!Number.isSafeInteger(modified) || path === null) return null;
  return { modified: modified as number, path };
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
