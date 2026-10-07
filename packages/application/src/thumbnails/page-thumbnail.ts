import {
  bodyWithoutTitle,
  dataUrl,
  imageMimeType,
  imageSourceCandidates,
  MAX_PAGE_IMAGE_BYTES,
  MAX_PAGE_IMAGES_BYTES,
  mayPicturePage,
  notePageDocument,
  noteTitle,
  PAGE_THUMBNAIL_FOLDERS,
  PAGE_THUMBNAILS_FOLDER,
  pageImageSources,
  pageThumbnailPath,
  pageThumbnailRecord,
  pageThumbnailRecordPath,
  pageThumbnailSrc,
  parentVaultPath,
  picturedPageChange,
  readPageThumbnailRecord,
  recordedPicturePath,
  resolveImageSource,
  splitFrontmatter,
  THUMBNAIL_SHOT,
  thumbnailRefusal,
  withInlinedImages,
  type EditorDocument,
  type VaultEntry,
  type VaultFile,
  type VaultPath,
} from '@atlas/domain';
import type { ThumbnailResult } from '../artifacts/artifact-thumbnail.ts';
import type { PageSnapshotPort } from '../artifacts/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { PropertyChanges } from '../query/set-property.ts';
import type { NoteContents, VaultFsPort } from '../vault/ports.ts';
import { ThumbnailRefusedError, type NotePageRenderer } from './ports.ts';

/** What picturing a note's page needs. */
export interface PagePictureDeps {
  readonly fs: VaultFsPort;
  readonly markdown: MarkdownPort;
  readonly snapshot: PageSnapshotPort;
  readonly renderer: NotePageRenderer;
}

/**
 * Pictures a note's own page for its thumbnail property and keeps the
 * picture in the cache (`pageThumbnailPath`), never in the vault, with a
 * record of which version of the note it is of (`pageThumbnailRecord`).
 *
 * Unless the person `asked` (Regenerate), a note whose value is a picture it
 * chose, or cleared, is left alone. Asked, the value goes back to `auto` —
 * written after the page is pictured and before the picture is kept, so a
 * failed picture changes nothing.
 */
export async function generatePageThumbnail({
  deps,
  notePath,
  thumbnailKey,
  asked,
  setProperties,
}: {
  deps: PagePictureDeps;
  notePath: VaultPath;
  thumbnailKey: string;
  asked: boolean;
  /** Writes the note's properties — through its pane when one holds it. */
  setProperties: (values: PropertyChanges) => Promise<void>;
}): Promise<ThumbnailResult> {
  const { fs, markdown, snapshot } = deps;
  const read = await fs.readTextFile(notePath);
  const { frontmatter, body } = splitFrontmatter(read.text);
  const properties = markdown.frontmatterProperties(frontmatter);
  if (!mayPicturePage({ properties, thumbnailKey, asked })) return { kind: 'kept' };

  const html = await notePageHtml({ deps, notePath, doc: markdown.parseBody(body).doc });
  const picture = await snapshot.capture({ html, ...THUMBNAIL_SHOT });
  const bad = thumbnailRefusal(picture);
  if (bad !== null) throw new ThumbnailRefusedError(bad);
  if (asked) await setProperties(picturedPageChange(thumbnailKey));
  const from = await versionPictured({ fs, notePath, read, body });
  const path = pageThumbnailPath(notePath);
  await keepPicture({ fs, path, bytes: picture });
  await fs.writeBinaryFile({
    path: pageThumbnailRecordPath(notePath),
    bytes: new TextEncoder().encode(pageThumbnailRecord(from)),
    offset: 0,
    replace: true,
  });
  return { kind: 'made', path, cover: pageThumbnailSrc(notePath) };
}

/**
 * Which version of the note the picture is of: the one read to picture it —
 * or, when the note has changed since only in its properties (Regenerate's
 * `auto`, a status set while the page loaded), the one there now, since the
 * page pictured is its title and body alone. A body saved in the meantime
 * leaves the version read, so the picture is stale and made again.
 */
async function versionPictured({
  fs,
  notePath,
  read,
  body,
}: {
  fs: VaultFsPort;
  notePath: VaultPath;
  read: NoteContents;
  body: string;
}): Promise<number> {
  const now = await fs.readTextFile(notePath);
  return splitFrontmatter(now.text).body === body ? now.modified : read.modified;
}

/**
 * The note as one page to picture: its title, and its body as the app draws
 * it, with the images it names written in and the policy first.
 */
export async function notePageHtml({
  deps,
  notePath,
  doc,
}: {
  deps: Pick<PagePictureDeps, 'fs' | 'renderer'>;
  notePath: VaultPath;
  doc: EditorDocument;
}): Promise<string> {
  const title = noteTitle(notePath);
  const body = bodyWithoutTitle(doc, title);
  const inlined = await inlineImages({ fs: deps.fs, notePath, doc: body });
  return notePageDocument({
    title,
    bodyHtml: deps.renderer.bodyHtml(withInlinedImages(body, inlined)),
    styles: deps.renderer.styles,
  });
}

/**
 * Each image the body names that is in the vault, as a `data:` URL, by what
 * the note wrote — none bigger than `MAX_PAGE_IMAGE_BYTES`, and no more than
 * `MAX_PAGE_IMAGES_BYTES` in all: the rest are left out.
 */
