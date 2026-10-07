import { ARTIFACT_TYPE, isArtifactNote } from '../artifacts/artifact.ts';
import type { EditorDocument } from '../markdown/editor-node.ts';
import { resolveImageSource } from '../markdown/image-source.ts';
import { COVER_KEY, noteCover } from '../markdown/note-preview.ts';
import type { ObjectType } from '../types/property-def.ts';
import { createVaultPath, joinVaultPath, type VaultPath } from '../vault/vault-path.ts';

/*
 * A thumbnail property: a picture of a note that fronts its card. Any type can
 * have one (`kind: thumbnail`), and what the note holds under it says which
 * picture it is:
 *
 * - nothing, or `auto` — Atlas pictures the note's own page and keeps that
 *   picture in the cache, which is derived and disposable: it is never in the
 *   vault, and is made again whenever the note is not the version it was
 *   taken from;
 * - a path — a picture the person chose, kept in the vault like any image;
 * - `false` — none, on purpose (Clear): nothing is made for it until the
 *   person asks again (Regenerate).
 *
 * An artifact's page is its saved copy, not its note, so its thumbnail keeps
 * the rule it always had (`artifact-thumbnail.ts`): the picture is kept in
 * the copy and the property names it.
 */

/** What a thumbnail property holds to mean "Atlas pictures the page". */
export const THUMBNAIL_AUTO = 'auto';

/** What a thumbnail property's value means. */
export type ThumbnailValue =
  | { readonly kind: 'auto' }
  | { readonly kind: 'chosen'; readonly src: string }
  | { readonly kind: 'cleared' };

/** Reads a thumbnail property's value. Anything that is not a path or `false` means `auto`. */
export function thumbnailValue(raw: unknown): ThumbnailValue {
  if (raw === false) return { kind: 'cleared' };
  if (typeof raw !== 'string') return { kind: 'auto' };
  const text = raw.trim();
  const lower = text.toLowerCase();
  if (lower === 'false') return { kind: 'cleared' };
  if (text === '' || lower === THUMBNAIL_AUTO) return { kind: 'auto' };
  return { kind: 'chosen', src: text };
}

/**
 * The property whose picture fronts a type's cards: its first thumbnail
 * property, or null when it has none. Null for artifacts too, whose cover is
 * the picture of their saved copy and is read as the cover it always was.
 */
export function thumbnailPropertyOf(type: ObjectType | null | undefined): string | null {
  if (type === null || type === undefined || type.name === ARTIFACT_TYPE) return null;
  return type.properties.find((property) => property.kind === 'thumbnail')?.key ?? null;
}

/**
 * The key a thumbnail added to one note alone is kept under — and so how such
 * a property is known again when the note is read, with no type to say.
 */
export const THUMBNAIL_KEY = 'thumbnail';

/**
 * Which property holds a note's thumbnail: its type's, or one added to this
 * note alone under `THUMBNAIL_KEY`. Null for an artifact, and for a note with
 * neither.
 */
export function noteThumbnailKey({
  type,
  properties,
}: {
  type: ObjectType | null | undefined;
  properties: Readonly<Record<string, unknown>>;
}): string | null {
  if (isArtifactNote(properties)) return null;
  return thumbnailPropertyOf(type) ?? (THUMBNAIL_KEY in properties ? THUMBNAIL_KEY : null);
}

/**
 * How long a note must have gone unchanged before its page is pictured again:
 * a note being typed in is saved every few seconds, and is pictured once it
 * rests, not after every save.
 */
export const PAGE_THUMBNAIL_QUIET_MS = 4_000;

/**
 * How long to wait before picturing a note's page: null when its picture is
 * fresh, 0 when it is due now, otherwise the milliseconds until the note has
 * been quiet for `PAGE_THUMBNAIL_QUIET_MS`. A note with no picture at all is
 * due now — there is nothing on its card to keep. So is one dated after now:
 * it was not saved by this clock a moment ago but by one running ahead, and
 * waiting for this clock to catch up could be a wait of months.
 */
