import { invoke } from '@tauri-apps/api/core';
import type { VaultLocation, VaultLocationStore } from '@atlas/application';
import { throughHost } from './host-error.ts';

/**
 * The chosen vault is held by the Rust side, which both remembers it across
 * launches and uses it as the root for every subsequent read.
 */
export const tauriVaultStore: VaultLocationStore = {
  read() {
    return throughHost(invoke<VaultLocation | null>('current_vault'));
  },

  async write(location: VaultLocation) {
    await throughHost(invoke('open_vault', { location }));
  },
};
