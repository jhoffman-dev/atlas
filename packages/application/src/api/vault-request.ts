import type { ImagePlacement } from '@atlas/domain';
import type { ThumbnailQueue } from '../artifacts/thumbnail-queue.ts';
import type { IndexPort } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { SourceRefresher } from '../sources/source-refresher.ts';
import type { VaultTagRenames } from '../tags/index.ts';
import type { Clock, Rng } from '../ports.ts';
import { inVault } from '../vault/in-vault.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { ApiError } from './api-error.ts';
import type { ApiRequest, ApiSuccessBody } from './contract.ts';
import type {
  ApiRouterDeps,
  ApiSourcePorts,
  AutomationClockState,
  MovingNotes,
  OpenNotes,
} from './ports.ts';
import type { RefreshSpacing } from './refresh-spacing.ts';
import type { RouteParams } from './routes.ts';

/** What a handler answers with when it succeeds. */
export interface RouteResult {
  readonly status: number;
  readonly body: ApiSuccessBody;
}

/**
 * A request for a route that needs a vault, bound to the vault that was open
 * when it arrived.
 *
 * Every write through `fs` names that vault, so the host refuses it once
 * another is open (R14-01). The panes are not bound that way — they belong to
 * whatever vault is open now — so anything that reaches them checks first.
 */
export interface VaultRequest {
  /** The raw `{path}` segment of the URL, still percent-encoded; '' when the route has none. */
  readonly pathParam: string;
  /** The raw `{name}` segment of the URL, still percent-encoded; '' when the route has none. */
  readonly nameParam: string;
  /** The raw `{tag}` segment of the URL, still percent-encoded; '' when the route has none. */
  readonly tagParam: string;
  /** The raw `{id}` segment of the URL, still percent-encoded; '' when the route has none. */
  readonly idParam: string;
  readonly query: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly fs: VaultFsPort;
  readonly markdown: MarkdownPort;
  readonly index: IndexPort;
  readonly openNotes: OpenNotes;
  readonly movingNotes: MovingNotes;
  readonly clock: Clock;
  readonly thumbnails: Pick<ThumbnailQueue, 'requestOrFail'>;
  /** The absolute path of the vault this request is for: a refresh sends its secrets only. */
  readonly vault: string;
  readonly sources: ApiSourcePorts;
  /** Where Settings → Images put a note's images as this request arrived. */
  readonly imagePlacement: ImagePlacement;
  readonly sourceRefresher: SourceRefresher;
  /** Tag renames in the vault this request is for. */
  readonly tagRenames: VaultTagRenames;
  readonly refreshSpacing: RefreshSpacing;
  readonly newUploadId: () => string;
  /** Where a new block id is drawn from (P30-03). */
  readonly rng: Rng;
  /** The app's automation runner, for this request's vault; null when it is not watching it. */
  readonly automationClock: AutomationClockState | null;
  /** Refuses with `no_vault` once the vault this request arrived for is no longer open. */
  readonly assertStillOpen: () => void;
}

export type VaultHandler = (request: VaultRequest) => Promise<RouteResult>;

/** Binds a request to the vault open now, or refuses it when there is none. */
export function vaultRequest({
  request,
  params,
  deps,
}: {
  request: ApiRequest;
  params: RouteParams;
  deps: ApiRouterDeps;
}): VaultRequest {
  const vault = deps.host.currentVault()?.absolutePath ?? null;
  if (vault === null) throw noVault('No vault is open in Atlas');

  return {
    pathParam: params.path,
    nameParam: params.name,
    tagParam: params.tag,
    idParam: params.id,
    query: request.query,
    body: request.body,
    fs: inVault({ fs: deps.fs, vault }),
    markdown: deps.markdown,
    index: deps.index,
    openNotes: deps.openNotes,
    movingNotes: deps.movingNotes,
    clock: deps.clock,
    thumbnails: deps.thumbnails,
    vault,
    sources: deps.sources,
    imagePlacement: deps.imagePlacement(),
    sourceRefresher: deps.sourceRefresher,
    tagRenames: deps.tagRenames.forVault(vault),
    refreshSpacing: deps.refreshSpacing,
    newUploadId: deps.newUploadId,
    rng: deps.rng,
    automationClock: deps.automationClock.forVault(vault),
    assertStillOpen: () => {
      if (deps.host.currentVault()?.absolutePath !== vault) {
        throw noVault('The vault this request was for is no longer open');
      }
    },
  };
}

function noVault(message: string): ApiError {
  return new ApiError('no_vault', message);
}
