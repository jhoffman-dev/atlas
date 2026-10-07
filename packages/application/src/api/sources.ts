import {
  createVaultPath,
  InvalidVaultPathError,
  isOutsideVault,
  parseDatasource,
  sourceTrustRefusal,
  splitFrontmatter,
  type Datasource,
  type VaultPath,
} from '@atlas/domain';
import { ApiError } from './api-error.ts';
import { readNote } from './note-io.ts';
import { isApiFilePath, isApiFolderPath, isApiViewPath, viewPathFromUrl } from './paths.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';
import { spelledAsVault } from './vault-spelling.ts';

/**
 * Refreshes a source note now, as its Refresh button does, and answers with
 * what the refresh did.
 *
 * A source note is found where a view is — in user space, or in
 * `.atlas/sources` where they usually live — and read, never written. It is
 * refreshed only when everything it reads and writes in the vault is in user
 * space: a note anyone could have written must not have the API copy a hidden
 * file (`.git/config`) into notes it can read, nor write over `.atlas`.
 *
 * A source that sends a secret or reads a database outside the vault runs
 * only from `.atlas/sources`, which the API cannot write (ADR-0017): anything
 * that can write a note could otherwise aim the user's secret at a URL of its
 * own. Such a source anywhere else is `forbidden`, and nothing is fetched.
 *
 * The refresh is the app's own, bound to the vault this request arrived for:
 * its notes land there and only that vault's secrets are sent, each by the
 * host and only to the sites it was bound to (ADR-0017), so a note pointed
 * somewhere else is refused by the host, not obeyed. No secret value is ever
 * in the answer. A refresh of the same source already under way — the pane's
 * timer, another request — is `conflict`, since a second would make its notes
 * twice. So is one the API refreshed less than 30 seconds ago, with
 * `retryAfter` saying how long is left: a caller looping on this route must
 * not hammer a feed in the user's name.
 */
export async function refreshSourceRoute(request: VaultRequest): Promise<RouteResult> {
  const path = await spelledAsVault({
    fs: request.fs,
    asked: viewPathFromUrl(request.pathParam),
    accepts: isApiViewPath,
  });
  const { text } = await readNote(request, path);
  const source = parseDatasource(
    request.markdown.frontmatterProperties(splitFrontmatter(text).frontmatter),
  );
  if (source === null) throw new ApiError('invalid', `${path} is not a source`);
  refuseOutsideUserSpace(source);
  const untrusted = sourceTrustRefusal({ source, sourcePath: path });
  if (untrusted !== null) throw new ApiError('forbidden', untrusted);
  refuseTooSoon(request, path);

  request.assertStillOpen();
  const report = await request.sourceRefresher.refresh({
    fs: request.fs,
    markdown: request.markdown,
    index: request.index,
    http: request.sources.http,
    sqlite: request.sources.sqlite,
    sourcePath: path,
    source,
    vault: request.vault,
    now: request.clock.now(),
  });
  if (report === null) throw new ApiError('conflict', `${path} is being refreshed already`);
  // A report of writes the host refused because another vault was opened is that switch.
  request.assertStillOpen();
  return { status: 200, body: { report } };
}

/** Refuses a refresh of a source the API refreshed too recently, saying how long is left. */
function refuseTooSoon(request: VaultRequest, path: VaultPath): void {
  const wait = request.refreshSpacing.claim({
    key: `${request.vault}\n${path}`,
    now: request.clock.now(),
  });
  if (wait === 0) return;
  const retryAfter = Math.ceil(wait / 1000);
  throw new ApiError(
    'conflict',
    `${path} was refreshed through the API moments ago; try again in ${retryAfter} s`,
    { retryAfter },
  );
}

/** Refuses a source that writes into, or reads a file from, anywhere but user space. */
function refuseOutsideUserSpace(source: Datasource): void {
  if (!isApiFolderPath(vaultPath(source.into))) {
    throw new ApiError(
      'invalid',
      `into ${JSON.stringify(source.into)} is not a folder the API can write`,
    );
  }
  const file = source.file;
  if (file !== null && !isOutsideVault(file) && !isApiFilePath(vaultPath(file))) {
    throw new ApiError('invalid', `file ${JSON.stringify(file)} is not a file the API can read`);
  }
}

function vaultPath(raw: string): VaultPath {
  try {
    return createVaultPath(raw);
  } catch (error) {
    if (error instanceof InvalidVaultPathError) {
      throw new ApiError('invalid', `${JSON.stringify(raw)} is not a vault path`);
    }
    throw error;
  }
}
