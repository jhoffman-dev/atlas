import {
  checkIncomingImage,
  defaultAltText,
  imageBytesRefusal,
  imageFileName,
  imageFolderFor,
  imageMarkdown,
  relativeImageSource,
  type IncomingImage,
  type VaultPath,
} from '@atlas/domain';
import {
  ImageEmbedError,
  placeImageUnderFreeName,
  writeImageUnderFreeName,
} from '../notes/embed-image.ts';
import { ApiError, messageWithoutPaths } from './api-error.ts';
import { chunkOf, offsetOf } from './chunks.ts';
import type { ApiNoteImage } from './contract.ts';
import { bodyObject } from './fields.ts';
import { notePathOf, readNote } from './note-io.ts';
import {
  continueUpload,
  stagedBytes,
  stagingPath,
  startUpload,
  uploadStepOf,
  type UploadStep,
} from './staged-upload.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

/**
 * Saves an image for a note, as a paste or a drop in the app saves one: into
 * the folder Settings → Images chooses, under its own name numbered clear of
 * any file there, never over one. Nothing else stands in for the webview
 * drawing it here, so its bytes must be the kind of image its name says, and
 * none may take it past the app's size limit.
 *
 * One that fits in a request is checked and saved at once. A larger one is
 * staged a chunk at a time outside the notes (`staged-upload.ts`), and only
 * checked whole and moved into place with its last chunk: nothing in the
 * vault is ever appended to.
 *
 * The note is not changed: the answer carries the `![alt](src)` to write into
 * it, with the append or body routes, where the caller wants it.
 */
export async function noteImageRoute(request: VaultRequest): Promise<RouteResult> {
  const notePath = await notePathOf(request);
  const fields = bodyObject(request.body);
  const bytes = chunkOf(fields);
  const offset = offsetOf(fields);
  const step = uploadStepOf(fields, offset);
  const image = incomingImage(request.nameParam, offset + bytes.byteLength);
  const { extension, name } = acceptedImage(request, image);
  await readNote(request, notePath);
  const target: ImageTarget = {
    notePath,
    folder: imageFolderFor({ notePath, placement: request.imagePlacement }),
    name,
    asked: image.name,
    extension,
  };

  if (step.kind === 'next') return nextChunk(request, { target, step, bytes, offset });
  refuseBytes(target, bytes);
  if (step.kind === 'first') {
    const id = await startUpload(request, bytes);
    return { status: 202, body: { upload: { id, size: bytes.byteLength } } };
  }
  const path = await placeImage(request, () =>
    writeImageUnderFreeName({ fs: request.fs, folder: target.folder, name, bytes }),
  );
  return { status: 201, body: { image: answerFor({ notePath, path, size: bytes.byteLength }) } };
}

/** Where an image is going, and the kind its name says it is. */
interface ImageTarget {
  readonly notePath: VaultPath;
  readonly folder: VaultPath;
  /** The name it is saved under, before numbering. */
  readonly name: string;
  /** The name as the URL gave it, for saying why it was refused. */
  readonly asked: string;
  readonly extension: string;
}

/** Adds a chunk to an upload; with its last, checks the whole image and moves it into place. */
async function nextChunk(
  request: VaultRequest,
  {
    target,
    step,
    bytes,
    offset,
  }: {
    target: ImageTarget;
    step: Extract<UploadStep, { kind: 'next' }>;
    bytes: Uint8Array;
    offset: number;
  },
): Promise<RouteResult> {
  const size = await continueUpload(request, { id: step.id, bytes, offset });
  if (!step.last) return { status: 200, body: { upload: { id: step.id, size } } };

  refuseBytes(target, await stagedBytes(request, step.id));
  const staged = stagingPath(step.id);
  const path = await placeImage(request, () =>
    placeImageUnderFreeName({
      fs: request.fs,
      folder: target.folder,
      name: target.name,
      place: (to) => request.fs.moveEntry({ from: staged, to }),
    }),
  );
  return { status: 201, body: { image: answerFor({ notePath: target.notePath, path, size }) } };
}

/** Refuses bytes that are not the kind of image the name says. */
function refuseBytes({ asked, extension }: ImageTarget, bytes: Uint8Array): void {
  const refusal = imageBytesRefusal({ name: asked, extension, head: bytes });
  if (refusal !== null) throw new ApiError('invalid', refusal);
}

/** The image as the URL names it, sized as it will be once this chunk is in. */
function incomingImage(segment: string, size: number): IncomingImage {
  let name: string;
  try {
    name = decodeURIComponent(segment);
  } catch {
    throw new ApiError('invalid', 'the image name is not validly percent-encoded');
  }
  if (name.includes('/') || name.startsWith('.')) {
    throw new ApiError('invalid', 'the image name must be a plain file name, not hidden');
  }
  return { name, mimeType: '', size, origin: 'file' };
}

/** Its kind and the name it is saved under, or why a note cannot take it. */
function acceptedImage(
  request: VaultRequest,
  image: IncomingImage,
): { extension: string; name: string } {
  const check = checkIncomingImage(image);
  if (check.kind === 'refused') throw new ApiError('invalid', check.message);
  // A named file keeps its own name; `now` names only a pasted one, never sent here.
  const now = `${request.clock.today()}T00:00:00`;
  return {
    extension: check.extension,
    name: imageFileName({ image, extension: check.extension, now }),
  };
}

/** Puts the image in place, saying why in the caller's terms when it cannot. */
async function placeImage(
  request: VaultRequest,
  place: () => Promise<VaultPath>,
): Promise<VaultPath> {
  request.assertStillOpen();
  try {
    return await place();
  } catch (error) {
    request.assertStillOpen();
    if (error instanceof ImageEmbedError) {
      throw new ApiError('conflict', messageWithoutPaths(error));
    }
    throw error;
  }
}

function answerFor({
  notePath,
  path,
  size,
}: {
  notePath: VaultPath;
  path: VaultPath;
  size: number;
}): ApiNoteImage {
  const name = path.split('/').at(-1) ?? path;
  const src = relativeImageSource({ notePath, imagePath: path });
  const alt = defaultAltText({ name, mimeType: '', size, origin: 'file' });
  return { path, size, src, alt, markdown: imageMarkdown({ alt, src }) };
}
