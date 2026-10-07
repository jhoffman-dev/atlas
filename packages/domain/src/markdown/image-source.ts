import { decodeImageSource } from '../attachments/image-placement.ts';
import { createVaultPath, parentVaultPath, type VaultPath } from '../vault/vault-path.ts';

export type ImageSource =
  | { readonly kind: 'external'; readonly url: string }
  | { readonly kind: 'vault'; readonly path: VaultPath }
  | { readonly kind: 'unresolved' };

const EXTERNAL = /^(https?:|data:)/i;

/**
 * Works out what `![alt](src)` points at.
 *
 * A note's own folder is tried first and the vault root second, which is how a
 * relative path behaves in every other markdown tool. Told which files exist,
 * the first of those that is there wins; otherwise, or when none is, the first
 * usable one does, so a missing image still names the file it wanted. Anything
 * that would leave the vault is refused rather than guessed at.
 */
export function resolveImageSource({
  src,
  notePath,
  exists,
}: {
  src: string;
  notePath: VaultPath;
  exists?: (path: VaultPath) => boolean;
}): ImageSource {
  const wanted = src.trim();
  if (wanted === '') return { kind: 'unresolved' };
  if (EXTERNAL.test(wanted)) return { kind: 'external', url: wanted };

  const candidates = imageSourceCandidates({ src: wanted, notePath });
  const found = exists === undefined ? undefined : candidates.find(exists);
  const path = found ?? candidates[0];
  return path === undefined ? { kind: 'unresolved' } : { kind: 'vault', path };
}

/**
 * The vault files a non-external `src` could mean, most likely first: from the
 * note's folder, then from the vault root. Empty when none stays in the vault.
 */
export function imageSourceCandidates({
  src,
  notePath,
}: {
  src: string;
  notePath: VaultPath;
}): VaultPath[] {
  const wanted = src.trim();
  // The anchor goes before decoding, so an encoded `%23` stays part of the name.
  const withoutAnchor = decodeImageSource(wanted.split('#')[0] ?? wanted);
  const relative = withoutAnchor.startsWith('/') ? withoutAnchor.slice(1) : withoutAnchor;

  const folder = parentVaultPath(notePath);
  const forms = folder === '' ? [relative] : [`${folder}/${relative}`, relative];

  const candidates: VaultPath[] = [];
  for (const form of forms) {
    const normalized = normalize(form);
    if (normalized === null) continue;
    try {
      const path = createVaultPath(normalized);
      if (!candidates.includes(path)) candidates.push(path);
    } catch {
      // Not a usable path even after normalising: try the next form.
    }
  }
  return candidates;
}

/**
 * Applies `.` and `..` segments. Returns null if the path climbs above the vault
 * root, which is the case that must never be resolved to a real file.
 */
function normalize(path: string): string | null {
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..') {
      segments.push(segment);
      continue;
    }
    if (segments.length === 0) return null;
    segments.pop();
  }
  return segments.length === 0 ? null : segments.join('/');
}
