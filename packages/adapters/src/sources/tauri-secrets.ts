import { invoke } from '@tauri-apps/api/core';
import { SecretStoreError, type SecretStorePort, type StoredSecret } from '@atlas/application';
import { throughHost } from '../vault/host-error.ts';

const refused = (message: string) => new SecretStoreError(message);

/**
 * The open vault's secrets, in the Keychain, through the host.
 *
 * Names, values and the sites each may be sent to go in; only names and sites
 * come out. There is no command that returns a value, so there is nothing
 * here that could ask for one.
 */
export const tauriSecrets: SecretStorePort = {
  list() {
    return throughHost(invoke<StoredSecret[]>('secret_list'), refused);
  },
  set({ name, value, vault, origins }) {
    const bound = origins === undefined ? {} : { origins };
    return throughHost(invoke<void>('secret_set', { name, value, vault, ...bound }), refused);
  },
  bind({ name, origins, vault }) {
    return throughHost(invoke<void>('secret_bind', { name, origins, vault }), refused);
  },
  remove({ name, vault }) {
    return throughHost(invoke<void>('secret_delete', { name, vault }), refused);
  },
};
