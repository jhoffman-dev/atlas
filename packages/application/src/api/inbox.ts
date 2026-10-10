import { createVaultPath, InvalidVaultPathError, type VaultPath } from '@atlas/domain';
import { FilingRefusedError, processInboxItems } from '../inbox/process-inbox.ts';
import { ApiError } from './api-error.ts';
import { moveBatch } from './archive.ts';
import { bodyObject, requiredString } from './fields.ts';
import { isApiNotePath } from './paths.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

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
