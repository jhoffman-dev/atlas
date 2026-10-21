import { invoke } from '@tauri-apps/api/core';
import type { ExportDestination, ExportFilesPort } from '@atlas/application';
import { throughHost } from '../vault/host-error.ts';

/** The headers `export_write_file` reads, as `export.rs` names them. */
export const EXPORT_WRITE_HEADERS = {
  destination: 'atlas-export-destination',
  path: 'atlas-export-path',
} as const;

const failure = (message: string) => new Error(message);

/**
 * Where an export goes, through the host (`export.rs`): the host asks with
 * its own dialog and holds what was picked; a write names only the place it
 * was handed and a path inside it. The bytes go as the raw body, the rest as
 * headers, the path percent-encoded so any name reaches the host as it is.
 */
export const tauriExportFiles: ExportFilesPort = {
  choose(request) {
    return throughHost(
      invoke<ExportDestination | null>('export_choose_destination', { request }),
      failure,
    );
  },
  async write({ destination, path, bytes }) {
    const headers = {
      [EXPORT_WRITE_HEADERS.destination]: destination.id,
      [EXPORT_WRITE_HEADERS.path]: encodeURIComponent(path),
    };
    await throughHost(invoke<number>('export_write_file', bytes, { headers }), failure);
  },
  finish({ id }, { discard }) {
    return throughHost(invoke<void>('export_finish', { id, discard }), failure);
  },
};
