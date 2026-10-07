import {
  ARTIFACT_ENTRY,
  ARTIFACT_KINDS,
  artifactFileRefusal,
  copyFolderFor,
  isArtifactKind,
  isArtifactLink,
  isArtifactNote,
  joinVaultPath,
  MAX_ARTIFACT_FILE_BYTES,
  MAX_ARTIFACT_FILES,
  parentVaultPath,
  savedCopyRefusal,
  savedCopyValues,
  savedFolderOf,
  splitFrontmatter,
  vaultPathName,
  type VaultPath,
} from '@atlas/domain';
import { ArtifactRefusedError } from '../artifacts/artifact-copy.ts';
import { listArtifactCopy } from '../artifacts/load-artifact-copy.ts';
import { saveArtifact } from '../artifacts/save-artifact.ts';
import { ApiError } from './api-error.ts';
import { chunkOf, offsetOf, writeChunk } from './chunks.ts';
import { bodyObject, optionalArray, optionalString, requiredText, type Fields } from './fields.ts';
import { answerWithNote, notePathOf, readNote } from './note-io.ts';
import { writeProperties } from './notes-write.ts';
import { folderFrom } from './paths.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

/**
 * Saves a Claude artifact in one call: its note in `artifacts/`, and — when
 * `html` is given — its page as `index.html` in a folder beside it.
 */
export async function saveArtifactRoute(request: VaultRequest): Promise<RouteResult> {
  const fields = bodyObject(request.body);
  const html = optionalString(fields, 'html');
  const artifact = {
    title: requiredText(fields, 'title'),
    url: optionalLink(fields),
    kind: optionalKind(fields),
    project: optionalString(fields, 'project'),
    tags: optionalTags(fields),
    body: optionalString(fields, 'body'),
    files:
      html === undefined
        ? undefined
        : [{ name: ARTIFACT_ENTRY, bytes: new TextEncoder().encode(html) }],
  };

  request.assertStillOpen();
  try {
    const { path } = await saveArtifact({
      fs: request.fs,
      markdown: request.markdown,
      clock: request.clock,
      artifact,
    });
    return await answerWithNote(request, { path, status: 201 });
  } catch (error) {
    if (error instanceof ArtifactRefusedError) throw new ApiError('invalid', error.message);
    throw error;
  }
}

/**
 * Pictures an artifact's saved copy as its thumbnail and makes it the cover —
 * once its last file is in, so the picture is of the whole page. A cover set
 * by hand is left as it is, and the answer is the note either way. It is
 * made in the app's thumbnail queue, which writes the cover as the app does.
 */
export async function artifactThumbnailRoute(request: VaultRequest): Promise<RouteResult> {
  const notePath = await notePathOf(request);
  const note = await readNote(request, notePath);
  const properties = request.markdown.frontmatterProperties(
    splitFrontmatter(note.text).frontmatter,
  );
  if (!isArtifactNote(properties)) throw new ApiError('invalid', `${notePath} is not an artifact`);

  request.assertStillOpen();
  try {
    // The app's shared queue, so an API picture waits its turn beside the
    // gallery's and shows there as under way and made.
    await request.thumbnails.requestOrFail({ path: notePath, asked: false });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof ArtifactRefusedError) throw new ApiError('invalid', error.message);
    throw new ApiError('thumbnail_failed', error instanceof Error ? error.message : String(error));
  }
  return answerWithNote(request, { path: notePath });
}

function optionalLink(fields: Fields): string | undefined {
  const url = optionalString(fields, 'url');
  if (url !== undefined && !isArtifactLink(url)) {
    throw new ApiError('invalid', 'url must be an http or https link');
  }
  return url;
}

function optionalKind(fields: Fields): string | undefined {
  const kind = optionalString(fields, 'kind');
  if (kind !== undefined && !isArtifactKind(kind)) {
    throw new ApiError('invalid', `kind must be one of ${ARTIFACT_KINDS.join(', ')}`);
  }
  return kind;
}

function optionalTags(fields: Fields): string[] | undefined {
  const tags = optionalArray(fields, 'tags');
  if (tags === undefined) return undefined;
  if (tags.some((tag) => typeof tag !== 'string')) {
    throw new ApiError('invalid', 'tags must be an array of strings');
  }
  return tags as string[];
}

/**
 * Writes one chunk of a file in an artifact's saved copy.
 *
 * The file goes in the folder the note's `saved` names or, when it names
 * none, the folder beside the note named for it — made, and recorded on the
 * note, on the first chunk. The file's name is checked by the same rule as a
 * dropped file's (`artifactFileRefusal`), so nothing lands outside the copy.
 */
