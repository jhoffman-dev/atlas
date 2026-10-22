import {
  checkIncomingImage,
  defaultAltText,
  imageFileName,
  imageFolderFor,
  imageMimeType,
  relativeImageSource,
  undrawableImageMessage,
  type ImagePlacement,
  type IncomingImage,
  type VaultPath,
} from '@dfai/domain';
import type { VaultFsPort } from '../vault/ports.ts';
import { FileNotPlacedError, placeUnderFreeName } from '../vault/place-under-free-name.ts';

/**
 * Whether the webview can draw an image. Asked before an image is saved, so a
 * HEIC photo on a Mac that cannot show one — or a file that only claims to be
 * an image — is refused instead of saved and shown as missing.
 */
export interface ImageProbePort {
  canShow(image: { bytes: Uint8Array; mimeType: string }): Promise<boolean>;
}

/** Why an image did not go into a note, in words to show where it would have gone. */
export class ImageEmbedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageEmbedError';
  }
}

/**
 * The image itself was refused — too large, of a kind DFAI does not take, or
 * one this Mac cannot draw — before anything was written: the person's to act
 * on, and no fault of the vault's.
 */
export class ImageRefusedError extends ImageEmbedError {
  constructor(message: string) {
    super(message);
    this.name = 'ImageRefusedError';
  }
}

/** An image saved into the vault, and what the note writes to show it. */
export interface EmbeddedImage {
  readonly path: VaultPath;
  /** The destination of `![alt](src)`: relative to the note, percent-encoded. */
  readonly src: string;
  readonly alt: string;
}

/**
 * Saves an image for a note and says how the note should point at it.
 *
 * The image is checked, then drawn by the webview, then written into the
 * folder `placement` names — made if it is not there yet — under a name
 * numbered clear of every file already in it. Nothing is ever overwritten:
 * the host creates the file or refuses, and a name taken in between is
 * numbered past and tried again. The note itself is not touched; inserting
 * `![alt](src)` is the editor's, since the note is open in a pane that owns
 * its writes.
 */
export async function embedImage({
  fs,
  probe,
  notePath,
  image,
  readBytes,
  placement,
  now,
}: {
  fs: VaultFsPort;
  probe: ImageProbePort;
  notePath: VaultPath;
  image: IncomingImage;
  /** Read only once the image has passed its checks, so a huge file is refused unread. */
  readBytes: () => Promise<Uint8Array>;
  placement: ImagePlacement;
  /** Local time, `YYYY-MM-DDTHH:mm:ss`, which names a pasted image. */
  now: string;
}): Promise<EmbeddedImage> {
  const check = checkIncomingImage(image);
  if (check.kind === 'refused') throw new ImageRefusedError(check.message);

  const name = imageFileName({ image, extension: check.extension, now });
  const bytes = await readBytes();
  const mimeType = imageMimeType(name);
  if (!(await probe.canShow({ bytes, mimeType }))) {
    throw new ImageRefusedError(
      undrawableImageMessage({ name: image.name, extension: check.extension }),
    );
  }

  const folder = imageFolderFor({ notePath, placement });
  const path = await writeImageUnderFreeName({ fs, folder, name, bytes });
  return {
    path,
    src: relativeImageSource({ notePath, imagePath: path }),
    alt: defaultAltText(image),
  };
}

/**
 * Writes `bytes` as a new file in `folder` — made if it is not there — under
 * `name`, numbered clear of every file already in it. Nothing is overwritten:
 * a name taken in between is numbered past and tried again.
 */
export async function writeImageUnderFreeName({
  fs,
  folder,
  name,
  bytes,
}: {
  fs: Pick<VaultFsPort, 'listDirectory' | 'createFolder' | 'writeBinaryFile'>;
  folder: VaultPath;
  name: string;
  bytes: Uint8Array;
}): Promise<VaultPath> {
  return placeImageUnderFreeName({
    fs,
    folder,
    name,
    place: (path) => fs.writeBinaryFile({ path, bytes, offset: 0 }),
  });
}

/**
 * Puts an image into `folder` — made if it is not there — under `name`,
 * numbered clear of every file already in it, by `place`, which must refuse
 * rather than overwrite: writing the bytes, or moving a finished upload in
 * from where it was staged. A name taken in between is numbered past and
 * tried again.
 */
export async function placeImageUnderFreeName(args: {
  fs: Pick<VaultFsPort, 'listDirectory' | 'createFolder'>;
  folder: VaultPath;
  name: string;
  place: (path: VaultPath) => Promise<unknown>;
}): Promise<VaultPath> {
  try {
    return await placeUnderFreeName(args);
  } catch (error) {
    if (!(error instanceof FileNotPlacedError)) throw error;
    throw new ImageEmbedError(
      error.folderMade
        ? `The image could not be saved: ${error.reason}`
        : `The folder “${args.folder}” could not be made: ${error.reason}`,
    );
  }
}
