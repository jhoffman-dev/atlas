import { parentVaultPath, vaultPathSegments, type VaultPath } from '../vault/vault-path.ts';

/** Where a note's embedded images are saved: one folder for the vault, or beside each note. */
export type ImagePlacement = 'attachments' | 'beside-note';

export const IMAGE_PLACEMENTS: readonly ImagePlacement[] = ['attachments', 'beside-note'];

export const DEFAULT_IMAGE_PLACEMENT: ImagePlacement = 'attachments';

/** The folder at the vault root that embedded images go in, as Obsidian's does. */
export const ATTACHMENTS_FOLDER = 'attachments' as VaultPath;

export function isImagePlacement(value: unknown): value is ImagePlacement {
  return IMAGE_PLACEMENTS.includes(value as ImagePlacement);
}

/** The folder an image embedded in `notePath` is saved in. */
export function imageFolderFor({
  notePath,
  placement,
}: {
  notePath: VaultPath;
  placement: ImagePlacement;
}): VaultPath {
  return placement === 'attachments' ? ATTACHMENTS_FOLDER : parentVaultPath(notePath);
}

/**
 * What the note writes in `![alt](…)` to reach `imagePath`: relative to the
 * note's folder, climbing with `../` where it has to, with each segment
 * percent-encoded.
 *
 * Relative, because both Obsidian and every CommonMark tool resolve a link
 * from the note's own folder. Percent-encoded rather than in `<…>`, because a
 * destination with a space is only a link in CommonMark inside angle brackets,
 * which some tools do not read, while `%20` every one of them — Obsidian
 * included — decodes. Brackets and parentheses are encoded too, so the
 * destination never needs escaping.
 */
export function relativeImageSource({
  notePath,
  imagePath,
}: {
  notePath: VaultPath;
  imagePath: VaultPath;
}): string {
  const from = vaultPathSegments(parentVaultPath(notePath));
  const to = vaultPathSegments(imagePath);
  let shared = 0;
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) {
    shared += 1;
  }
  const climbs = from.slice(shared).map(() => '..');
  return [...climbs, ...to.slice(shared).map(encodeSegment)].join('/');
}

/**
 * The markdown that shows an image: `![alt](src)`, with `src` as
 * `relativeImageSource` gives it. The alt text's brackets and backslashes are
 * escaped and its line breaks folded, so it can never end the image early.
 */
export function imageMarkdown({ alt, src }: { alt: string; src: string }): string {
  const text = alt
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\\[\]]/g, (character) => `\\${character}`);
  return `![${text}](${src})`;
}

/** A markdown image destination, decoded back to the path it names. Undecodable text is kept as written. */
export function decodeImageSource(src: string): string {
  try {
    return decodeURIComponent(src);
  } catch {
    // A lone `%` that is not an escape: the source names a file with a `%` in it.
    return src;
  }
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
