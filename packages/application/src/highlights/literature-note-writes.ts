import {
  appendHighlights,
  isLiteratureNote,
  noteLabelForNotice,
  splitFrontmatter,
  withHighlightComment,
  withoutHighlight,
  type AppendedHighlight,
  type NewHighlight,
  type VaultPath,
} from '@dfai/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import type { Rng } from '../ports.ts';
import type { OpenEditorsPort, VaultFsPort } from '../vault/ports.ts';
import { UnsavedTypingError } from '../vault/update-links.ts';

/*
 * The writes a reader, a sync or the research views make to a literature note
 * (#503, ADR-0043): add highlights, change one's comment, remove one. Each
 * reads the note, changes only the highlight's own bytes (the domain's
 * rule), and writes it back against the version just read, so a change
 * made meanwhile — in Obsidian, by sync — is refused rather than lost.
 * A pane holding unsaved typing in the note is never written behind: the
 * write is refused (`UnsavedTypingError`), as linking a block is.
 */

/** What a write to a literature note needs. */
export interface LiteratureNoteWritePorts {
  readonly fs: Pick<VaultFsPort, 'readTextFile' | 'writeTextFile'>;
  readonly markdown: Pick<MarkdownPort, 'frontmatterProperties' | 'noteBlocks'>;
  readonly openNotes: Pick<OpenEditorsPort, 'state'> & {
    /** Re-reads the note in every pane that holds it and has no unsaved edits. */
    reload(path: VaultPath): void;
  };
}

/** A note that does not say `type: literature`: its quotes are not highlights, and none is added. */
export class NotALiteratureNoteError extends Error {
  constructor(readonly path: VaultPath) {
    super(`${noteLabelForNotice(path)} is not a literature note, so it holds no highlights.`);
    this.name = 'NotALiteratureNoteError';
  }
}

/**
 * Adds highlights to the end of the literature note at `path`, each with a new
 * id drawn from `rng`, and answers each one's id in the order given. A
 * passage the note already holds is not added again (`added: false`), so a
 * sync can hand over everything it has each time. Writes nothing when every
 * one was there, and nothing when the note holds a marker this build cannot
 * read (`UnreadableHighlightMarkerError`) or would hide the new highlight
 * (`HighlightNotReadBackError`: an unclosed code fence, HTML block or comment).
 */
export async function addHighlights(
  ports: LiteratureNoteWritePorts & { readonly rng: Rng },
  { path, highlights }: { path: VaultPath; highlights: readonly NewHighlight[] },
): Promise<AppendedHighlight[]> {
  let answered: AppendedHighlight[] = [];
  const change = (text: string) => {
    const appended = appendHighlights({
      text,
      highlights,
      random: () => ports.rng.next(),
      noteBlocks: (note) => ports.markdown.noteBlocks(note),
    });
    answered = appended.highlights;
    return appended.text;
  };
  await changeLiteratureNote(ports, { path, change });
  return answered;
}

/** Adds one highlight to the literature note at `path`; see `addHighlights`. */
export async function addHighlight(
  ports: LiteratureNoteWritePorts & { readonly rng: Rng },
  { path, highlight }: { path: VaultPath; highlight: NewHighlight },
): Promise<AppendedHighlight> {
  const [answered] = await addHighlights(ports, { path, highlights: [highlight] });
  return answered as AppendedHighlight;
}

/**
 * Makes the comment of highlight `id` in the note at `path` say `comment`;
 * a blank one takes the comment off. With `base`, the comment the writer
 * started from, a comment that is not that one any more is never overwritten:
 * throws `HighlightCommentChangedError` (#534). Throws `HighlightNotFoundError`
 * when the note no longer holds it, and `HighlightNotReadBackError`, writing
 * nothing, when the note would then hide another highlight.
 */
export async function editHighlightComment(
  ports: LiteratureNoteWritePorts,
  { path, id, comment, base }: { path: VaultPath; id: string; comment: string; base?: string },
): Promise<void> {
  const change = (text: string) =>
    withHighlightComment({
      text,
      id,
      comment,
      ...(base !== undefined && { base }),
      noteBlocks: (note) => ports.markdown.noteBlocks(note),
    });
  await changeLiteratureNote(ports, { path, change });
}

/**
 * Removes highlight `id` from the note at `path`: its quote, comment and
 * place. Only ever on the person's command. Throws `HighlightNotFoundError`
 * when the note no longer holds it, and `HighlightNotReadBackError`, writing
 * nothing, when the note would then hide another highlight.
 */
export async function removeHighlight(
  ports: LiteratureNoteWritePorts,
  { path, id }: { path: VaultPath; id: string },
): Promise<void> {
  const change = (text: string) =>
    withoutHighlight({ text, id, noteBlocks: (note) => ports.markdown.noteBlocks(note) });
  await changeLiteratureNote(ports, { path, change });
}

/**
 * Changes the literature note at `path` by `change`, a pure rewrite of its
 * whole text (a composition of the domain's highlight writes, as Kindle sync's
 * is), written in one write against the version just read: all of it or
 * none. Throws `UnsavedTypingError` while a pane holds unsaved typing in the
 * note, `NotALiteratureNoteError` for a note that is not one, and what
 * `change` throws, writing nothing. Writes nothing when the text is the same.
 */
export async function changeLiteratureNote(
  ports: LiteratureNoteWritePorts,
  { path, change }: { path: VaultPath; change: (text: string) => string },
): Promise<void> {
  const { fs, markdown, openNotes } = ports;
  if (openNotes.state(path) === 'dirty') throw new UnsavedTypingError(path);
  const file = await fs.readTextFile(path);
  const frontmatter = markdown.frontmatterProperties(splitFrontmatter(file.text).frontmatter);
  if (!isLiteratureNote(frontmatter)) throw new NotALiteratureNoteError(path);
  const contents = change(file.text);
  if (contents === file.text) return;
  // Typing may have begun in a pane while the note was read.
  if (openNotes.state(path) === 'dirty') throw new UnsavedTypingError(path);
  await fs.writeTextFile({
    path,
    contents,
    expectedModified: file.modified,
    expectedText: file.text,
  });
  if (openNotes.state(path) === 'clean') openNotes.reload(path);
}
