import {
  ARCHIVE_LIST_LIMIT,
  createVaultPath,
  InvalidVaultPathError,
  vaultSpellingOf,
  type VaultPath,
} from '@atlas/domain';
import {
  archiveNotes,
  listArchive,
  unarchiveNotes,
  type ArchiveOutcome,
  type ArchivePorts,
} from '../archive/index.ts';
import { listVaultNotes } from '../vault/read-vault.ts';
import { ApiError, messageWithoutPaths } from './api-error.ts';
import type { ApiArchiveOutcome } from './contract.ts';
import { bodyObject, countOf, offsetOf, optionalArray } from './fields.ts';
import { isApiNotePath } from './paths.ts';
import type { MovingNotes } from './ports.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

/** How many notes one request may name: each is a move, a stamp and a link rewrite. */
const MAX_PATHS = 100;
const LISTED = { fallback: 50, max: ARCHIVE_LIST_LIMIT };

/**
 * Puts notes in the Archive, as the app's Archive command does for a
 * selection: each moves under `Archive/` at its own path, stamped with today
 * and where it was, and the links it leaves behind are rewritten.
 */
export async function archiveRoute(request: VaultRequest): Promise<RouteResult> {
  const today = request.clock.today();
  return moveBatch(request, (batch) => archiveNotes({ ...batch, today }));
}

/** Takes notes out of the Archive, each back to its path without `Archive/`. */
export async function unarchiveRoute(request: VaultRequest): Promise<RouteResult> {
  return moveBatch(request, unarchiveNotes);
}

/** The archived notes whose title or path holds every word of `search`, newest first, a page at a time. */
export async function archiveListRoute(request: VaultRequest): Promise<RouteResult> {
  const limit = countOf(request.query['limit'], { field: 'limit', ...LISTED });
  const offset = offsetOf(request.query['offset']);
  const search = request.query['search'] ?? '';
  const { notes, truncated } = await listArchive({
    index: request.index,
    search,
    limit,
    offset,
  }).catch((error: unknown) => {
    throw new ApiError(
      'query_failed',
      `The index could not list the Archive: ${messageWithoutPaths(error)}`,
    );
  });
  return {
    status: 200,
    body: { notes, truncated, next: truncated ? offset + notes.length : null },
  };
}

type Batch = Parameters<typeof unarchiveNotes>[0];

/**
 * Runs one batch over the paths a request named — archiving, unarchiving,
 * processing the Inbox. A path the API cannot reach, or that names no note,
 * is reported beside the batch's own failures rather than refusing the
 * request, as the app reports a selection.
 */
export async function moveBatch(
  request: VaultRequest,
  run: (batch: Batch) => Promise<ArchiveOutcome>,
): Promise<RouteResult> {
  const asked = requestedPaths(request.body);
  const notePaths = await listVaultNotes({ fs: request.fs });
  const { paths, refused } = reachableNotes(asked, notePaths);

  // Never `save`: the API does not save someone's typing for them (ADR-0016).
  const outcome = await run({
    ports: archivePorts(request),
    paths,
    notePaths,
    updateLinks: true,
    unsavedTyping: 'leave',
  });
  // A vault switched mid-batch still gets the answer: what moved before the
  // switch did move, and the host refused the rest, which `failed` lists.
  return { status: 200, body: answerOf(outcome, refused) };
}

function requestedPaths(body: unknown): readonly string[] {
  const paths = optionalArray(bodyObject(body), 'paths');
  if (paths === undefined || paths.length === 0 || paths.length > MAX_PATHS) {
    throw new ApiError('invalid', `paths must list 1 to ${MAX_PATHS} note paths`);
  }
  return paths.map((path, at) => {
    if (typeof path !== 'string') throw new ApiError('invalid', `paths[${at}] must be a string`);
    return path;
  });
}

type Failure = ApiArchiveOutcome['failed'][number];

/** The notes asked for, spelled as the vault spells them and named once each, and the rest with why. */
function reachableNotes(
  asked: readonly string[],
  notePaths: readonly VaultPath[],
): { paths: VaultPath[]; refused: Failure[] } {
  const paths = new Set<VaultPath>();
  const refused: Failure[] = [];
  for (const raw of asked) {
    const found = noteAt(raw, notePaths);
    if (typeof found === 'string') paths.add(found);
    else refused.push({ path: raw, reason: found.reason });
  }
  return { paths: [...paths], refused };
}

function noteAt(raw: string, notePaths: readonly VaultPath[]): VaultPath | { reason: string } {
  let path: VaultPath;
  try {
    path = createVaultPath(raw);
  } catch (error) {
    if (error instanceof InvalidVaultPathError) return { reason: 'It is not a vault path.' };
    throw error;
  }
  if (!isApiNotePath(path)) {
    return { reason: 'The API reaches notes only: .md files outside .atlas and hidden folders.' };
  }
  return vaultSpellingOf(path, notePaths) ?? { reason: 'There is no note at this path.' };
}

/**
 * What the batch reaches, bound to the vault this request is for. The panes
 * belong to whichever vault is open now, so once another is, they are left
 * alone: nothing of this vault is in them.
 */
export function archivePorts(request: VaultRequest): ArchivePorts {
  return {
    fs: request.fs,
    index: request.index,
    markdown: request.markdown,
    editors: boundPanes(request.movingNotes, request.assertStillOpen),
  };
}

function boundPanes(panes: MovingNotes, assertStillOpen: () => void): MovingNotes {
  const stillOpen = () => {
    try {
      assertStillOpen();
      return true;
    } catch {
      // Switched: the batch's writes are refused by the host, and the answer says so.
      return false;
    }
  };
  return {
    state: (path) => (stillOpen() ? panes.state(path) : 'closed'),
    flush: async (paths) => {
      assertStillOpen();
      await panes.flush(paths);
    },
    follow: (move) => {
      if (stillOpen()) panes.follow(move);
    },
    abandon: (paths) => {
      if (stillOpen()) panes.abandon(paths);
    },
    reload: (path) => {
      if (stillOpen()) panes.reload(path);
    },
  };
}

function answerOf(outcome: ArchiveOutcome, refused: readonly Failure[]): ApiArchiveOutcome {
  return {
    moves: outcome.moves.map(({ move }) => ({ from: move.from, to: move.to })),
    failed: [
      ...refused,
      ...outcome.failed.map(({ path, reason, unsavedInApp }) => ({
        path,
        reason: messageWithoutPaths(reason),
        ...(unsavedInApp === true && { code: 'unsaved_in_app' as const }),
      })),
    ],
    linksUpdated: outcome.linksUpdated,
  };
}