export function pageThumbnailWait({
  noteModified,
  picturedAt,
  now,
}: {
  noteModified: number;
  picturedAt: number | null;
  now: number;
}): number | null {
  if (!pageThumbnailStale({ noteModified, picturedAt })) return null;
  if (picturedAt === null || noteModified > now) return 0;
  return Math.max(0, noteModified + PAGE_THUMBNAIL_QUIET_MS - now);
}

/** What fronts a note's card: an image it names, the picture of its page, or nothing. */
export type CardFront =
  | { readonly kind: 'image'; readonly src: string }
  | { readonly kind: 'page' }
  | { readonly kind: 'none' };

/**
 * A card's front. A type with a thumbnail property is fronted by it: a picture
 * chosen, or the picture of the page. One cleared — or a type without one —
 * falls back to what any card is fronted with (`noteCover`): the note's
 * `cover`, or the first image in its body. A `cover` is read as a thumbnail
 * is — it is one, on an artifact, and may be the thumbnail cleared — so
 * `auto` or "false" there is no picture to load.
 */
export function cardFront({
  properties,
  doc,
  thumbnailKey,
}: {
  properties: Readonly<Record<string, unknown>>;
  doc: EditorDocument;
  thumbnailKey: string | null;
}): CardFront {
  if (thumbnailKey !== null) {
    const value = thumbnailValue(properties[thumbnailKey]);
    if (value.kind === 'chosen') return { kind: 'image', src: value.src };
    if (value.kind === 'auto') return { kind: 'page' };
  }
  const { [COVER_KEY]: declared, ...rest } = properties;
  const covered = thumbnailValue(declared).kind === 'chosen' ? properties : rest;
  const cover = noteCover({ properties: covered, doc });
  return cover === null ? { kind: 'none' } : { kind: 'image', src: cover };
}

/** Where pictures of pages are kept: in the cache beside the index, never in the vault's notes. */
export const PAGE_THUMBNAILS_FOLDER: VaultPath = createVaultPath('.atlas-cache/thumbnails');

/** The folders to make, outermost first, before a picture can be kept. */
export const PAGE_THUMBNAIL_FOLDERS: readonly VaultPath[] = [
  createVaultPath('.atlas-cache'),
  PAGE_THUMBNAILS_FOLDER,
];

/**
 * Where the picture of a note's page is kept: named by a hash of the note's
 * path, so the name says nothing about the note and fits any filesystem. A
 * renamed note is a new name, and so a new picture. A note that comes to a
 * path another had is pictured again too: its picture records which version
 * of the note at that path it was taken from (`pageThumbnailRecord`).
 */
export function pageThumbnailPath(notePath: VaultPath): VaultPath {
  return joinVaultPath(PAGE_THUMBNAILS_FOLDER, `${pathHash(notePath)}${PICTURE}`);
}

/** Whether a path is one of the page pictures kept in the cache, not a file of the vault's. */
export function isPageThumbnailPath(path: VaultPath): boolean {
  return path.startsWith(`${PAGE_THUMBNAILS_FOLDER}/`);
}

const PICTURE = '.png';
const RECORD = '.json';

/** Where the record of which version of the note a page picture is of is kept: beside it. */
export function pageThumbnailRecordPath(notePath: VaultPath): VaultPath {
  return joinVaultPath(PAGE_THUMBNAILS_FOLDER, `${pathHash(notePath)}${RECORD}`);
}

/** The picture a record in the cache is kept beside; null when `path` is not such a record. */
export function recordedPicturePath(path: VaultPath): VaultPath | null {
  if (!isPageThumbnailPath(path) || !path.endsWith(RECORD)) return null;
  return createVaultPath(`${path.slice(0, -RECORD.length)}${PICTURE}`);
}

