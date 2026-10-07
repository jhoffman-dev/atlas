import { invoke } from '@tauri-apps/api/core';
import type { ExternalLinkPort } from '@atlas/application';
import { throughHost } from '../vault/host-error.ts';

/** Hands a link to the host, which opens web links in the default browser (`opener.rs`). */
export const tauriExternalLinks: ExternalLinkPort = {
  async open(url: string) {
    await throughHost(invoke('open_url', { url }), (message) => new Error(message));
  },
};
