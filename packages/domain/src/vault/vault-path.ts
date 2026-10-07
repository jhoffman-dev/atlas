/**
 * A location inside the vault, always relative to the vault root and always
 * '/'-separated. The root itself is the empty string.
 *
 * Branded so a raw string from the filesystem, the UI or an IPC message cannot be
 * used as one without passing through `createVaultPath`, which is the only place
 * traversal is rejected.
 */
export type VaultPath = string & { readonly __vaultPath: unique symbol };

export const VAULT_ROOT = '' as VaultPath;

export class InvalidVaultPathError extends Error {
  constructor(raw: string, reason: string) {
    super(`Invalid vault path ${JSON.stringify(raw)}: ${reason}`);
    this.name = 'InvalidVaultPathError';
  }
}

/**
 * Normalises a relative path and rejects anything that could escape the vault.
 * The Rust side re-checks after canonicalising, because symlinks can escape a
 * path that looks contained; this check catches the rest before it ever gets there.
 */
export function createVaultPath(raw: string): VaultPath {
  if (raw === '') return VAULT_ROOT;
  if (raw.startsWith('/')) throw new InvalidVaultPathError(raw, 'must be relative to the vault');
  if (/^[A-Za-z]:/.test(raw)) throw new InvalidVaultPathError(raw, 'must be relative to the vault');
  if (raw.includes('\0')) throw new InvalidVaultPathError(raw, 'contains a null byte');
  // Only '/' is a separator here, so `..\..\secrets.md` would pass the escape
  // check as one odd filename and be a traversal again on a platform where the
  // backslash separates. Rejecting is safe: a vault path is ours to write.
  if (raw.includes('\\')) throw new InvalidVaultPathError(raw, 'contains a backslash');

  const segments = raw.split('/').filter((segment) => segment !== '');
  for (const segment of segments) {
    if (segment === '.') throw new InvalidVaultPathError(raw, 'contains a "." segment');
    if (segment === '..') throw new InvalidVaultPathError(raw, 'escapes the vault root');
  }
  if (segments.length === 0) return VAULT_ROOT;
  return segments.join('/') as VaultPath;
}

export function joinVaultPath(parent: VaultPath, name: string): VaultPath {
  return createVaultPath(parent === VAULT_ROOT ? name : `${parent}/${name}`);
}

export function vaultPathSegments(path: VaultPath): string[] {
  return path === VAULT_ROOT ? [] : path.split('/');
}

/** The final segment — a file or directory name. The root has no name. */
export function vaultPathName(path: VaultPath): string {
  return vaultPathSegments(path).at(-1) ?? '';
}

export function vaultPathDepth(path: VaultPath): number {
  return vaultPathSegments(path).length;
}

export function parentVaultPath(path: VaultPath): VaultPath {
  const segments = vaultPathSegments(path);
  return segments.length <= 1 ? VAULT_ROOT : (segments.slice(0, -1).join('/') as VaultPath);
}
