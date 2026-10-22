import type { HighlightAnchor, SourceKind } from '../highlights/anchor.ts';
import type { HighlightBlock } from '../highlights/highlight-block.ts';
import type { LiteratureNote } from '../highlights/literature-note.ts';
import type { PillHue } from '../page/pill-colour.ts';
import { createVaultPath, InvalidVaultPathError, type VaultPath } from '../vault/vault-path.ts';
import { isPdfName } from './pdf-library.ts';

/*
 * Where a highlight opens when it is followed (#506, ADR-0043): a transcluded
 * highlight, a link to one, or a highlight in its own literature note. A
 * source DFAI can read in the app opens in its reader at the highlight; any
 * other — a Kindle book (DRM), an EPUB until its reader is built (#505), a
 * block that is not a highlight — opens its note at the block, as any block
 * link does.
 */

/** The kinds of source with a reader in the app. #505 adds `epub`. */
export const READER_KINDS: readonly SourceKind[] = ['pdf'];

/** What following a block of a note opens. */
export type HighlightOpening =
  /** The source's reader, brought to the highlight `highlightId`. */
  | {
      readonly kind: 'reader';
      readonly source: SourceKind;
      readonly document: VaultPath;
      readonly highlightId: string;
    }
  /** The note, at block `blockId`. */
  | { readonly kind: 'note'; readonly note: VaultPath; readonly blockId: string };

/** What a literature note says, and the highlights it holds, for the rules that follow one. */
export interface LiteratureNoteRead {
  readonly source: LiteratureNote;
  readonly highlightIds: readonly string[];
}

/**
 * Where following block `blockId` of `note` leads. `literature` is null for a
 * note that is not a literature note; `readers` is which kinds of source the
 * app can open, `READER_KINDS` unless a test says otherwise.
 */
export function highlightOpening({
  note,
  blockId,
  literature,
  readers = READER_KINDS,
}: {
  note: VaultPath;
  blockId: string;
  literature: LiteratureNoteRead | null;
  readers?: readonly SourceKind[];
}): HighlightOpening {
  const inNote: HighlightOpening = { kind: 'note', note, blockId };
  if (literature === null || !literature.highlightIds.includes(blockId)) return inNote;
  const { kind, file } = literature.source;
  if (file === null || !readers.includes(kind)) return inNote;
  return { kind: 'reader', source: kind, document: file, highlightId: blockId };
}

const READER_NAMES: Readonly<Record<SourceKind, string>> = {
  pdf: 'PDF',
  epub: 'EPUB',
  kindle: 'Kindle',
};

/**
 * What a highlight in its own literature note offers to open it with —
 * "Open in PDF" — or null where it has no reader in the app, so stays where
 * it is.
 */
export function readerLinkLabel(
  source: LiteratureNote | null,
  readers: readonly SourceKind[] = READER_KINDS,
): string | null {
  if (source === null || source.file === null || !readers.includes(source.kind)) return null;
  return `Open in ${READER_NAMES[source.kind]}`;
}

/** The muted pastel a source's kind is drawn in (#413's hues): the same for every chip of a kind. */
export const SOURCE_KIND_HUES: Readonly<Record<SourceKind, PillHue>> = {
  pdf: 'red',
  epub: 'green',
  kindle: 'orange',
};

/** The small chip a transcluded highlight wears: where it is from, and where in it. */
export interface HighlightChip {
  readonly kind: SourceKind;
  readonly hue: PillHue;
  /** The source's title, as its literature note gives it. */
  readonly title: string;
  /** `p. 3`, `loc. 1234`; null where the source has no page or location to name (an EPUB's CFI). */
  readonly place: string | null;
  /** Whether following it opens the source's reader (`highlightOpening`), rather than its note. */
  readonly opensInReader: boolean;
}

/** The chip of highlight `highlight`, from the literature note `source`. */
export function highlightChip(
  source: LiteratureNote,
  highlight: HighlightBlock,
  readers: readonly SourceKind[] = READER_KINDS,
): HighlightChip {
  return {
    kind: source.kind,
    hue: SOURCE_KIND_HUES[source.kind],
    title: source.title,
    place: placeLabel(highlight.anchor),
    opensInReader: readerLinkLabel(source, readers) !== null,
  };
}

/** Where in its source a highlight is, as a reader names it: a page, or a Kindle location. */
export function placeLabel(anchor: HighlightAnchor): string | null {
  if (anchor.kind === 'pdf') return `p. ${anchor.page}`;
  if (anchor.kind === 'epub') return null;
  if (anchor.location !== null) return `loc. ${anchor.location.start}`;
  return anchor.page === undefined ? null : `p. ${anchor.page}`;
}

/**
 * The PDF a wiki link `[[…pdf]]` names (#506), or null when it names no PDF.
 * A link names a file by its vault path, or by its name alone, as Obsidian
 * links do: `known` are the PDFs the vault is known to hold. A path one of
 * them has is that one; a name only one of them has is that one; otherwise
 * the link is read as the path it writes, which opens the file there if it
 * is there.
 */
export function pdfLinkTarget(target: string, known: readonly VaultPath[]): VaultPath | null {
  const written = target.trim().replace(/^\/+/, '');
  if (!isPdfName(written)) return null;
  const lower = written.toLowerCase();
  const exact = known.find((path) => path.toLowerCase() === lower);
  if (exact !== undefined) return exact;
  const named = known.filter((path) => nameOf(path).toLowerCase() === lower);
  const only = named.length === 1 ? named[0] : undefined;
  if (only !== undefined) return only;
  try {
    return createVaultPath(written);
  } catch (error) {
    // A link that is no vault path at all (`..`, say) names no file: no PDF to open.
    if (error instanceof InvalidVaultPathError) return null;
    throw error;
  }
}

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
