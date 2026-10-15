import {
  createVaultPath,
  INBOX_LIST_LIMIT,
  InvalidVaultPathError,
  type VaultPath,
} from '@atlas/domain';
import { listVaultInbox } from '../inbox/list-inbox.ts';
import { FilingRefusedError, processInboxItems } from '../inbox/process-inbox.ts';
import { ApiError } from './api-error.ts';
import { moveBatch } from './archive.ts';
import { decodeInboxCursor, encodeInboxCursor } from './cursor.ts';
import { bodyObject, countOf, requiredString } from './fields.ts';
import { isApiNotePath } from './paths.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

/**
 * The notes waiting in the Inbox to be filed, as its page lists them (P30-01):
 * newest first, each with what the meeting import made of it, a page at a
 * time with how many wait in all (#167). Each page is read on from the
 * cursor the one before handed out, so filing what a page listed loses
 * nothing. Notes of the proposal type are not among them — they are answered
 * through the proposals routes, never filed. Reads the index and writes nothing.
 */
export async function inboxRoute(request: VaultRequest): Promise<RouteResult> {
  const limit = countOf(request.query['limit'], {
    field: 'limit',
    fallback: INBOX_LIST_LIMIT,
    max: INBOX_LIST_LIMIT,
  });
  const cursor = request.query['cursor'];
  const after = cursor === undefined ? null : decodeInboxCursor(cursor);
  const { items, truncated, total, last } = await listVaultInbox({
    ...request,
    page: { limit, after },
  });
  const next = truncated && last !== null ? encodeInboxCursor(last) : null;
  return { status: 200, body: { items, truncated, next, total } };
}

/**
 * Files notes from the Inbox under a project or an area, as the Inbox's
 * Process does (P30-01): each moves into the project's folder and gets
 * `project: [[…]]` linking it. `project` must be a project or an area; any
 * other note refuses the whole request before a note moves.
 */
export async function processInboxRoute(request: VaultRequest): Promise<RouteResult> {
  const project = projectOf(request.body);
  try {
    return await moveBatch(request, (batch) => processInboxItems({ ...batch, project }));
  } catch (error) {
    if (error instanceof FilingRefusedError) throw new ApiError('invalid', error.message);
    throw error;
  }
}

function projectOf(body: unknown): VaultPath {
  const raw = requiredString(bodyObject(body), 'project');
  let path: VaultPath;
  try {
    path = createVaultPath(raw);
  } catch (error) {
    if (error instanceof InvalidVaultPathError) {
      throw new ApiError('invalid', 'project must be a vault path');
    }
    throw error;
  }
  if (!isApiNotePath(path)) {
    throw new ApiError(
      'invalid',
      'project must be a note: a .md file outside .atlas and hidden folders',
    );
  }
  return path;
}
