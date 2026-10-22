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
 * A Kindle book has no file in the vault, so it has no `file`; it may have
 * the `asin` Amazon knows it by, which is how a Kindle sync finds its note
 * (by title and author when the note has none).
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
  /** Amazon's id for a Kindle book; absent or null when the note has none. */
  readonly asin?: string | null;
}

/**
 * The file's name holds a character a wiki link means something by (`#`
 * heading, `^` block, `|` alias, `[` `]` the link itself), so the `file:`
 * link would read back as another file.
 */
export class UnsafeSourceFileError extends Error {
  constructor(readonly file: string) {
    super(
      `The file ${file} cannot be linked from a note: its name holds one of # ^ | [ ]. ` +
        'Name it with safeSourceFileName first.',
    );
    this.name = 'UnsafeSourceFileError';
  }
}

const LINK_CHARACTERS = /[#^|[\]]/;

/**
 * `fileName` with each character a wiki link means something by (`#`, `^`,
 * `|`, `[`, `]`) made a hyphen: the name a source file is saved under so its
 * note can link it. The importer (#504) names files with this.
 */
export const safeSourceFileName = (fileName: string): string =>
  fileName.replace(new RegExp(LINK_CHARACTERS.source, 'g'), '-');

/**
 * Whether a note's frontmatter, as the markdown port read it, makes it a
 * literature note: a `type` of `literature`, or a `type` list holding it
 * (`[literature, book]`), as the index's own type check reads both.
 */
export function isLiteratureNote(frontmatter: Readonly<Record<string, unknown>>): boolean {
  const type = frontmatter.type;
  const types: readonly unknown[] = Array.isArray(type) ? type : [type];
  return types.some(
    (each) => typeof each === 'string' && each.trim().toLowerCase() === LITERATURE_NOTE_TYPE,
  );
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
  return {
    kind,
    title,
    author: textOf(frontmatter.author),
    file: literatureFileOf(frontmatter.file),
    asin: textOf(frontmatter.asin),
  };
}

/**
 * A new literature note's text: its frontmatter, and an empty body for highlights
 * to follow. Throws `UnsafeSourceFileError` for a `file` a link could not name.
 */
export function literatureNoteText(source: LiteratureNote): string {
  if (source.file !== null && LINK_CHARACTERS.test(source.file)) {
    throw new UnsafeSourceFileError(source.file);
  }
  const lines = [
    '---',
    `type: ${LITERATURE_NOTE_TYPE}`,
    `kind: ${source.kind}`,
    `title: ${JSON.stringify(source.title)}`,
    ...(source.author === null ? [] : [`author: ${JSON.stringify(source.author)}`]),
    ...(textOf(source.asin) === null ? [] : [`asin: ${JSON.stringify(textOf(source.asin))}`]),
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

/**
 * The file a `file:` property names: a wiki link `[[path]]` (alias and
 * heading aside) or a bare path; null when it names none.
 */
export function literatureFileOf(value: unknown): VaultPath | null {
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
