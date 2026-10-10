import { getAppInfo } from '../get-app-info.ts';
import type { VaultLocation } from '../vault/ports.ts';
import type { ApiStatus } from './contract.ts';
import type { ApiRouterDeps } from './ports.ts';
import type { RouteResult } from './vault-request.ts';

/** What Atlas has open. The one route that answers with no vault open. */
export async function statusRoute(deps: ApiRouterDeps): Promise<RouteResult> {
  const { version } = await getAppInfo({ appInfo: deps.appInfo });
  const location = deps.host.currentVault();
  const status: ApiStatus = {
    app: 'atlas',
    version,
    vault: location === null ? null : { name: location.name },
    index: location === null ? { ready: false, notes: 0 } : await indexStatus(deps),
    googleCalendar: location === null ? null : await googleCalendarStatus(deps, location),
  };
  return { status: 200, body: status };
}

async function indexStatus(deps: ApiRouterDeps): Promise<ApiStatus['index']> {
  if (!deps.host.indexReady()) return { ready: false, notes: 0 };
  try {
    return { ready: true, notes: (await deps.index.stats()).notes };
  } catch {
    // An index that cannot count its notes is not ready to answer from, and
    // saying so is the status this route exists to report.
    return { ready: false, notes: 0 };
  }
}

async function googleCalendarStatus(
  deps: ApiRouterDeps,
  location: VaultLocation,
): Promise<NonNullable<ApiStatus['googleCalendar']>> {
  try {
    const { connected } = await deps.googleCalendar.status({ vault: location.absolutePath });
    return { connected };
  } catch {
    // A sign-in the Keychain will not give back cannot be used, which is
    // what `connected: false` tells a caller; Settings says why.
    return { connected: false };
  }
}
