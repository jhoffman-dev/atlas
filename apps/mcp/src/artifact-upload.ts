/**
 * Saving an artifact whatever its size, over an API whose host takes at most
 * 1 MiB per request.
 *
 * A page that fits is sent with the note in one request. One that does not —
 * and every other file of the copy — goes after it in chunks, each at the
 * offset the last one ended at, so Atlas can refuse a chunk that arrives
 * twice or out of order rather than write a broken file. Once the last file
 * is in, Atlas is asked to picture the copy for its thumbnail. This decides
 * nothing about artifacts; it only cuts bytes to fit the pipe.
 */

import type { ApiArtifactFile, ApiNote, ApiSaveArtifactBody } from '@atlas/application';
import { AtlasCallError, type AtlasClient } from './client.ts';

/** Raw bytes per chunk: as base64 in JSON, well under the host's 1 MiB cap. */
export const CHUNK_BYTES = 512 * 1024;

/** A page this size or smaller rides along with the note; larger ones are chunked. */
export const INLINE_PAGE_BYTES = 640 * 1024;

/** A file of the copy as the model hands it over: its text, or its bytes as base64. */
export interface ArtifactFileInput {
  readonly name: string;
  readonly text?: string | undefined;
  readonly base64?: string | undefined;
}

export interface ArtifactUpload extends Omit<ApiSaveArtifactBody, 'html'> {
  readonly html?: string | undefined;
  readonly files?: readonly ArtifactFileInput[] | undefined;
}

export interface UploadedArtifact {
  readonly note: ApiNote;
  readonly files: readonly ApiArtifactFile[];
  /** Why the copy has no thumbnail, when Atlas could not make one; absent when it could. */
  readonly thumbnail?: string;
}

export async function uploadArtifact(
  client: AtlasClient,
  { html, files = [], ...fields }: ArtifactUpload,
): Promise<UploadedArtifact> {
  const page = html === undefined ? null : Buffer.from(html, 'utf8');
  const inline = page !== null && page.byteLength <= INLINE_PAGE_BYTES;
  // Every file is decoded before anything is sent, so bad input saves nothing.
  const toSend: { name: string; bytes: Buffer }[] = [];
  if (page !== null && !inline) toSend.push({ name: 'index.html', bytes: page });
  for (const file of files) toSend.push({ name: file.name, bytes: bytesOf(file) });

  const { note } = await client.saveArtifact({
    ...fields,
    ...(inline && html !== undefined && { html }),
  });

  const written: ApiArtifactFile[] = [];
  for (const file of toSend) {
    try {
      written.push(await sendInChunks(client, note.path, file));
    } catch (error) {
      if (!(error instanceof AtlasCallError)) throw error;
      throw new AtlasCallError(
        `The artifact's note was saved at ${note.path}, but ${file.name} was not: ${error.message}`,
      );
    }
  }
  if (page === null && toSend.length === 0) return { note, files: [] };
  return { ...(await withThumbnail(client, note.path)), files: written };
}

/**
 * The note once its copy is pictured — the thumbnail is its cover — or, when
 * Atlas cannot picture it (not on macOS, a page that never loads), the note
 * as it is and why. The copy is saved either way, so that is not an error.
 */
async function withThumbnail(
  client: AtlasClient,
  path: string,
): Promise<{ note: ApiNote; thumbnail?: string }> {
  try {
    return await client.artifactThumbnail(path);
  } catch (error) {
    if (!(error instanceof AtlasCallError)) throw error;
    return { note: (await client.readNote(path)).note, thumbnail: error.message };
  }
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * A file's bytes, checked before anything is sent: Node decodes bad base64
 * without complaint, and the note would then be saved with a broken file.
 */
function bytesOf(file: ArtifactFileInput): Buffer {
  if ((file.text === undefined) === (file.base64 === undefined)) {
    throw new AtlasCallError(`${file.name}: give exactly one of text and base64`);
  }
  if (file.text !== undefined) return Buffer.from(file.text, 'utf8');
  return bytesFromBase64(file.name, file.base64 ?? '');
}

/** Base64 as bytes, refused rather than decoded loosely as Node would; `label` names it in the error. */
export function bytesFromBase64(label: string, text: string): Buffer {
  const base64 = text.replace(/\s+/g, '');
  if (!BASE64.test(base64)) throw new AtlasCallError(`${label}: base64 is not valid`);
  return Buffer.from(base64, 'base64');
}

async function sendInChunks(
  client: AtlasClient,
  notePath: string,
  { name, bytes }: { name: string; bytes: Buffer },
): Promise<ApiArtifactFile> {
  // An empty file is still one chunk: offset 0 is what creates it.
  const starts = Array.from(
    { length: Math.max(1, Math.ceil(bytes.byteLength / CHUNK_BYTES)) },
    (_, at) => at * CHUNK_BYTES,
  );
  const written: ApiArtifactFile[] = [];
  for (const offset of starts) {
    const chunk = bytes.subarray(offset, offset + CHUNK_BYTES);
    const { file } = await client.writeArtifactFile(notePath, name, {
      base64: chunk.toString('base64'),
      offset,
    });
    written.push(file);
  }
  const last = written.at(-1);
  if (last === undefined) throw new AtlasCallError(`${name}: nothing was sent`);
  return last;
}
