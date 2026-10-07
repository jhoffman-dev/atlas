import { invoke } from '@tauri-apps/api/core';
import type { PageSnapshotPort, PageSnapshotRequest } from '@atlas/application';
import { throughHost } from '../vault/host-error.ts';

/** The headers `snapshot_page` reads, as `page_snapshot.rs` names them. */
export const SNAPSHOT_HEADERS = {
  width: 'atlas-width',
  height: 'atlas-height',
  pictureWidth: 'atlas-picture-width',
  settleMs: 'atlas-settle-ms',
  timeoutMs: 'atlas-timeout-ms',
} as const;

/**
 * Asks the host to picture a page (`page_snapshot.rs`). The page goes as the
 * raw body — it can be tens of megabytes, which JSON would copy and escape —
 * and the numbers as headers.
 */
export const tauriPageSnapshot: PageSnapshotPort = {
  async capture({ html, ...numbers }: PageSnapshotRequest) {
    const headers: Record<string, string> = Object.fromEntries(
      Object.entries(SNAPSHOT_HEADERS).map(([key, header]) => [
        header,
        String(numbers[key as keyof typeof SNAPSHOT_HEADERS]),
      ]),
    );
    const picture = await throughHost(
      invoke<ArrayBuffer>('snapshot_page', new TextEncoder().encode(html), { headers }),
      (message) => new Error(message),
    );
    return new Uint8Array(picture);
  },
};
