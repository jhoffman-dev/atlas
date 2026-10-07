import {
  ARTIFACT_TYPE,
  coverIsAtlas,
  createVaultPath,
  needsThumbnail,
  savedCopyRefusal,
  splitFrontmatter,
  THUMBNAIL_SHOT,
  thumbnailCover,
  thumbnailCoverChange,
  thumbnailPath,
  thumbnailRefusal,
  type VaultPath,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { PropertyChanges } from '../query/set-property.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { ArtifactRefusedError } from './artifact-copy.ts';
import { listArtifactCopy, loadArtifactCopy } from './load-artifact-copy.ts';
import type { PageSnapshotPort } from './ports.ts';

/** How making a thumbnail ended, when it did not fail. */
export type ThumbnailResult =
  /** The picture is in the copy, and the note's cover names it. */
  | { readonly kind: 'made'; readonly path: VaultPath; readonly cover: string }
  /** Not asked for, and the cover is somebody's: nothing was made or changed. */
  | { readonly kind: 'kept' };

/**
 * Pictures an artifact's saved copy, keeps the picture in the copy's folder,
 * and makes it the note's cover.
 *
 * The note is read as it is now. Unless the person `asked` (Regenerate), a
 * cover somebody set is left alone and nothing is pictured; and the cover is
 * set by a rule run against the note when the write lands, so one set while
 * the picture was being made is left alone too. The picture is written
 * before the cover, so a failure anywhere leaves the cover as it was. Refused
 * — `ArtifactRefusedError` — when the note has no copy that can be shown, or
 * names a folder that is not its copy; a picture the host could not make
 * rejects with the host's reason.
 */
export async function generateArtifactThumbnail({
  fs,
  markdown,
  snapshot,
  notePath,
  asked,
  setProperties,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  snapshot: PageSnapshotPort;
  notePath: VaultPath;
  asked: boolean;
  /** Writes the note's properties — through its pane when one holds it. */
  setProperties: (values: PropertyChanges) => Promise<void>;
}): Promise<ThumbnailResult> {
  const properties = await readProperties({ fs, markdown, notePath });
  const copy = await loadArtifactCopy({ fs, properties });
  if (copy.kind !== 'ready') throw new ArtifactRefusedError('There is no saved copy to picture');
  const { folder, page } = copy;
  if (!asked && !coverIsAtlas({ properties, folder })) return { kind: 'kept' };
  const refusal = savedCopyRefusal({
    notePath,
    folder,
    held: await listArtifactCopy(fs, folder),
  });
  if (refusal !== null) throw new ArtifactRefusedError(refusal);

  const picture = await snapshot.capture({ html: page, ...THUMBNAIL_SHOT });
  const bad = thumbnailRefusal(picture);
  if (bad !== null) throw new ArtifactRefusedError(bad);
  const path = thumbnailPath(folder);
  await fs.writeBinaryFile({ path, bytes: picture, offset: 0, replace: true });
  await setProperties(thumbnailCoverChange({ folder, asked }));
  return { kind: 'made', path, cover: thumbnailCover(folder) };
}

async function readProperties({
  fs,
  markdown,
  notePath,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  notePath: VaultPath;
}): Promise<Readonly<Record<string, unknown>>> {
  const { text } = await fs.readTextFile(notePath);
  return markdown.frontmatterProperties(splitFrontmatter(text).frontmatter);
}

/**
 * The artifacts that have a saved copy and no cover — the ones "Generate
 * missing thumbnails" makes pictures for. A note that will not read is
 * passed over: it is not one this can say anything about.
 */
export async function artifactsWithoutThumbnails({
  index,
  fs,
  markdown,
}: {
  index: IndexPort;
  fs: VaultFsPort;
  markdown: MarkdownPort;
}): Promise<VaultPath[]> {
  const notes = await index.notesOfType(ARTIFACT_TYPE);
  const wanted: VaultPath[] = [];
  for (const note of notes) {
    const notePath = createVaultPath(note.path);
    // Gone or unreadable since the index saw it: nothing to picture.
    const properties = await readProperties({ fs, markdown, notePath }).catch(() => null);
    if (properties !== null && needsThumbnail(properties)) wanted.push(notePath);
  }
  return wanted;
}
