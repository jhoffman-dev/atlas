import {
  checkIncomingPdf,
  joinVaultPath,
  libraryFileName,
  literatureDetails,
  literatureNoteFileName,
  literatureNoteText,
  looksLikePdf,
  numberedFileName,
  type IncomingPdf,
  type PdfMetadata,
  type VaultPath,
} from '@dfai/domain';
import { placeUnderFreeName } from '../vault/place-under-free-name.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { PdfUnreadableError, type PdfReaderPort } from './ports.ts';

/*
 * Adding a PDF to the library (#504, ADR-0043 §1): a copy of the file goes
 * into the library folder under a name its note can link, and a literature
 * note is made beside it, titled from the PDF's own metadata. The original
 * is only read, never moved or changed; the copy is never written into
 * again, so it stays byte for byte what was added.
 */

/** Why a PDF was not added, in words to show the person. */
export class PdfNotAddedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfNotAddedError';
  }
}

/** A PDF picked or dropped: its name and size, and a way to read its bytes. */
export interface PickedPdf extends IncomingPdf {
  /** Read only once the name and size have passed, so a file far too large is refused unread. */
  readonly bytes: () => Promise<Uint8Array>;
}

/** What adding a PDF made: the copy in the vault and its literature note. */
export interface AddedPdf {
  readonly file: VaultPath;
  readonly note: VaultPath;
  readonly title: string;
}

export interface AddPdfPorts {
  readonly fs: Pick<
    VaultFsPort,
    'listDirectory' | 'createFolder' | 'createNote' | 'writeBinaryFile' | 'trashEntry'
  >;
  readonly reader: PdfReaderPort;
}

/**
 * Copies `pdf` into `folder` and makes its literature note there. Refused,
 * with nothing written, for a file that is not a PDF, is empty or too large,
 * or cannot be read (`PdfNotAddedError`). The copy is written first, and when
 * the note then cannot be made the copy is put in the Trash again — a retry
 * would otherwise find it and number a second copy beside it — and the error
 * says so; when even that fails, it says where the copy stayed.
 */
export async function addPdfToLibrary(
  ports: AddPdfPorts,
  { pdf, folder }: { pdf: PickedPdf; folder: VaultPath },
): Promise<AddedPdf> {
  const check = checkIncomingPdf(pdf);
  if (check.kind === 'refused') throw new PdfNotAddedError(check.message);
  const bytes = await pdf.bytes();
  if (!looksLikePdf(bytes)) throw new PdfNotAddedError(`“${pdf.name}” is not a PDF.`);
  const metadata = await readMetadata(ports.reader, { bytes, name: pdf.name });
  const file = await placeUnderFreeName({
    fs: ports.fs,
    folder,
    name: libraryFileName(pdf.name),
    place: (path) => ports.fs.writeBinaryFile({ path, bytes, offset: 0 }),
  }).catch((error: unknown) => {
    throw new PdfNotAddedError(
      `“${pdf.name}” could not be saved in ${folder}: ${messageOf(error)}`,
    );
  });
  const { title, author } = literatureDetails({ metadata, file });
  const note = await createLiteratureNote(ports.fs, { folder, title, author, file });
  return { file, note, title };
}

async function readMetadata(
  reader: PdfReaderPort,
  { bytes, name }: { bytes: Uint8Array; name: string },
): Promise<PdfMetadata> {
  let opened;
  try {
    opened = await reader.open(bytes);
  } catch (error) {
    const reason = error instanceof PdfUnreadableError ? error.reason : messageOf(error);
    throw new PdfNotAddedError(`“${name}” could not be read as a PDF: ${reason}`);
  }
  try {
    return await opened.metadata();
  } catch {
    // A PDF can be readable and its document information not: the note is then titled by the file's name.
    return { title: null, author: null };
  } finally {
    await opened.close();
  }
}

/** Makes the note under a name numbered clear of the folder's, as a second copy of one book needs. */
async function createLiteratureNote(
  fs: AddPdfPorts['fs'],
  {
    folder,
    title,
    author,
    file,
  }: { folder: VaultPath; title: string; author: string | null; file: VaultPath },
): Promise<VaultPath> {
  const contents = literatureNoteText({ kind: 'pdf', title, author, file });
  try {
    const taken = (await fs.listDirectory(folder)).map((entry) => entry.name);
    const note = joinVaultPath(
      folder,
      numberedFileName({ name: literatureNoteFileName(title), taken }),
    );
    await fs.createNote({ path: note, contents });
    return note;
  } catch (error) {
    throw new PdfNotAddedError(await withoutCopy(fs, file, error));
  }
}

/** Puts the copy the note failed to follow in the Trash, and says what is left of it. */
async function withoutCopy(
  fs: AddPdfPorts['fs'],
  file: VaultPath,
  cause: unknown,
): Promise<string> {
  const failure = `The note for the PDF could not be made: ${messageOf(cause)}`;
  try {
    await fs.trashEntry({ path: file });
    return `${failure} Nothing was added.`;
  } catch (trashing) {
    return `${failure} The PDF was saved as ${file} and could not be removed: ${messageOf(trashing)}`;
  }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