/**
 * The record kept beside a page picture: the note's modification time when
 * it was read to be pictured. The picture's own file time says when it was
 * kept, which is later than a save that landed while it was being made.
 */
export function pageThumbnailRecord(noteModified: number): string {
  return `${JSON.stringify({ from: noteModified })}\n`;
}

/** The note time a record says its picture is of; null for anything that is not one. */
export function readPageThumbnailRecord(text: string): number | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || !('from' in parsed)) return null;
    const { from } = parsed;
    return typeof from === 'number' && Number.isFinite(from) ? from : null;
  } catch {
    // Not JSON: no record, so the page is pictured again, as with none at all.
    return null;
  }
}

/** The picture of a note's page as an image source, from the vault's top. */
export function pageThumbnailSrc(notePath: VaultPath): string {
  return `/${pageThumbnailPath(notePath)}`;
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/** FNV-1a over the path's UTF-16 code units, 64 bits, as 16 hex digits. */
export function pathHash(path: string): string {
  let hash = FNV_OFFSET;
  for (let at = 0; at < path.length; at += 1) {
    hash ^= BigInt(path.charCodeAt(at));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * Whether the picture of a page must be made again: there is none, or it is
 * of another version of the note than the one there now. `picturedAt` is the
 * note's modification time when it was read to be pictured, as its record
 * says — not when the picture was kept. Any other time, earlier or later, is
 * another version: saved since, restored from before, or another note moved
 * onto the path. Times are the host's, in milliseconds.
 */
export function pageThumbnailStale({
  noteModified,
  picturedAt,
}: {
  noteModified: number;
  picturedAt: number | null;
}): boolean {
  return picturedAt !== noteModified;
}

/**
 * Whether Atlas may picture a note's page for its thumbnail property: the
 * note's value is `auto`, or the person asked (Regenerate), which puts it
 * back to `auto` whatever it was.
 */
export function mayPicturePage({
  properties,
  thumbnailKey,
  asked,
}: {
  properties: Readonly<Record<string, unknown>>;
  thumbnailKey: string;
  asked: boolean;
}): boolean {
  return asked || thumbnailValue(properties[thumbnailKey]).kind === 'auto';
}

/**
 * What the note is given once its page has been pictured on request: `auto`,
 * unless it already means that — so a picture chosen or cleared gives way to
 * the page, and a note already on `auto` is not written at all.
 */
export function picturedPageChange(
  thumbnailKey: string,
): (properties: Readonly<Record<string, unknown>>) => Record<string, unknown> {
  return (properties) =>
    thumbnailValue(properties[thumbnailKey]).kind === 'auto'
      ? {}
      : { [thumbnailKey]: THUMBNAIL_AUTO };
}

/** What Clear writes: no picture, on purpose, so nothing makes one until asked. */
export function clearedThumbnail(thumbnailKey: string): Record<string, unknown> {
  return { [thumbnailKey]: false };
}

/**
 * What Choose image… writes: the picture's place in the vault, from its top —
 * unanchored, it would be looked for beside the note first.
 */
export function chosenThumbnail(thumbnailKey: string, path: VaultPath): Record<string, unknown> {
  return { [thumbnailKey]: `/${path}` };
}

/**
 * What Regenerate would put out of the note for good: a picture chosen that
 * is not in the vault — a web address — which only the note remembers. Null
 * when nothing would be lost: the value is `auto` or cleared, or names a
 * picture that stays in the vault. The person is asked before it goes.
 */
export function regenerateDiscards({
  properties,
  thumbnailKey,
  notePath,
}: {
  properties: Readonly<Record<string, unknown>>;
  thumbnailKey: string;
  notePath: VaultPath;
}): string | null {
  const value = thumbnailValue(properties[thumbnailKey]);
  if (value.kind !== 'chosen') return null;
  return resolveImageSource({ src: value.src, notePath }).kind === 'vault' ? null : value.src;
}
