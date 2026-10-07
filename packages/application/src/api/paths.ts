import {
  createVaultPath,
  InvalidVaultPathError,
  isUserSpaceNote,
  VAULT_ROOT,
  type VaultPath,
} from '@atlas/domain';
import { ATLAS_FOLDER } from '../sidebar/load-catalog.ts';
import { ApiError } from './api-error.ts';

/*
 * Which paths a request may name.
 *
 * Traversal, absolute paths, backslashes and null bytes are refused by
 * `createVaultPath`, the one place the vault's own path rules live. On top of
 * that the API reaches user space only: `.atlas` holds Atlas's configuration
 * and hidden folders hold other tools' machinery, and a caller that could write
 * there could change what every type, template and view means.
 */

const NOTE_EXTENSION = /\.md$/i;

/** A note path from the URL: one segment, percent-decoded exactly once. */
export function notePathFromUrl(segment: string): VaultPath {
  const path = vaultPathOf(decodeSegment(segment), 'path');
  requireNote(path, 'path');
  if (!isUserSpace(path)) throw outsideUserSpace('path', path);
  return path;
}

/**
 * A view or dashboard path from the URL. These live in `.atlas/views` and
 * `.atlas/dashboards`, so `.atlas` is allowed here — for reading, never writing.
 */
export function viewPathFromUrl(segment: string): VaultPath {
  const path = vaultPathOf(decodeSegment(segment), 'path');
  requireNote(path, 'path');
  if (!isApiViewPath(path)) throw outsideUserSpace('path', path);
  return path;
}

/** A view or dashboard path the API may read: a note in user space, or under `.atlas`. */
export function isApiViewPath(path: VaultPath): boolean {
  const [first, ...rest] = path.split('/');
  const underAtlas = first === ATLAS_FOLDER && isUserSpace(createVaultPath(rest.join('/')));
  return NOTE_EXTENSION.test(path) && (underAtlas || isUserSpace(path));
}

/** A folder named in a body or a query string, which arrive already decoded. */
export function folderFrom(raw: string, field: string): VaultPath {
  const path = vaultPathOf(raw, field);
  if (!isApiFolderPath(path)) throw outsideUserSpace(field, path);
  return path;
}

/** A note named in a body, which arrives already decoded: in user space, and markdown. */
export function notePathFrom(raw: string, field: string): VaultPath {
  const path = vaultPathOf(raw, field);
  requireNote(path, field);
  if (!isUserSpace(path)) throw outsideUserSpace(field, path);
  return path;
}

/** A folder the API may name: the root, or one in user space. */
export function isApiFolderPath(path: VaultPath): boolean {
  return path === VAULT_ROOT || isUserSpace(path);
}

/** Any file the API may have Atlas read or write for it: one in user space. */
export function isApiFilePath(path: VaultPath): boolean {
  return isUserSpace(path);
}

/** A note path the API may name at all: in user space, and markdown. */
export function isApiNotePath(path: VaultPath): boolean {
  return NOTE_EXTENSION.test(path) && isUserSpace(path);
}

/** The domain's user space (`isUserSpaceNote`), the one rule the compiled queries hold too. */
function isUserSpace(path: VaultPath): boolean {
  return path !== VAULT_ROOT && isUserSpaceNote(path);
}

function requireNote(path: VaultPath, field: string): void {
  if (!NOTE_EXTENSION.test(path)) throw new ApiError('invalid', `${field} must name a .md note`);
}

/** One segment of the URL, percent-decoded exactly once. */
export function decodeSegment(segment: string, field = 'path'): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new ApiError('invalid', `${field} is not validly percent-encoded`);
  }
}

function vaultPathOf(raw: string, field: string): VaultPath {
  try {
    return createVaultPath(raw);
  } catch (error) {
    if (error instanceof InvalidVaultPathError) {
      throw new ApiError('invalid', `${field} ${JSON.stringify(raw)} is not a vault path`);
    }
    throw error;
  }
}

function outsideUserSpace(field: string, path: VaultPath): ApiError {
  return new ApiError(
    'invalid',
    `${field} ${JSON.stringify(path)} is in .atlas or a hidden folder, which the API cannot reach`,
  );
}
