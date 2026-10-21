import { invoke } from '@tauri-apps/api/core';
import { EXPORT_PAGE } from '@atlas/domain';
import type { PdfRendererPort } from '@atlas/application';
import { throughHost } from '../vault/host-error.ts';
import { pagingScript } from './paging-script.ts';

/** The headers `export_render_pdf` reads, as `export.rs` names them. */
export const PDF_HEADERS = {
  width: 'atlas-page-width',
  height: 'atlas-page-height',
  timeoutMs: 'atlas-timeout-ms',
} as const;

/** Long enough for a long meeting's transcript, with its pictures, to be laid out and printed. */
const PDF_TIMEOUT_MS = 60_000;

/**
 * A page made a PDF by the system's WebKit, through the host (`export.rs`):
 * the page goes as the raw body — pictures and all, it can be tens of
 * megabytes — and the sheet's size as headers.
 */
export const tauriPdfRenderer: PdfRendererPort = {
  pagingScript: pagingScript(EXPORT_PAGE),
  async render({ html, page }) {
    const headers = {
      [PDF_HEADERS.width]: String(page.width),
      [PDF_HEADERS.height]: String(page.height),
      [PDF_HEADERS.timeoutMs]: String(PDF_TIMEOUT_MS),
    };
    const pdf = await throughHost(
      invoke<ArrayBuffer>('export_render_pdf', new TextEncoder().encode(html), { headers }),
      (message) => new Error(message),
    );
    return new Uint8Array(pdf);
  },
};
