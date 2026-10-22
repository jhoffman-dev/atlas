import { noteFileName } from '../vault/new-note.ts';
import { createVaultPath, joinVaultPath, type VaultPath } from '../vault/vault-path.ts';
import { SOURCE_KINDS, type SourceKind } from './anchor.ts';

/*
 * A literature note (ADR-0043): the one note for one PDF, EPUB or Kindle book,
 * holding its highlights. Its frontmatter says what it is a note of; the
 * file itself sits beside it in the vault and DFAI never writes into it.
 *
 *     ---
 *     type: literature
 *     kind: pdf
 *     title: "The Art of War"
 *     author: "Sun Tzu"
 *     file: "[[Library/The Art of War.pdf]]"
 *     ---
 *
 * A Kindle book has no file in the vault, so it has no `file`.
 */

/** The `type:` a literature note declares. */
export const LITERATURE_NOTE_TYPE = 'literature';

/** Where literature notes and their files live when the type file names no `folder:` (ADR-0038). */
export const LIBRARY_HOME = 'Library';

/** What a literature note says about its source. */
export interface LiteratureNote {
  readonly kind: SourceKind;
  readonly title: string;
  readonly author: string | null;
  /** The source's file in the vault; null for a Kindle book, which has none. */
  readonly file: VaultPath | null;
}

/** Whether a note's frontmatter, as the markdown port read it, makes it a literature note. */
export function isLiteratureNote(frontmatter: Readonly<Record<string, unknown>>): boolean {
  const type = frontmatter.type;
  return typeof type === 'string' && type.trim().toLowerCase() === LITERATURE_NOTE_TYPE;
}

/**
 * What a literature note says, or null when it is not one. A kind this build
 * does not know, or no title, is not a source it can open: null too.
 */
export function readLiteratureNote(
  frontmatter: Readonly<Record<string, unknown>>,
): LiteratureNote | null {
  if (!isLiteratureNote(frontmatter)) return null;
  const kind = SOURCE_KINDS.find((known) => known === frontmatter.kind);
  const title = textOf(frontmatter.title);
  if (kind === undefined || title === null) return null;
  return { kind, title, author: textOf(frontmatter.author), file: fileOf(frontmatter.file) };
}

/** A new literature note's text: its frontmatter, and an empty body for highlights to follow. */
export function literatureNoteText(source: LiteratureNote): string {
  const lines = [
    '---',
    `type: ${LITERATURE_NOTE_TYPE}`,
    `kind: ${source.kind}`,
    `title: ${JSON.stringify(source.title)}`,
    ...(source.author === null ? [] : [`author: ${JSON.stringify(source.author)}`]),
    ...(source.file === null ? [] : [`file: ${JSON.stringify(`[[${source.file}]]`)}`]),
    '---',
    '',
  ];
  return lines.join('\n');
}

/** Where a new literature note named `title` goes in a folder (`LIBRARY_HOME` by default). */
export function literatureNotePath(
  title: string,
  folder: VaultPath = createVaultPath(LIBRARY_HOME),
) {
  return joinVaultPath(folder, noteFileName(title));
}

function textOf(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/** The file a `file:` property names: a wiki link `[[path]]` (alias and heading aside) or a bare path. */
function fileOf(value: unknown): VaultPath | null {
  const text = textOf(value);
  if (text === null) return null;
  const linked = (/^\[\[([^\]|#]*)(?:[#|][^\]]*)?\]\]$/.exec(text)?.[1] ?? text).trim();
  if (linked === '') return null;
  try {
    return createVaultPath(linked);
  } catch {
    // A `file:` that is no path in the vault names no file to open; the note is still a source.
    return null;
  }
}
