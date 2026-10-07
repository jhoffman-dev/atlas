import { invoke } from '@tauri-apps/api/core';
import type { ModelHttpHost } from './anthropic-api-provider.ts';

/**
 * The model's API, reached through the host (`model_http.rs`), which fills in
 * the key from the Keychain, refuses any site it is not bound to, and strikes
 * it from the answer before the answer comes back here.
 */
export const tauriModelHttp: ModelHttpHost = {
  async post({ vault, url, headers, body }) {
    try {
      return await invoke<{ status: number; body: string }>('model_http_post', {
        vault,
        request: { url: [{ text: url }], headers },
        body,
      });
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  },
};
