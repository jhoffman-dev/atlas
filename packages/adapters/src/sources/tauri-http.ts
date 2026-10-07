import { invoke } from '@tauri-apps/api/core';
import type { HttpRequest } from '@atlas/domain';
import { HttpFetchError, type HttpPort } from '@atlas/application';
import { throughHost } from '../vault/host-error.ts';

/**
 * Fetching a feed, through the host.
 *
 * The guards that matter — which schemes are allowed, how long to wait, how much
 * to read — are in Rust, because that is where the socket is. So is filling in
 * the secrets a request names. This end only translates: a request in, text
 * out, and a refusal as an Error rather than a string.
 */
export const tauriHttp: HttpPort = {
  get({ request, vault }: { request: HttpRequest; vault: string }) {
    return throughHost(
      invoke<string>('http_get', { request, vault }),
      (message) => new HttpFetchError(message),
    );
  },
};
