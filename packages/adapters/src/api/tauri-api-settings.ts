import { invoke } from '@tauri-apps/api/core';
import type { ApiConnectionStatus, ApiSettingsPort } from '@atlas/application';
import { throughHost } from '../vault/host-error.ts';

/** Not a vault failure: the API could not be switched, or its token not read. */
const asApiError = (message: string): Error => new Error(message);

/** The API's switch and token, kept by the Rust host in the connection file. */
export const tauriApiSettings: ApiSettingsPort = {
  status() {
    return throughHost(invoke<ApiConnectionStatus>('api_status'), asApiError);
  },

  setEnabled(enabled) {
    return throughHost(invoke<ApiConnectionStatus>('api_set_enabled', { enabled }), asApiError);
  },

  token() {
    return throughHost(invoke<string>('api_token'), asApiError);
  },

  rotateToken() {
    return throughHost(invoke<string>('api_rotate_token'), asApiError);
  },
};
