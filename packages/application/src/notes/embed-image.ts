import {
  checkIncomingImage,
  defaultAltText,
  imageFileName,
  imageFolderFor,
  imageMimeType,
  joinVaultPath,
  numberedFileName,
  parentVaultPath,
  relativeImageSource,
  undrawableImageMessage,
  vaultPathName,
  type ImagePlacement,
  type IncomingImage,
  type VaultPath,
} from '@atlas/domain';
import type { VaultFsPort } from '../vault/ports.ts';

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
 * The image itself was refused — too large, of a kind Atlas does not take, or
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

/** How many names are tried when each one is taken between listing and writing. */
const WRITE_ATTEMPTS = 3;

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
  fs: VaultFsPort;
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
export async function placeImageUnderFreeName({
  fs,
  folder,
  name,
  place,
}: {
  fs: VaultFsPort;
  folder: VaultPath;
  name: string;
  place: (path: VaultPath) => Promise<unknown>;
}): Promise<VaultPath> {
  let taken = await namesIn({ fs, folder });
  for (let attempt = 1; ; attempt += 1) {
    // Picked and reserved in one synchronous step, so another embed awaiting
    // its own listing cannot pick the same name.
    const path = joinVaultPath(
      folder,
      numberedFileName({ name, taken: [...taken, ...namesBeingWritten(folder)] }),
    );
    beingWritten.add(path);
    try {
      await place(path);
      return path;
    } catch (error) {
      const listedAgain = await namesIn({ fs, folder });
      const nameWasTaken =
        joinVaultPath(folder, numberedFileName({ name, taken: listedAgain })) !== path;
      // Refused for some reason other than the name: trying again is pointless.
      if (attempt === WRITE_ATTEMPTS || !nameWasTaken) {
        throw new ImageEmbedError(`The image could not be saved: ${messageOf(error)}`);
      }
      taken = listedAgain;
    } finally {
      beingWritten.delete(path);
    }
  }
}

/**
 * The paths embeds in this window are writing right now. Several images
 * dropped or pasted at once all list the folder before any is written, so
 * without this each picks the same free name and all but one are refused.
 */
const beingWritten = new Set<VaultPath>();

function namesBeingWritten(folder: VaultPath): string[] {
  return [...beingWritten]
    .filter((path) => parentVaultPath(path) === folder)
    .map((path) => vaultPathName(path));
}

/**
 * The names already in `folder`, making the folder when it is not there.
 *
 * Several images dropped at once each find the folder missing and each try
 * to make it; the ones that lose that race find it made and list it instead.
 * Only a folder that still cannot be listed once making it has failed — a
 * file of that name in the way — is a failure.
 */
async function namesIn({ fs, folder }: { fs: VaultFsPort; folder: VaultPath }): Promise<string[]> {
  const listed = await listNames({ fs, folder });
  if (listed !== null) return listed;
  try {
    await fs.createFolder({ path: folder });
    return [];
  } catch (error) {
    const madeMeanwhile = await listNames({ fs, folder });
    if (madeMeanwhile !== null) return madeMeanwhile;
    throw new ImageEmbedError(`The folder “${folder}” could not be made: ${messageOf(error)}`);
  }
}

/** The names in `folder`, or null when it cannot be listed — most often, because it is not there. */
async function listNames({
  fs,
  folder,
}: {
  fs: VaultFsPort;
  folder: VaultPath;
}): Promise<string[] | null> {
  try {
    return (await fs.listDirectory(folder)).map((entry) => entry.name);
  } catch {
    // Not there (yet): the caller makes it, and a real problem surfaces there.
    return null;
  }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
