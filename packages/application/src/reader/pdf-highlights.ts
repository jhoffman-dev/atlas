import {
  areaHighlight,
  areaImageName,
  imageFolderFor,
  readHighlights,
  readLiteratureNote,
  splitFrontmatter,
  textHighlight,
  type AppendedHighlight,
  type HighlightBlock,
  type HighlightStyle,
  type ImagePlacement,
  type LiteratureNote,
  type PageRect,
  type PdfPageText,
  type TextSelection,
  type VaultPath,
} from '@dfai/domain';
import {
  addHighlight,
  type LiteratureNoteWritePorts,
} from '../highlights/literature-note-writes.ts';
import { writeImageUnderFreeName } from '../notes/embed-image.ts';
import type { Rng } from '../ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { UnsavedTypingError } from '../vault/update-links.ts';

/*
 * What the reader writes into a PDF's literature note (#504): a highlight of
 * words picked on a page, or of a box dragged on a page with no words, whose
 * picture is saved beside the vault's images first so the note can show it.
 */

/** Words picked on a page could not be made a highlight: only space, or nothing the page can draw. */
export class NothingToHighlightError extends Error {
  constructor() {
    super('Nothing was selected to highlight: pick some words on the page.');
    this.name = 'NothingToHighlightError';
  }
}

type WritePorts = LiteratureNoteWritePorts & { readonly rng: Rng };

/** Adds a highlight of the words `selection` picks on `page` to the note, and answers its id. */
export async function highlightSelection(
  ports: WritePorts,
  {
    note,
    selection,
    page,
    style,
    comment,
  }: {
    note: VaultPath;
    selection: TextSelection;
    page: PdfPageText;
    style: HighlightStyle;
    comment?: string;
  },
): Promise<AppendedHighlight> {
  const highlight = textHighlight({
    selection,
    page,
    style,
    ...(comment !== undefined && { comment }),
  });
  if (highlight === null) throw new NothingToHighlightError();
  return addHighlight(ports, { path: note, highlight });
}

/**
 * Saves the picture of `box` on page `page` of `pdf`, then adds an area
 * highlight showing it to the note. `picture` draws the box as a PNG, and is
 * asked only when the note is free to be written (no unsaved typing in it).
 * The picture is made for the highlight alone: when the note then refuses
 * it, or already holds that area, the picture is put in the Trash again — it
 * is DFAI's own file, made a moment ago, and nothing links it.
 */
export async function highlightArea(
  ports: WritePorts & {
    readonly fs: Pick<
      VaultFsPort,
      'listDirectory' | 'createFolder' | 'writeBinaryFile' | 'trashEntry'
    >;
  },
  {
    note,
    pdf,
    page,
    box,
    picture,
    placement,
    style,
    comment,
  }: {
    note: VaultPath;
    pdf: VaultPath;
    page: number;
    box: PageRect;
    picture: () => Promise<Uint8Array>;
    placement: ImagePlacement;
    style: HighlightStyle;
    comment?: string;
  },
): Promise<AppendedHighlight> {
  if (ports.openNotes.state(note) === 'dirty') throw new UnsavedTypingError(note);
  const image = await writeImageUnderFreeName({
    fs: ports.fs,
    folder: imageFolderFor({ notePath: note, placement }),
    name: areaImageName({ file: pdf, page }),
    bytes: await picture(),
  });
  const highlight = areaHighlight({
    page,
    box,
    image,
    style,
    ...(comment !== undefined && { comment }),
  });
  try {
    const added = await addHighlight(ports, { path: note, highlight });
    if (!added.added) await discardPicture(ports.fs, image);
    return added;
  } catch (error) {
    await discardPicture(ports.fs, image);
    throw error;
  }
}

async function discardPicture(
  fs: Pick<VaultFsPort, 'trashEntry'>,
  image: VaultPath,
): Promise<void> {
  try {
    await fs.trashEntry({ path: image });
  } catch {
    // The refusal that sent us here is the news; a picture left unlinked in the vault costs nothing.
  }
}

/** A literature note as the reader reads it: what it is of, and its highlights. */
export interface ReadLiteratureNote {
  readonly source: LiteratureNote | null;
  readonly highlights: readonly HighlightBlock[];
}

/** Reads the note at `note`: what it says it is a note of, and every highlight it holds. */
export async function readLiteratureNoteAt(
  ports: Pick<LiteratureNoteWritePorts, 'markdown'> & {
    readonly fs: Pick<VaultFsPort, 'readTextFile'>;
  },
  note: VaultPath,
): Promise<ReadLiteratureNote> {
  const { text } = await ports.fs.readTextFile(note);
  const frontmatter = ports.markdown.frontmatterProperties(splitFrontmatter(text).frontmatter);
  const source = readLiteratureNote(frontmatter);
  if (source === null) return { source: null, highlights: [] };
  return { source, highlights: readHighlights(text, (body) => ports.markdown.noteBlocks(body)) };
}
