import { getCurrentWindow } from '@tauri-apps/api/window';
import type { WindowClosingPort } from '@atlas/application';

/**
 * The window's close button, through Tauri: the task runs first, and the
 * window closes once it has settled. Tauri closes it only if the handler
 * returns, so a task that fails is reported here rather than keeping the
 * window open for good.
 */
export const tauriWindowClosing: WindowClosingPort = {
  // Async, so a page with no Tauri window behind it is a refusal to handle, not a throw.
  beforeClose: async (task) =>
    getCurrentWindow().onCloseRequested(async () => {
      try {
        await task();
      } catch (cause) {
        console.error('Work before closing the window failed:', cause);
      }
    }),
};
