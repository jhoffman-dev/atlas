import {
  highlightOpening,
  LITERATURE_NOTE_TYPE,
  pdfLinkTarget,
  readerLinkLabel,
  readHighlights,
  readLiteratureNote,
  splitFrontmatter,
  type HighlightOpening,
  type VaultPath,
} from '@dfai/domain';
import type { IndexPort } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { readLiteratureNoteAt } from './pdf-highlights.ts';

/*
 * Following a highlight back to its place (#506): a transcluded highlight, a
 * link to one, the "Open in PDF" of one in its own note, and the library's
 * rows (#507) all ask here where a block of a note opens — the source's
 * reader at the highlight, or the note at the block — and open it there.
 * Which kind opens what is the domain's rule (`highlightOpening`); this reads
 * the note it is asked about.
 */

/** What reading a note's highlights needs. */
export interface HighlightPlacePorts {
  readonly fs: Pick<VaultFsPort, 'readTextFile'>;
  readonly markdown: Pick<MarkdownPort, 'frontmatterProperties' | 'noteBlocks'>;
}

/** Opens what a highlight leads to, where the caller's click asked. */
export interface HighlightPlaceOpener {
  /** The document's reader, brought to the highlight and flashing it. */
  openDocument(args: { readonly path: VaultPath; readonly highlightId: string }): void;
  /** The note, scrolled to the block. */
  openNote(args: { readonly path: VaultPath; readonly blockId: string }): void;
}

/** Where following block `blockId` of `note` leads: the source's reader, or the note at the block. */
export async function whereHighlightOpens(
  ports: HighlightPlacePorts,
  { note, blockId }: { note: VaultPath; blockId: string },
): Promise<HighlightOpening> {
  let read: Awaited<ReturnType<typeof readLiteratureNoteAt>>;
  try {
    read = await readLiteratureNoteAt(ports, note);
  } catch {
    // A note that cannot be read just now is opened anyway: its page says
    // why it cannot be shown, which is more use than a click that does nothing.
    return { kind: 'note', note, blockId };
  }
  const literature =
    read.source === null
      ? null
      : { source: read.source, highlightIds: read.highlights.map((highlight) => highlight.id) };
  return highlightOpening({ note, blockId, literature });
}

/**
 * Opens highlight `highlightId` of literature note `note` where it lives:
 * in its reader for a PDF, at its block in the note for a Kindle book or a
 * source with no reader yet. What the library and all-highlights views
 * (#507) call for a row; resolves to where it opened.
 */
export async function openHighlightPlace(
  ports: HighlightPlacePorts & { readonly opener: HighlightPlaceOpener },
  { note, highlightId }: { note: VaultPath; highlightId: string },
): Promise<HighlightOpening> {
  const opening = await whereHighlightOpens(ports, { note, blockId: highlightId });
  if (opening.kind === 'reader') {
    ports.opener.openDocument({ path: opening.document, highlightId: opening.highlightId });
  } else {
    ports.opener.openNote({ path: opening.note, blockId: opening.blockId });
  }
  return opening;
}

/** The highlights of an open literature note that offer to open in its reader, and in what words. */
export interface ReaderHighlightLinks {
  /** "Open in PDF". */
  readonly label: string;
  readonly ids: ReadonlySet<string>;
}

/**
 * Which highlights of a note, as its file reads, offer to open in a reader
 * ("Open in PDF") — every one of a PDF's literature note — or null for a
 * note whose source has no reader in the app, or that is no literature note.
 */
export function readerHighlightLinks(
  markdown: Pick<MarkdownPort, 'noteBlocks'>,
  note: { readonly properties: Readonly<Record<string, unknown>>; readonly text: string },
): ReaderHighlightLinks | null {
  const label = readerLinkLabel(readLiteratureNote(note.properties));
  if (label === null) return null;
  const highlights = readHighlights(note.text, (text) => markdown.noteBlocks(text));
  return { label, ids: new Set(highlights.map((highlight) => highlight.id)) };
}

/** What finding the PDF a wiki link names needs: the literature notes, which name the vault's PDFs. */
export interface LinkedPdfPorts {
  readonly index: Pick<IndexPort, 'notesOfType'>;
  readonly fs: Pick<VaultFsPort, 'readNotes'>;
  readonly markdown: Pick<MarkdownPort, 'frontmatterProperties'>;
}

/**
 * The PDF a wiki link `[[…pdf]]` names, or null for a link to anything else
 * (`pdfLinkTarget`). A link by name alone is matched against the files the
 * literature notes name; when those cannot be read, the link is taken as
 * the path it writes.
 */
export async function linkedPdf(ports: LinkedPdfPorts, target: string): Promise<VaultPath | null> {
  if (pdfLinkTarget(target, []) === null) return null;
  return pdfLinkTarget(target, await knownPdfs(ports));
}

async function knownPdfs({ index, fs, markdown }: LinkedPdfPorts): Promise<VaultPath[]> {
  try {
    const listed = await index.notesOfType(LITERATURE_NOTE_TYPE);
    const files = await fs.readNotes(listed.map((note) => note.path));
    return files.flatMap((file) => {
      const frontmatter = markdown.frontmatterProperties(splitFrontmatter(file.text).frontmatter);
      const pdf = readLiteratureNote(frontmatter)?.file ?? null;
      return pdf === null ? [] : [pdf];
    });
  } catch {
    // Unknown files only cost the by-name match: the link is still read as its own path.
    return [];
  }
}
