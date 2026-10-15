import {
  compileNotesOnDayQuery,
  createVaultPath,
  isNamedForDay,
  nearestNotePaths,
  readEventTime,
  VAULT_ROOT,
  type VaultPath,
} from '@atlas/domain';
import { listVaultNotes } from '../vault/read-vault.ts';
import { ApiError } from './api-error.ts';
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
  const onDay = await dayFilter(request, query['date']);

  const notes = (await listVaultNotes({ fs: request.fs })).filter(
    (path) => isApiNotePath(path) && inFolder(path) && ofType(path) && onDay(path),
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
  const contents = await readNote(request, path).catch((error: unknown) =>
    notFoundWithNearest(request, path, error),
  );
  return { status: 200, body: { note: toApiNote({ markdown: request.markdown, path, contents }) } };
}

/**
 * A note that is not there, answered with the notes most like it by name, so
 * a caller that guessed a path from a title — the chat's model, an MCP
 * client — is handed the real one rather than guessing again (#211).
 */
async function notFoundWithNearest(
  request: VaultRequest,
  path: VaultPath,
  error: unknown,
): Promise<never> {
  if (!(error instanceof ApiError) || error.code !== 'not_found') throw error;
  const notes = (await listVaultNotes({ fs: request.fs })).filter(isApiNotePath);
  const nearest = nearestNotePaths(path, notes);
  if (nearest.length === 0) throw error;
  throw new ApiError(
    'not_found',
    `${error.message}. Notes with a name like it: ${nearest.map((each) => JSON.stringify(each)).join(', ')}`,
  );
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

/**
 * The notes about one day: named for it (`2026-10-14 Standup.md`, a daily
 * note) or dated it by their `date` property, as a meeting is (#211).
 */
async function dayFilter(
  request: VaultRequest,
  raw: string | undefined,
): Promise<(path: VaultPath) => boolean> {
  if (raw === undefined) return () => true;
  const day = calendarDayOf(raw);
  const { sql, parameters } = compileNotesOnDayQuery(day);
  const dated = new Set((await request.index.query(sql, parameters)).rows.map((row) => row[0]));
  return (path) => dated.has(path) || isNamedForDay(path, day);
}

function calendarDayOf(raw: string): string {
  const read = readEventTime(raw);
  if (read === null || read.minutes !== null || read.date !== raw) {
    throw new ApiError('invalid', 'date must be a real day, written YYYY-MM-DD');
  }
  return raw;
}

async function typeFilter(
  request: VaultRequest,
  type: string | undefined,
): Promise<(path: VaultPath) => boolean> {
  if (type === undefined) return () => true;
  const ofType = new Set((await request.index.notesOfType(type)).map((note) => note.path));
  return (path) => ofType.has(path);
}
