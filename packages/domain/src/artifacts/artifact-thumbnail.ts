import { joinVaultPath, vaultPathName, type VaultPath } from '../vault/vault-path.ts';
import { thumbnailValue } from '../thumbnails/page-thumbnail.ts';
import { ARTIFACT_KEYS, isArtifactNote, savedFolderOf } from './artifact.ts';

/*
 * An artifact's thumbnail: a picture of its saved copy's first screen, which
 * Atlas makes and keeps in the copy's folder, and which fronts its card in
 * the gallery by being the note's `cover`.
 *
 * Atlas owns the cover only while it is empty or names the thumbnail Atlas
 * made; a cover anyone set to anything else is theirs and is left alone. A
 * cover of `false` is one cleared on purpose (Clear): nothing fills it again
 * but the person asking (Regenerate). The
 * file's name is how that is told — a rule that holds however the note was
 * edited, in the app, over the API or in another editor — so it is reserved:
 * no file saved into a copy may take it.
 */

/** The file a copy's thumbnail is kept in, at the top of its folder. */
export const ARTIFACT_THUMBNAIL = 'atlas-thumbnail.png';

/**
 * How the page is pictured: laid out on a 1280 × 800 screen, the size an
 * artifact is usually made for, and pictured at half that — 640 × 400, the
 * gallery's 16:10 at twice a card's width. It is given `settleMs` after it
 * has loaded for its fonts and first frames, and `timeoutMs` in all.
 */
export const THUMBNAIL_SHOT = {
  width: 1280,
  height: 800,
  pictureWidth: 640,
  settleMs: 800,
  timeoutMs: 15_000,
} as const;

/** The largest thumbnail kept: far more than 640 × 400 needs, far less than a vault should hold. */
export const MAX_THUMBNAIL_BYTES = 4 * 1024 * 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Whether a name inside a copy is the one kept for its thumbnail, in any case. */
export function isThumbnailName(name: string): boolean {
  return name.toLowerCase() === ARTIFACT_THUMBNAIL;
}

/** Where a copy's thumbnail is written. */
export function thumbnailPath(folder: VaultPath): VaultPath {
  return joinVaultPath(folder, ARTIFACT_THUMBNAIL);
}

/** The thumbnail as the note's `cover` holds it: relative to the note, which sits beside the copy. */
export function thumbnailCover(folder: VaultPath): string {
  return `${vaultPathName(folder)}/${ARTIFACT_THUMBNAIL}`;
}

/**
 * A cover as text, '' for none. The cover is a thumbnail property, read as
 * any is (`thumbnailValue`): `auto` is none yet, for Atlas to fill.
 */
function coverText(properties: Readonly<Record<string, unknown>>): string {
  const cover = thumbnailValue(properties[ARTIFACT_KEYS.cover]);
  return cover.kind === 'chosen' ? cover.src : '';
}

/** What Clear writes: no cover, on purpose, so no run that was not asked for puts one back. */
export function clearedCover(): Record<string, unknown> {
  return { [ARTIFACT_KEYS.cover]: false };
}

/** Cleared on purpose: `false`, or the text "false" an API or a hand edit writes. */
function coverCleared(properties: Readonly<Record<string, unknown>>): boolean {
  return thumbnailValue(properties[ARTIFACT_KEYS.cover]).kind === 'cleared';
}

/**
 * Whether Atlas may set the cover of a note whose copy is `folder`: it has
 * none (and was not cleared), or it names this copy's thumbnail — relative to the note, as Atlas
 * writes it, or from the vault's top, which resolves to the same file.
 */
export function coverIsAtlas({
  properties,
  folder,
}: {
  properties: Readonly<Record<string, unknown>>;
  folder: VaultPath;
}): boolean {
  if (coverCleared(properties)) return false;
  const cover = coverText(properties).replace(/^\.\//, '');
  return cover === '' || cover === thumbnailCover(folder) || cover === thumbnailPath(folder);
}

/**
 * What to write into the note once its thumbnail is on disk, worked out from
 * the properties the note has when the write runs — so a cover set by hand
 * while the picture was being made is still left alone. Asked for by the
 * person (Regenerate), the cover is set whatever it was.
 */
export function thumbnailCoverChange({
  folder,
  asked,
}: {
  folder: VaultPath;
  asked: boolean;
}): (properties: Readonly<Record<string, unknown>>) => Record<string, unknown> {
  const cover = thumbnailCover(folder);
  return (properties) => {
    if (coverText(properties) === cover) return {};
    return asked || coverIsAtlas({ properties, folder }) ? { [ARTIFACT_KEYS.cover]: cover } : {};
  };
}

/**
 * Whether an artifact should be given a thumbnail without being asked: it
 * has a saved copy and no cover, and was not cleared. A cover it has —
 * Atlas's or anyone's — is left as it is; making one again is Regenerate's.
 */
export function needsThumbnail(properties: Readonly<Record<string, unknown>>): boolean {
  return (
    isArtifactNote(properties) &&
    savedFolderOf(properties) !== null &&
    coverText(properties) === '' &&
    !coverCleared(properties)
  );
}

/**
 * Why `bytes` cannot be kept as a thumbnail, or null when they can: they
 * must be a PNG, and no bigger than `MAX_THUMBNAIL_BYTES`. The picture comes
 * back from the host, and this is what stands between it and the vault.
 */
export function thumbnailRefusal(bytes: Uint8Array): string | null {
  if (bytes.byteLength > MAX_THUMBNAIL_BYTES) {
    return `a thumbnail is at most ${MAX_THUMBNAIL_BYTES / 1024 / 1024} MB`;
  }
  const isPng =
    bytes.byteLength > PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, at) => bytes[at] === byte);
  return isPng ? null : 'the thumbnail is not a PNG picture';
}
