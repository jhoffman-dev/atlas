import { NAME_PLACEHOLDER } from '@atlas/domain';
import { loadProfile } from '../profile/index.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

/**
 * Who uses the vault, as Settings → Profile says (#10). Read only: the API
 * never writes `.atlas`, and the name is changed in Settings.
 */
export async function profileRoute(request: VaultRequest): Promise<RouteResult> {
  const profile = await loadProfile({ fs: request.fs, markdown: request.markdown });
  return { status: 200, body: { profile: { ...profile, placeholder: NAME_PLACEHOLDER } } };
}
