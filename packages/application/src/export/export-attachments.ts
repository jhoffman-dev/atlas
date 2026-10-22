import {
  ATTACHMENTS_FOLDER,
  createVaultPath,
  dataUrl,
  imageMimeType,
  imageSourceCandidates,
  MAX_IMAGE_BYTES,
  type VaultEntry,
  type VaultFile,
  type VaultPath,
} from '@dfai/domain';
import { listedFile } from '../thumbnails/page-thumbnail.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/*
 * The pictures a note shows, found in the vault and read for an export
 * (#501): copied beside a Markdown export, or written into the page a PDF
 * or a Google Doc is made from.
 */

/** The most picture bytes written into one page, all together: past it, a picture is left out. */
export const MAX_PAGE_PICTURE_BYTES = 40 * 1024 * 1024;

/**
 * Where a picture a note names could be, most likely first: as a path from
 * the note's folder or the vault's root — and, for a bare name as an embed
 * writes it (`![[plan.png]]`), in the attachments folder pictures go to.
 */
function pictureCandidates(src: string, notePath: VaultPath): VaultPath[] {
  const candidates = imageSourceCandidates({ src, notePath });
  if (!src.includes('/')) {
    try {
      const inAttachments = createVaultPath(`${ATTACHMENTS_FOLDER}/${src.trim()}`);
      if (!candidates.includes(inAttachments)) candidates.push(inAttachments);
    } catch {
      // A name no vault path can hold names no file there either.
    }
  }
  return candidates;
}

/** The file each picture source names, by its source as written; one not in the vault is left out. */
export async function locatePictures({
  fs,
  notePath,
  sources,
}: {
  fs: VaultFsPort;
  notePath: VaultPath;
  sources: readonly string[];
}): Promise<Map<string, VaultFile>> {
  const listings = new Map<VaultPath, Promise<readonly VaultEntry[]>>();
  const found = new Map<string, VaultFile>();
  for (const src of sources) {
    for (const candidate of pictureCandidates(src, notePath)) {
      const file = await listedFile({ fs, path: candidate, listings });
      if (file !== null) {
        found.set(src, file);
        break;
      }
    }
  }
  return found;
}

/**
 * Each located picture as a `data:` URL, by its source — none bigger than a
 * note may hold, and no more than `MAX_PAGE_PICTURE_BYTES` in all. `leftOut`
 * counts those that did not fit or could not be read.
 */
export async function picturesAsDataUrls({
  fs,
  located,
}: {
  fs: VaultFsPort;
  located: ReadonlyMap<string, VaultFile>;
}): Promise<{ urls: Map<string, string>; leftOut: number }> {
  const urls = new Map<string, string>();
  let left = MAX_PAGE_PICTURE_BYTES;
  let leftOut = 0;
  const fits = (size: number) => size <= MAX_IMAGE_BYTES && size <= left;
  for (const [src, file] of located) {
    if (file.size !== undefined && !fits(file.size)) {
      leftOut += 1;
      continue;
    }
    try {
      const bytes = new Uint8Array(await fs.readBinaryFile(file.path));
      // Checked again: a file grown since it was listed.
      if (!fits(bytes.byteLength)) {
        leftOut += 1;
        continue;
      }
      left -= bytes.byteLength;
      urls.set(src, dataUrl(imageMimeType(file.path), bytes));
    } catch {
      // Listed but unreadable: shown as its words, and counted as left out.
      leftOut += 1;
    }
  }
  return { urls, leftOut };
}
