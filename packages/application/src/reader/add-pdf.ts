import {
  checkIncomingPdf,
  joinVaultPath,
  libraryFileName,
  literatureDetails,
  literatureNoteText,
  looksLikePdf,
  noteFileName,
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
    'listDirectory' | 'createFolder' | 'createNote' | 'writeBinaryFile'
  >;
  readonly reader: PdfReaderPort;
}

/**
 * Copies `pdf` into `folder` and makes its literature note there. Refused,
 * with nothing written, for a file that is not a PDF, is empty or too large,
 * or cannot be read (`PdfNotAddedError`). The copy is written first: when
 * the note then cannot be made the copy stays, and the error says where.
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
  let document;
  try {
    document = await reader.open(bytes);
  } catch (error) {
    const reason = error instanceof PdfUnreadableError ? error.reason : messageOf(error);
    throw new PdfNotAddedError(`“${name}” could not be read as a PDF: ${reason}`);
  }
  try {
    return await document.metadata();
  } finally {
    await document.close();
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
    const note = joinVaultPath(folder, numberedFileName({ name: noteFileName(title), taken }));
    await fs.createNote({ path: note, contents });
    return note;
  } catch (error) {
    throw new PdfNotAddedError(
      `The PDF was saved as ${file}, but its note could not be made: ${messageOf(error)}`,
    );
  }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
