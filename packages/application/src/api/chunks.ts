import { decodeBase64, parentVaultPath, type VaultPath } from '@atlas/domain';
import { VaultAccessError } from '../vault/ports.ts';
import { ApiError } from './api-error.ts';
import { optionalString, type Fields } from './fields.ts';
import type { VaultRequest } from './vault-request.ts';

/*
 * A file sent a chunk at a time, for a file larger than the host's 1 MiB body
 * cap: an artifact's saved copy, an image for a note. Offset 0 creates the
 * file and never overwrites; each next chunk goes on the end of a file that
 * must be exactly `offset` bytes long, so a chunk retried or reordered is
 * refused rather than written into the middle of it.
 */

/** The chunk's bytes: exactly one of `text` (written as UTF-8) and `base64`. */
export function chunkOf(fields: Fields): Uint8Array {
  const text = optionalString(fields, 'text');
  const base64 = optionalString(fields, 'base64');
  if ((text === undefined) === (base64 === undefined)) {
    throw new ApiError('invalid', 'send exactly one of text and base64');
  }
  if (text !== undefined) return new TextEncoder().encode(text);
  const bytes = decodeBase64(base64 ?? '');
  if (bytes === null) throw new ApiError('invalid', 'base64 is not standard padded base64');
  return bytes;
}

/** Where the chunk goes in the file: 0, the default, or the size the last chunk answered. */
export function offsetOf(fields: Fields): number {
  const offset = fields['offset'] ?? 0;
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) {
    throw new ApiError('invalid', 'offset must be a whole number of bytes, 0 or more');
  }
  return offset;
}

/** Writes the chunk, and says why in the caller's terms when the host refuses it. */
export async function writeChunk(
  request: VaultRequest,
  { path, bytes, offset }: { path: VaultPath; bytes: Uint8Array; offset: number },
): Promise<number> {
  request.assertStillOpen();
  try {
    return await request.fs.writeBinaryFile({ path, bytes, offset });
  } catch (error) {
    if (!(error instanceof VaultAccessError)) throw error;
    request.assertStillOpen();
    // A folder that cannot be listed holds nothing this chunk could go on.
    const siblings = await request.fs.listDirectory(parentVaultPath(path)).catch(() => []);
    const exists = siblings.some((entry) => entry.path === path);
    if (offset === 0 && exists) throw new ApiError('exists', `${path} already exists`);
    if (offset > 0 && !exists) {
      throw new ApiError(
        'not_found',
        `${path} does not exist yet: send its first chunk at offset 0`,
      );
    }
    throw new ApiError(
      'conflict',
      `${path} is not ${offset} bytes long; nothing was written. Resend from its current length`,
    );
  }
}
