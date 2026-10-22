import {
  highlightOpening,
  isPdfName,
  namesPdf,
  VAULT_ROOT,
  VAULT_WALK_DEPTH,
  pdfLinkTarget,
  readerLinkLabel,
  readHighlights,
  readLiteratureNote,
  type HighlightOpening,
  type VaultPath,
} from '@dfai/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { listVaultDirectory } from '../vault/read-vault.ts';
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

/** What finding the PDF a wiki link names needs: the vault's files. */
export interface LinkedPdfPorts {
  readonly fs: Pick<VaultFsPort, 'listDirectory'>;
}

/**
 * The PDF a wiki link `[[…pdf]]` names among the files the vault holds, or
 * null when the vault has none so called or the link is to anything else
 * (`pdfLinkTarget`). The vault is read for its files, not the literature
 * notes' `file:` lines, so a PDF with no literature note is found; a read
 * that fails is the caller's to say.
 */
export async function linkedPdf(ports: LinkedPdfPorts, target: string): Promise<VaultPath | null> {
  if (!namesPdf(target)) return null;
  return pdfLinkTarget(target, await listVaultPdfs(ports));
}

/** Every PDF in user space, walked folder by folder as the sidebar sees them (`listVaultDirectory`). */
async function listVaultPdfs({ fs }: LinkedPdfPorts): Promise<VaultPath[]> {
  const found: VaultPath[] = [];
  let level: VaultPath[] = [VAULT_ROOT];
  for (let depth = 0; level.length > 0 && depth <= VAULT_WALK_DEPTH; depth += 1) {
    const listed = await Promise.all(level.map((path) => listVaultDirectory({ fs, path })));
    level = [];
    for (const entry of listed.flat()) {
      if (entry.kind === 'directory') level.push(entry.path);
      else if (isPdfName(entry.name)) found.push(entry.path);
    }
  }
  return found;
}
