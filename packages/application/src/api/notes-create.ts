import {
  DEFAULT_NOTE_NAME,
  isUnnamed,
  joinFrontmatter,
  joinVaultPath,
  NEW_NOTE_CONTENTS,
  noteFileName,
  parentVaultPath,
  splitFrontmatter,
  VAULT_ROOT,
  type VaultPath,
} from '@atlas/domain';
import { newNoteTaskRules } from '../gtd/task-rules.ts';
import { createNote, NoteNameTakenError } from '../notes/create-note.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { findTemplateNamed, loadTemplates, readTemplate } from '../types/templates.ts';
import { VaultAccessError } from '../vault/ports.ts';
import { listVaultNotes } from '../vault/read-vault.ts';
import { ApiError } from './api-error.ts';
import { bodyObject, optionalRecord, optionalString, type Fields } from './fields.ts';
import { answerWithNote } from './note-io.ts';
import { folderFrom, isApiFolderPath, isApiNotePath } from './paths.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';
import { spelledAsVault } from './vault-spelling.ts';

/**
 * Creates a note, optionally from a template.
 *
 * A name that is asked for is the name it gets, and an existing note there is
 * `exists` — the caller named that note, so numbering it would hand back one it
 * did not ask for. With no name, or one that cleans away to nothing, it is
 * "Untitled", numbered if that is taken in any case — even when it is taken
 * between listing and creating — the way the New note button behaves. The
 * folder is the one the vault has, however the request spelled it (R15-01).
 */
export async function createNoteRoute(request: VaultRequest): Promise<RouteResult> {
  const fields = bodyObject(request.body);
  const folder = await folderOf(request, fields);
  const name = optionalString(fields, 'name');
  const properties = optionalRecord(fields, 'properties');
  const body = optionalString(fields, 'body');
  const template = await templateText(request, optionalString(fields, 'template'));

  const named = name === undefined || isUnnamed(name) ? null : namedPath(folder, name);
  const contents = composeNote({
    markdown: request.markdown,
    start: template ?? NEW_NOTE_CONTENTS,
    properties,
    body,
  });

  const path = await createIn(request, { folder, named, contents });
  return answerWithNote(request, { path, status: 201 });
}

async function folderOf(request: VaultRequest, fields: Fields): Promise<VaultPath> {
  const folder = optionalString(fields, 'folder');
  if (folder === undefined) return VAULT_ROOT;
  const asked = folderFrom(folder, 'folder');
  return asked === VAULT_ROOT
    ? asked
    : spelledAsVault({ fs: request.fs, asked, accepts: isApiFolderPath });
}

/** Creates the note at the named path, or an Untitled one numbered as `createNote` numbers it. */
async function createIn(
  request: VaultRequest,
  {
    folder,
    named,
    contents: asked,
  }: { folder: VaultPath; named: VaultPath | null; contents: string },
): Promise<VaultPath> {
  request.assertStillOpen();
  // Judged before anything is made, as createNote judges it: a refused task makes no file.
  const rules = { markdown: request.markdown, today: request.clock.today() };
  const contents = newNoteTaskRules({ ...rules, contents: asked });
  try {
    if (named === null) {
      const notePaths = await listVaultNotes({ fs: request.fs });
      return await createNumberedNote({
        fs: request.fs,
        ...rules,
        name: DEFAULT_NOTE_NAME,
        beside: null,
        folder,
        notePaths,
        contents,
      });
    }
    await request.fs.createNote({ path: named, contents });
    return named;
  } catch (error) {
    // Checked first: once another vault is open, a note there proves nothing here.
    request.assertStillOpen();
    if (named !== null && (await noteExists(request, named))) throw alreadyThere(named);
    if (!(await folderExists(request, folder))) {
      throw new ApiError('not_found', `The folder ${JSON.stringify(folder)} does not exist`);
    }
    throw error;
  }
}

async function templateText(
  request: VaultRequest,
  name: string | undefined,
): Promise<string | null> {
  if (name === undefined) return null;
  const template = findTemplateNamed(await loadTemplates({ fs: request.fs }), name);
  if (template === null)
    throw new ApiError('not_found', `No template called ${JSON.stringify(name)}`);
  return readTemplate({ fs: request.fs, template });
}

/**
 * `createNote` for a route: a note numbered past every name taken, answered
 * as `conflict` — something to retry — when every name it tried was taken
 * while it was being made.
 */
export async function createNumberedNote(
  args: Parameters<typeof createNote>[0],
): Promise<VaultPath> {
  try {
    return await createNote(args);
  } catch (error) {
    if (error instanceof NoteNameTakenError) throw new ApiError('conflict', error.message);
    throw error;
  }
}

/** The path a note asked for by name is made at: refused when hidden or not a .md note. */
export function namedPath(folder: VaultPath, name: string): VaultPath {
  const path = joinVaultPath(folder, noteFileName(name));
  if (!isApiNotePath(path)) {
    throw new ApiError(
      'invalid',
      `name ${JSON.stringify(name)} would make ${JSON.stringify(path)}, which is hidden or not a .md note`,
    );
  }
  return path;
}

/**
 * Why a create was refused. The host never overwrites, so a note already there
 * is found out by the create itself; this asks the file rather than a listing,
 * so a note differing only in case counts on a filesystem that cannot tell.
 */
async function noteExists(request: VaultRequest, path: VaultPath): Promise<boolean> {
  try {
    await request.fs.readTextFile(path);
    return true;
  } catch {
    // Unreadable is taken as absent: the create that follows fails safely if not.
    return false;
  }
}

/**
 * Whether the folder is there. The host creates a note only in a folder that
 * exists, and says so in words; this asks the folder's parent instead.
 */
async function folderExists(request: VaultRequest, folder: VaultPath): Promise<boolean> {
  if (folder === VAULT_ROOT) return true;
  try {
    const siblings = await request.fs.listDirectory(parentVaultPath(folder));
    return siblings.some((entry) => entry.kind === 'directory' && entry.path === folder);
  } catch (error) {
    // The parent is missing too, so the folder is.
    if (error instanceof VaultAccessError) return false;
    throw error;
  }
}

/** The new note's text: the start, with properties set on top and the body replaced if given. */
function composeNote({
  markdown,
  start,
  properties,
  body,
}: {
  markdown: MarkdownPort;
  start: string;
  properties: Fields | undefined;
  body: string | undefined;
}): string {
  const document = splitFrontmatter(start);
  const frontmatter =
    properties === undefined
      ? document.frontmatter
      : markdown.updateFrontmatter(document.frontmatter, properties);
  return joinFrontmatter(frontmatter, body ?? document.body);
}

function alreadyThere(path: VaultPath): ApiError {
  return new ApiError('exists', `A note already exists at ${path}`);
}
