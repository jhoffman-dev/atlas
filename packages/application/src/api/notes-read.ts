import { createVaultPath, VAULT_ROOT, type VaultPath } from '@atlas/domain';
import { listVaultNotes } from '../vault/read-vault.ts';
import { pageAfter } from './cursor.ts';
import { countOf } from './fields.ts';
import { notePathOf, readNote, summariesOf, toApiNote } from './note-io.ts';
import { folderFrom, isApiNotePath } from './paths.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

const PAGE = { fallback: 100, max: 500 };

/**
 * A page of notes, in path order, with a cursor for the next page.
 *
 * Paged by the last path handed out rather than by position, so a note created
 * or removed between two pages moves nothing that has not been read yet.
 */
export async function listNotes(request: VaultRequest): Promise<RouteResult> {
  const { query } = request;
  const limit = countOf(query['limit'], { field: 'limit', ...PAGE });
  const inFolder = folderFilter(query['folder']);
  const ofType = await typeFilter(request, query['type']);

  const notes = (await listVaultNotes({ fs: request.fs })).filter(
    (path) => isApiNotePath(path) && inFolder(path) && ofType(path),
  );
  const { page, next } = pageAfter({
    items: notes,
    pathOf: (path) => path,
    cursor: query['cursor'],
    limit,
  });
  return { status: 200, body: { notes: await summariesOf(request, page), next } };
}

export async function readNoteRoute(request: VaultRequest): Promise<RouteResult> {
  const path = await notePathOf(request);
  const contents = await readNote(request, path);
  return { status: 200, body: { note: toApiNote({ markdown: request.markdown, path, contents }) } };
}

export async function backlinksRoute(request: VaultRequest): Promise<RouteResult> {
  const path = await notePathOf(request);
  await readNote(request, path);
  const linking = (await request.index.backlinks(path)).map(createVaultPath).filter(isApiNotePath);
  return { status: 200, body: { backlinks: await summariesOf(request, linking) } };
}

function folderFilter(raw: string | undefined): (path: VaultPath) => boolean {
  if (raw === undefined) return () => true;
  const folder = folderFrom(raw, 'folder');
  if (folder === VAULT_ROOT) return () => true;
  return (path) => path.startsWith(`${folder}/`);
}

async function typeFilter(
  request: VaultRequest,
  type: string | undefined,
): Promise<(path: VaultPath) => boolean> {
  if (type === undefined) return () => true;
  const ofType = new Set((await request.index.notesOfType(type)).map((note) => note.path));
  return (path) => ofType.has(path);
}
