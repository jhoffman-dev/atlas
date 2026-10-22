import type { HighlightAnchor, SourceKind } from '../highlights/anchor.ts';
import type { HighlightBlock } from '../highlights/highlight-block.ts';
import type { LiteratureNote } from '../highlights/literature-note.ts';
import type { PillHue } from '../page/pill-colour.ts';
import type { VaultPath } from '../vault/vault-path.ts';
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
  if (file === null || !opensInReader(literature.source, readers)) return inNote;
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
  if (source === null || !opensInReader(source, readers)) return null;
  return `Open in ${READER_NAMES[source.kind]}`;
}

/**
 * Whether the app can show `source`'s file in a reader: it names a file, its
 * kind has a reader, and the file is one that reader opens. `file:` is
 * hand-editable, so a note saying `kind: pdf` may name a Markdown note.
 */
function opensInReader(source: LiteratureNote, readers: readonly SourceKind[]): boolean {
  if (source.file === null || !readers.includes(source.kind)) return false;
  return source.kind !== 'pdf' || isPdfName(source.file);
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

/** Whether a wiki link's target writes a PDF's name — it ends `.pdf` — whether or not the vault has one. */
export const namesPdf = (target: string): boolean => isPdfName(target);

/**
 * The PDF a wiki link `[[…pdf]]` names among `files`, the PDFs the vault
 * holds, or null when none matches (or the link names no PDF). As in
 * Obsidian, a link writes the end of a path: its name alone, or the folders
 * above it that tell two apart. Where several files match, one is chosen
 * the same way every time: the exact path, else the shortest path, else the
 * first alphabetically. A link never names a file that is not in `files`.
 */
export function pdfLinkTarget(target: string, files: readonly VaultPath[]): VaultPath | null {
  const written = target.trim().replace(/^\/+/, '').toLowerCase();
  if (!isPdfName(written)) return null;
  const matching = [...new Set(files)].filter((path) => endsWithPath(path.toLowerCase(), written));
  matching.sort(
    (a, b) =>
      Number(b.toLowerCase() === written) - Number(a.toLowerCase() === written) ||
      a.length - b.length ||
      (a < b ? -1 : a > b ? 1 : 0),
  );
  return matching[0] ?? null;
}

/** Whether `path` is `written`, or ends with it at a folder boundary. */
const endsWithPath = (path: string, written: string): boolean =>
  path === written || path.endsWith(`/${written}`);