async function inlineImages({
  fs,
  notePath,
  doc,
}: {
  fs: VaultFsPort;
  notePath: VaultPath;
  doc: EditorDocument;
}): Promise<Map<string, string>> {
  const inlined = new Map<string, string>();
  const listings = new Map<VaultPath, Promise<readonly VaultEntry[]>>();
  const images = { listings, left: MAX_PAGE_IMAGES_BYTES };
  for (const src of pageImageSources(doc)) {
    // The web is out of the page's reach, so an image there is left out.
    if (resolveImageSource({ src, notePath }).kind !== 'vault') continue;
    const candidates = imageSourceCandidates({ src, notePath });
    const bytes = await readImage({ fs, candidates, images });
    if (bytes === null) continue;
    images.left -= bytes.data.byteLength;
    inlined.set(src, dataUrl(imageMimeType(bytes.path), bytes.data));
  }
  return inlined;
}

/** What reading a page's images shares: each folder's listing, and the bytes still allowed. */
interface PageImages {
  readonly listings: Map<VaultPath, Promise<readonly VaultEntry[]>>;
  readonly left: number;
}

/**
 * The first candidate that is there, as its bytes — its size taken from its
 * folder's listing first, so an image too big is never read at all. Null
 * when none is there, or the one there does not fit.
 */
async function readImage({
  fs,
  candidates,
  images,
}: {
  fs: VaultFsPort;
  candidates: readonly VaultPath[];
  images: PageImages;
}): Promise<{ path: VaultPath; data: Uint8Array } | null> {
  const fits = (size: number) => size <= MAX_PAGE_IMAGE_BYTES && size <= images.left;
  for (const candidate of candidates) {
    const listed = await listedFile({ fs, path: candidate, listings: images.listings });
    if (listed === null) continue;
    if (listed.size !== undefined && !fits(listed.size)) return null;
    try {
      const data = new Uint8Array(await fs.readBinaryFile(listed.path));
      // Checked again: a host that gave no size, or a file grown since it was listed.
      return fits(data.byteLength) ? { path: listed.path, data } : null;
    } catch {
      // Listed but unreadable: try the next place it could be.
    }
  }
  return null;
}

/** The file at `path` as its folder lists it; null when it is not there. Each folder is listed once. */
async function listedFile({
  fs,
  path,
  listings,
}: {
  fs: VaultFsPort;
  path: VaultPath;
  listings: Map<VaultPath, Promise<readonly VaultEntry[]>>;
}): Promise<VaultFile | null> {
  const folder = parentVaultPath(path);
  let listing = listings.get(folder);
  if (listing === undefined) {
    // A folder that cannot be listed holds nothing to read.
    listing = fs.listDirectory(folder).catch(() => []);
    listings.set(folder, listing);
  }
  const entries = await listing;
  // A disk that ignores case finds `Sand.PNG` as `sand.png`, as reading it would.
  const lower = path.toLowerCase();
  const entry =
    entries.find((candidate) => candidate.path === path) ??
    entries.find((candidate) => candidate.path.toLowerCase() === lower);
  return entry?.kind === 'file' ? entry : null;
}

/**
 * Keeps a picture in the cache, replacing the one before. The cache's folders
 * are made the first time one is needed.
 */
async function keepPicture({
  fs,
  path,
  bytes,
}: {
  fs: VaultFsPort;
  path: VaultPath;
  bytes: Uint8Array;
}): Promise<void> {
  const write = () => fs.writeBinaryFile({ path, bytes, offset: 0, replace: true });
  try {
    await write();
  } catch {
    for (const folder of PAGE_THUMBNAIL_FOLDERS) {
      // Refused when it is already there, which is what is wanted; any other
      // reason is reported by the write tried again below.
      await fs.createFolder({ path: folder }).catch(() => undefined);
    }
    await write();
  }
}

/**
 * Which version of its note each picture in the cache is of — the note's
 * time its record says — by the picture's path. A picture with no record
 * that reads is left out, as if it were not there. Empty before the first is
 * made. A listing or a read that fails is empty too: at worst every picture
 * is made again, which is what a cache is for.
 */
export async function picturedPages(fs: VaultFsPort): Promise<ReadonlyMap<string, number>> {
  try {
    const entries = await fs.listDirectory(PAGE_THUMBNAILS_FOLDER);
    const files = new Set<string>(
      entries.flatMap((entry) => (entry.kind === 'file' ? [entry.path] : [])),
    );
    const pictureOf = new Map<string, string>();
    for (const entry of entries) {
      const picture = entry.kind === 'file' ? recordedPicturePath(entry.path) : null;
      if (picture !== null && files.has(picture)) pictureOf.set(entry.path, picture);
    }
    const records = pictureOf.size === 0 ? [] : await fs.readNotes([...pictureOf.keys()]);
    return new Map(
      records.flatMap((record) => {
        const from = readPageThumbnailRecord(record.text);
        const picture = pictureOf.get(record.path);
        return from === null || picture === undefined ? [] : [[picture, from] as const];
      }),
    );
  } catch {
    return new Map();
  }
}
