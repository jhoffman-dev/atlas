import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { VaultWatchPort } from '@atlas/application';
import { throughHost } from './host-error.ts';

/** Watches the vault through the host and forwards what changed. */
export const tauriVaultWatch: VaultWatchPort = {
  async start() {
    await throughHost(invoke('watch_vault'));
  },

  async onChange(handler: (paths: readonly string[]) => void) {
    const stop = await listen<string[]>('vault-changed', (event) => handler(event.payload));
    return stop;
  },
};
