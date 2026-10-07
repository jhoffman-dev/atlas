import type { KeyboardEvent } from 'react';

/**
 * Whether a key belongs to an input method rather than to us.
 *
 * While a Japanese, Chinese or Korean IME is composing, Enter commits the
 * characters being composed; it is not the field's own Enter. Engines report
 * that two ways: Chromium and Firefox set `isComposing`, while WebKit — the
 * macOS webview Atlas runs in — ends the composition first and then sends the
 * Enter with `keyCode` 229, the code the IME reserves for keys it has handled.
 */
export function isImeKey(event: KeyboardEvent): boolean {
  // `keyCode` is deprecated, but 229 is the only signal WebKit gives for the
  // Enter that follows `compositionend`; `isComposing` is already false by then.
  return event.nativeEvent.isComposing || event.keyCode === 229;
}
