import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  GLOBAL_CAPTURE_EVENT,
  type GlobalCapturePort,
  type GlobalCaptureShortcut,
} from '@atlas/application';
import { throughHost } from '../vault/host-error.ts';

/** Not a vault failure: the shortcut could not be read or changed. */
const asShortcutError = (message: string): Error => new Error(message);

/**
 * The global capture shortcut, registered and kept by the Rust host
 * (`quick_capture.rs`, ADR-0033). The webview only reads it, asks for another,
 * and hears `global-capture` when it is pressed.
 */
export const tauriGlobalCapture: GlobalCapturePort = {
  status() {
    return throughHost(invoke<GlobalCaptureShortcut>('global_capture_status'), asShortcutError);
  },

  set(shortcut) {
    return throughHost(
      invoke<GlobalCaptureShortcut>('global_capture_set', { shortcut }),
      asShortcutError,
    );
  },

  listen(pressed) {
    return listen(GLOBAL_CAPTURE_EVENT, () => pressed());
  },
};
