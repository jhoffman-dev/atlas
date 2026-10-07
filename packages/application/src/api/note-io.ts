import { noteTitle, pageTitle, splitFrontmatter, type VaultPath } from '@atlas/domain';
import { NoteChangedError } from '../notes/note-changed-error.ts';
import { NoteStillOpeningError } from '../notes/note-still-opening-error.ts';
import { noteModified } from '../notes/note-modified.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { noteTypeName } from '../types/load-types.ts';
import { VaultAccessError, type NoteContents } from '../vault/ports.ts';
import { ApiError } from './api-error.ts';
import type { ApiNote, ApiNoteSummary } from './contract.ts';
import { isApiNotePath, notePathFromUrl } from './paths.ts';
import { spelledAsVault } from './vault-spelling.ts';
import type { VaultRequest } from './vault-request.ts';

/** A note as the API hands it out, from its text as read. */
export function toApiNote({
  markdown,
  path,
  contents,
}: {
  markdown: MarkdownPort;
  path: VaultPath;
  contents: NoteContents;
}): ApiNote {
  const { frontmatter, body } = splitFrontmatter(contents.text);
  const properties = markdown.frontmatterProperties(frontmatter);
  return {
    path,
    title: pageTitle({ fileTitle: noteTitle(path), properties }).text,
    type: noteTypeName(properties),
    modified: contents.modified,
    properties,
    body,
  };
}

/**
 * The note the URL names, spelled as the vault spells it (R15-01).
 *
 * The disk may find a note however its path is cased or normalized, but the
 * panes, the index and every answer know it by one spelling. Resolved before
 * anything asks a pane about it, so a write can never slip behind the pane
 * holding the note. A path no note matches is left as asked, to be refused.
 */
export async function notePathOf(request: VaultRequest): Promise<VaultPath> {
  const asked = notePathFromUrl(request.pathParam);
  return spelledAsVault({ fs: request.fs, asked, accepts: isApiNotePath });
}

/**
 * Reads a note, refusing with `not_found` when there is none to read.
 *
 * A read names no vault — the host reads from whichever is open — so it is
 * checked against the request's vault once it has answered: after a switch,
 * what came back (or did not) is another vault's, and the answer is
 * `no_vault` rather than that note or a 404.
 */
export async function readNote(request: VaultRequest, path: VaultPath): Promise<NoteContents> {
  let contents: NoteContents;
  try {
    contents = await request.fs.readTextFile(path);
  } catch (error) {
    request.assertStillOpen();
    if (error instanceof VaultAccessError) throw new ApiError('not_found', `No note at ${path}`);
    throw error;
  }
  request.assertStillOpen();
  return contents;
}

/** Reads a note back after a write and answers with it. */
export async function answerWithNote(
  request: VaultRequest,
  { path, status = 200 }: { path: VaultPath; status?: number },
): Promise<{ status: number; body: { note: ApiNote } }> {
  const contents = await readNote(request, path);
  return { status, body: { note: toApiNote({ markdown: request.markdown, path, contents }) } };
}

/** Summaries for these notes, in this order, leaving out any that have gone. */
export async function summariesOf(
  request: VaultRequest,
  paths: readonly VaultPath[],
): Promise<ApiNoteSummary[]> {
  if (paths.length === 0) return [];
  const files = new Map((await request.fs.readNotes(paths)).map((file) => [file.path, file]));
  return paths.flatMap((path) => {
    const file = files.get(path);
    if (file === undefined) return [];
    const { title, type, modified } = toApiNote({
      markdown: request.markdown,
      path,
      contents: file,
    });
    return [{ path, title, type, modified }];
  });
}

/** Refuses with `conflict` when the caller read the note at another time than it has now. */
export function checkIfModified(path: VaultPath, modified: number, ifModified?: number): void {
  if (ifModified !== undefined && ifModified !== modified) throw changed(path);
}

/**
 * Runs a write that was checked against the note at `expected`, and explains a
 * refusal: the vault was switched, the note changed after all, the pane
 * holding it has not finished opening it, or none of these — in which case the
 * error is ours and goes on as it is.
 */
export async function guardedWrite<T>(
  request: VaultRequest,
  { path, expected }: { path: VaultPath; expected: number },
  write: () => Promise<T>,
): Promise<T> {
  request.assertStillOpen();
  try {
    return await write();
  } catch (error) {
    if (error instanceof NoteChangedError) throw changed(path);
    if (error instanceof NoteStillOpeningError) {
      throw new ApiError(
        'conflict',
        `${path} is still opening in Atlas; nothing was written, and retrying is safe`,
      );
    }
    request.assertStillOpen();
    if ((await noteModified({ fs: request.fs, path })) !== expected) throw changed(path);
    throw error;
  }
}

function changed(path: VaultPath): ApiError {
  return new ApiError('conflict', `${path} changed since you read it`);
}
