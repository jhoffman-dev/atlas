import { createVaultPath, joinVaultPath, type VaultPath } from '@atlas/domain';
import { ApiError } from './api-error.ts';
import { writeChunk } from './chunks.ts';
import { optionalString, type Fields } from './fields.ts';
import type { VaultRequest } from './vault-request.ts';

/*
 * A file received a chunk at a time, kept out of the vault's notes until it
 * is whole.
 *
 * Its chunks go to a staging file in the cache, named by an id the first
 * chunk is answered with and no one can guess, so a caller can only ever add
 * to a file it started itself — never to one already in the vault. The last
 * chunk's route checks the whole file and moves it into place. A staging
 * file given up on is inert: nothing reads the cache's uploads, and the cache
 * is disposable.
 */

const CACHE_FOLDER = createVaultPath('.atlas-cache');
const UPLOADS_FOLDER = joinVaultPath(CACHE_FOLDER, 'uploads');

/** What an id the API handed out can look like: nothing that climbs or names a folder. */
const UPLOAD_ID = /^[A-Za-z0-9-]{1,64}$/;

/** Which chunk of an upload a request carries. */
export type UploadStep =
  | { readonly kind: 'whole' }
  | { readonly kind: 'first' }
  | { readonly kind: 'next'; readonly id: string; readonly last: boolean };

/** Reads `upload`, `last` and the offset together, refusing a combination that cannot be. */
export function uploadStepOf(fields: Fields, offset: number): UploadStep {
  const id = optionalString(fields, 'upload');
  const last = fields['last'] ?? true;
  if (typeof last !== 'boolean') throw new ApiError('invalid', 'last must be true or false');
  if (offset === 0) {
    if (id !== undefined) {
      throw new ApiError('invalid', 'the first chunk starts an upload: send it with no upload id');
    }
    return last ? { kind: 'whole' } : { kind: 'first' };
  }
  if (id === undefined) {
    throw new ApiError(
      'invalid',
      'a chunk past offset 0 must carry the upload id its first chunk was answered with',
    );
  }
  if (!UPLOAD_ID.test(id)) throw new ApiError('not_found', 'there is no upload with that id');
  return { kind: 'next', id, last };
}

/** Starts an upload with its first chunk; resolves to its id. */
export async function startUpload(request: VaultRequest, bytes: Uint8Array): Promise<string> {
  const id = request.newUploadId();
  const path = stagingPath(id);
  request.assertStillOpen();
  try {
    await request.fs.writeBinaryFile({ path, bytes, offset: 0 });
  } catch {
    // Most often the cache has no uploads folder yet; a real problem is
    // reported by the write tried again once the folders are made.
    await makeStagingFolders(request);
    await request.fs.writeBinaryFile({ path, bytes, offset: 0 });
  }
  return id;
}

/** Adds a chunk to an upload at `offset`; resolves to its size so far. */
export async function continueUpload(
  request: VaultRequest,
  { id, bytes, offset }: { id: string; bytes: Uint8Array; offset: number },
): Promise<number> {
  try {
    return await writeChunk(request, { path: stagingPath(id), bytes, offset });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'not_found') {
      throw new ApiError('not_found', 'there is no upload with that id');
    }
    throw error;
  }
}

/** The whole of an upload, once its last chunk is in. */
export async function stagedBytes(request: VaultRequest, id: string): Promise<Uint8Array> {
  return new Uint8Array(await request.fs.readBinaryFile(stagingPath(id)));
}

/** Where an upload is staged. */
export function stagingPath(id: string): VaultPath {
  return joinVaultPath(UPLOADS_FOLDER, id);
}

async function makeStagingFolders(request: VaultRequest): Promise<void> {
  for (const folder of [CACHE_FOLDER, UPLOADS_FOLDER]) {
    request.assertStillOpen();
    // Refused when it is already there, which is what is wanted; any other
    // reason is reported by the write tried again after.
    await request.fs.createFolder({ path: folder }).catch(() => undefined);
  }
}
