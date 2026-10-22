import {
  LIBRARY_HOME,
  LITERATURE_NOTE_TYPE,
  safeSourceFileName,
} from '../highlights/literature-note.ts';
import { homeFolderOf } from '../home-folders/home-folder.ts';
import type { ObjectType } from '../types/property-def.ts';
import { cleanEntryName } from '../vault/new-note.ts';
import { createVaultPath, vaultPathName, type VaultPath } from '../vault/vault-path.ts';

/*
 * Adding a PDF to the library (#504, ADR-0043 §1): what the copy in the vault
 * is called, what its literature note says, and which files are taken. The
 * copy's name is the file's own, made safe for the note's `file:` link; the
 * note's title is the PDF's own title when it has a real one, else the name.
 */

/** The most a PDF in the vault may be: what the host writes or reads in one file. */
export const MAX_PDF_BYTES = 32 * 1024 * 1024;

/** What a PDF picked or dropped is, before its bytes are read. */
export interface IncomingPdf {
  readonly name: string;
  readonly size: number;
}

export type PdfCheck =
  { readonly kind: 'accepted' } | { readonly kind: 'refused'; readonly message: string };

/** Whether a file picked or dropped can be added: a PDF by its name, not empty, not past the host's size. */
export function checkIncomingPdf(file: IncomingPdf): PdfCheck {
  const shown = `“${file.name}”`;
  if (!isPdfName(file.name)) return { kind: 'refused', message: `${shown} is not a PDF.` };
  if (file.size === 0) return { kind: 'refused', message: `${shown} is empty.` };
  if (file.size > MAX_PDF_BYTES) {
    const megabytes = (file.size / 1024 / 1024).toFixed(1);
    return {
      kind: 'refused',
      message: `${shown} is ${megabytes} MB. A PDF in the library can be at most ${MAX_PDF_BYTES / 1024 / 1024} MB.`,
    };
  }
  return { kind: 'accepted' };
}

/**
 * Whether `bytes` start as a PDF does. A PDF may have up to a kilobyte of
 * anything before its `%PDF-` header, which every reader allows.
 */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = String.fromCharCode(...bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

/** Whether a name or a path is a PDF's. */
export const isPdfName = (name: string): boolean => /\.pdf$/i.test(name.trim());

/**
 * The name the copy in the vault is saved under: the file's own, cleaned of
 * what no filesystem takes and of what a wiki link means something by, and
 * ending in `.pdf`.
 */
export function libraryFileName(name: string): string {
  const stem = cleanEntryName(safeSourceFileName(name.replace(/\.pdf\s*$/i, '')));
  return `${stem === '' ? 'Untitled' : stem}.pdf`;
}

/** Titles a PDF's metadata gives that name a tool, a template or nothing at all, not the work. */
const PLACEHOLDER_TITLE =
  /^(untitled|title|document|microsoft word - .*|.*\.(docx?|pdf|tex|indd))$/i;

/** What the PDF's own metadata says, as pdf.js reads it. */
export interface PdfMetadata {
  readonly title: string | null;
  readonly author: string | null;
}

/**
 * The literature note's title and author for a PDF saved as `file`: the
 * PDF's own title when it names the work, else the file's name without
 * `.pdf`; its author when it gives one.
 */
export function literatureDetails({ metadata, file }: { metadata: PdfMetadata; file: VaultPath }): {
  title: string;
  author: string | null;
} {
  const title = metadata.title?.trim() ?? '';
  const author = metadata.author?.trim() ?? '';
  return {
    title:
      title !== '' && !PLACEHOLDER_TITLE.test(title)
        ? title
        : vaultPathName(file).replace(/\.pdf$/i, ''),
    author: author === '' ? null : author,
  };
}

/** The name an area's picture is saved under: the PDF's name, its page, and that it is an area. */
export function areaImageName({ file, page }: { file: VaultPath; page: number }): string {
  return `${vaultPathName(file).replace(/\.pdf$/i, '')} p${page} area.png`;
}

/**
 * The folder a PDF and its literature note are added to: the literature
 * type's home (ADR-0038), `Library` unless the vault's type file says
 * otherwise, and `Library` still when it says the type has none.
 */
export function libraryFolder({
  types,
  today,
}: {
  types: readonly Pick<ObjectType, 'name' | 'folder'>[];
  today: string;
}): VaultPath {
  return (
    homeFolderOf({ properties: { type: LITERATURE_NOTE_TYPE }, types, today }) ??
    createVaultPath(LIBRARY_HOME)
  );
}
