import { noteFileName } from '../vault/new-note.ts';
import { createVaultPath, joinVaultPath, type VaultPath } from '../vault/vault-path.ts';
import { SOURCE_KINDS, type SourceKind } from './anchor.ts';

/*
 * A source note (ADR-0043): the one note for one PDF, EPUB or Kindle book,
 * holding its highlights. Its frontmatter says what it is a note of; the
 * file itself sits beside it in the vault and DFAI never writes into it.
 *
 *     ---
 *     type: source
 *     kind: pdf
 *     title: "The Art of War"
 *     author: "Sun Tzu"
 *     file: "[[Sources/The Art of War.pdf]]"
 *     ---
 *
 * A Kindle book has no file in the vault, so it has no `file`.
 */

/** The `type:` a source note declares. */
export const SOURCE_NOTE_TYPE = 'source';

/** Where source notes and their files live when the type file names no `folder:` (ADR-0038). */
export const SOURCES_HOME = 'Sources';

/** What a source note says about its source. */
export interface SourceNote {
  readonly kind: SourceKind;
  readonly title: string;
  readonly author: string | null;
  /** The source's file in the vault; null for a Kindle book, which has none. */
  readonly file: VaultPath | null;
}

/** Whether a note's frontmatter, as the markdown port read it, makes it a source note. */
export function isSourceNote(frontmatter: Readonly<Record<string, unknown>>): boolean {
  const type = frontmatter.type;
  return typeof type === 'string' && type.trim().toLowerCase() === SOURCE_NOTE_TYPE;
}

/**
 * What a source note says, or null when it is not one. A kind this build
 * does not know, or no title, is not a source it can open: null too.
 */
export function readSourceNote(frontmatter: Readonly<Record<string, unknown>>): SourceNote | null {
  if (!isSourceNote(frontmatter)) return null;
  const kind = SOURCE_KINDS.find((known) => known === frontmatter.kind);
  const title = textOf(frontmatter.title);
  if (kind === undefined || title === null) return null;
  return { kind, title, author: textOf(frontmatter.author), file: fileOf(frontmatter.file) };
}

/** A new source note's text: its frontmatter, and an empty body for highlights to follow. */
export function sourceNoteText(source: SourceNote): string {
  const lines = [
    '---',
    `type: ${SOURCE_NOTE_TYPE}`,
    `kind: ${source.kind}`,
    `title: ${JSON.stringify(source.title)}`,
    ...(source.author === null ? [] : [`author: ${JSON.stringify(source.author)}`]),
    ...(source.file === null ? [] : [`file: ${JSON.stringify(`[[${source.file}]]`)}`]),
    '---',
    '',
  ];
  return lines.join('\n');
}

/** Where a new source note named `title` goes in a folder (`SOURCES_HOME` by default). */
export function sourceNotePath(title: string, folder: VaultPath = createVaultPath(SOURCES_HOME)) {
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