export async function artifactFileRoute(request: VaultRequest): Promise<RouteResult> {
  const notePath = await notePathOf(request);
  const name = fileNameFrom(request.nameParam);
  const fields = bodyObject(request.body);
  const bytes = chunkOf(fields);
  const offset = offsetOf(fields);
  if (offset + bytes.byteLength > MAX_ARTIFACT_FILE_BYTES) {
    throw new ApiError('invalid', `a file is at most ${MAX_ARTIFACT_FILE_BYTES / 1024 / 1024} MB`);
  }

  const note = await readNote(request, notePath);
  const properties = request.markdown.frontmatterProperties(
    splitFrontmatter(note.text).frontmatter,
  );
  if (!isArtifactNote(properties)) throw new ApiError('invalid', `${notePath} is not an artifact`);

  const { folder, held } = await copyFolderOf(request, { notePath, properties });
  refuseTooMany({ held, name });
  const path = joinVaultPath(folder, name);
  await makeFolders(request, { top: folder, folder: parentVaultPath(path) });
  const size = await writeChunk(request, { path, bytes, offset });

  const changes = noteChanges({ properties, folder, today: request.clock.today() });
  if (Object.keys(changes).length > 0) {
    await writeProperties(request, { path: notePath, expected: note.modified, values: changes });
  }
  return { status: offset === 0 ? 201 : 200, body: { file: { path, size } } };
}

/**
 * What the note learns from a file written into its copy: where the copy is,
 * the first time. Its cover is the thumbnail's, asked for once the last file
 * is in (`POST /v1/artifacts/{path}/thumbnail`).
 */
function noteChanges({
  properties,
  folder,
  today,
}: {
  properties: Fields;
  folder: VaultPath;
  today: string;
}): Fields {
  return savedFolderOf(properties) === null
    ? savedCopyValues({ saved: folder, savedAt: today })
    : {};
}

function fileNameFrom(segment: string): string {
  let name: string;
  try {
    name = decodeURIComponent(segment);
  } catch {
    throw new ApiError('invalid', 'the file name is not validly percent-encoded');
  }
  const refusal = artifactFileRefusal(name);
  if (refusal !== null) throw new ApiError('invalid', refusal);
  return name;
}

/**
 * The copy's folder: the one `saved` names, which must be in the vault's own
 * space and be a copy (`savedCopyRefusal`), or — on the first file — the one
 * named for the note beside it, which must not be there yet: a folder already
 * at that name, in any case, is another artifact's copy or somebody's folder,
 * never this note's. Made when it is not there.
 */
async function copyFolderOf(
  request: VaultRequest,
  { notePath, properties }: { notePath: VaultPath; properties: Fields },
): Promise<{ folder: VaultPath; held: readonly string[] }> {
  const named = savedFolderOf(properties);
  const folder = named === null ? copyFolderFor(notePath) : folderFrom(named, 'saved');
  const siblings = await request.fs.listDirectory(parentVaultPath(folder));
  const there = siblings.find((entry) => entry.path.toLowerCase() === folder.toLowerCase());
  if (named === null && there !== undefined) {
    throw new ApiError(
      'invalid',
      `Something called ${vaultPathName(there.path)} is already beside this note; move it, then try again`,
    );
  }
  if (there?.kind === 'file') {
    throw new ApiError('invalid', `${folder} is a file, so the copy has nowhere to go`);
  }
  const held = there === undefined ? [] : await listArtifactCopy(request.fs, folder);
  const refusal = savedCopyRefusal({ notePath, folder, held });
  if (refusal !== null) throw new ApiError('invalid', refusal);
  if (there === undefined) {
    request.assertStillOpen();
    await request.fs.createFolder({ path: folder });
  }
  return { folder, held };
}

/** Refuses a new file that would take the copy past the limit a dropped copy is held to. */
function refuseTooMany({ held, name }: { held: readonly string[]; name: string }): void {
  if (!held.includes(name) && held.length >= MAX_ARTIFACT_FILES) {
    throw new ApiError('invalid', `a copy holds at most ${MAX_ARTIFACT_FILES} files`);
  }
}

/** Makes the folders between the copy's folder and a file deep inside it. */
async function makeFolders(
  request: VaultRequest,
  { top, folder }: { top: VaultPath; folder: VaultPath },
): Promise<void> {
  if (folder === top) return;
  const parent = parentVaultPath(folder);
  await makeFolders(request, { top, folder: parent });
  const siblings = await request.fs.listDirectory(parent);
  if (!siblings.some((entry) => entry.path === folder)) {
    await request.fs.createFolder({ path: folder });
  }
}
