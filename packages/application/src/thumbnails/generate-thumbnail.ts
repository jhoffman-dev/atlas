import {
  isArtifactNote,
  noteThumbnailKey,
  splitFrontmatter,
  type ObjectType,
  type VaultPath,
} from '@atlas/domain';
import {
  generateArtifactThumbnail,
  type ThumbnailResult,
} from '../artifacts/artifact-thumbnail.ts';
import type { PropertyChanges } from '../query/set-property.ts';
import { generatePageThumbnail, type PagePictureDeps } from './page-thumbnail.ts';
import { ThumbnailRefusedError } from './ports.ts';

/**
 * Makes a note's thumbnail, whichever kind of note it is: an artifact's is a
 * picture of its saved copy, kept in the copy (`generateArtifactThumbnail`);
 * any other note's is a picture of its own page, kept in the cache
 * (`generatePageThumbnail`). One queue makes both. Refused when the note has
 * no thumbnail property to make one for.
 */
export async function generateThumbnail({
  deps,
  typeOf,
  notePath,
  asked,
  unsaved,
  setProperties,
}: {
  deps: PagePictureDeps;
  /** The type a note names, as the vault defines it now. */
  typeOf: (name: string) => ObjectType | undefined;
  notePath: VaultPath;
  asked: boolean;
  /** Whether a pane holds edits to the note not yet saved: it is being typed in. */
  unsaved: boolean;
  setProperties: (values: PropertyChanges) => Promise<void>;
}): Promise<ThumbnailResult> {
  const { text } = await deps.fs.readTextFile(notePath);
  const properties = deps.markdown.frontmatterProperties(splitFrontmatter(text).frontmatter);
  if (isArtifactNote(properties)) {
    return generateArtifactThumbnail({ ...deps, notePath, asked, setProperties });
  }
  // A page being typed in is pictured once it is saved and rests, not now —
  // unless the person asked. An artifact's picture is of its copy, which the
  // note's edits do not change.
  if (!asked && unsaved) return { kind: 'kept' };
  const typeName = properties['type'];
  const thumbnailKey = noteThumbnailKey({
    type: typeof typeName === 'string' ? typeOf(typeName) : undefined,
    properties,
  });
  if (thumbnailKey === null) throw new ThumbnailRefusedError('This note has no thumbnail property');
  return generatePageThumbnail({ deps, notePath, thumbnailKey, asked, setProperties });
}
