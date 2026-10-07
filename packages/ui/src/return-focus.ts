import { useCallback, useState } from 'react';

/** Where focus goes when an overlay closes and what opened it has gone. */
export type FocusFallback = () => HTMLElement | null;

/**
 * A dialog's `finalFocus` that hands focus back to what opened it — or, if that
 * element has left the document while the dialog was up (its note deleted, the
 * menu it sat in closed), to `fallback` rather than to `<body>`.
 *
 * The opener is read on the first render, which runs before Base UI moves focus
 * into the dialog.
 */
export function useReturnFocus(fallback: FocusFallback | undefined) {
  const [opener] = useState(() => document.activeElement);
  return useCallback(() => {
    if (opener instanceof HTMLElement && opener.isConnected) return true;
    // `true` is Base UI's own restore: the best it can do with no fallback.
    return fallback?.() ?? true;
  }, [opener, fallback]);
}
