import { createStore, useStore, type StoreApi } from 'zustand';
import {
  NO_OVERLAY,
  drawnByWindow,
  withClosed,
  withOpened,
  type Overlay,
  type OverlayState,
  type PaletteInput,
} from './overlay.ts';

/**
 * The window's overlays and the search palette's input, held outside `App`
 * (ADR-0040): what draws an overlay subscribes to it, so opening ⌘K and
 * typing into it draws only the palette (#261). The rules are `overlay.ts`'s.
 */
export type OverlayStore = StoreApi<OverlayState>;

export function createOverlayStore(): OverlayStore {
  return createStore<OverlayState>()(() => NO_OVERLAY);
}

export function showOverlay(store: OverlayStore, requested: Overlay): void {
  store.setState((state) => withOpened(state, requested));
}

export function hideOverlay(store: OverlayStore, closing: Overlay): void {
  store.setState((state) => withClosed(state, closing));
}

/** What is up now, read at the moment it is needed rather than subscribed to. */
export function overlayNow(store: OverlayStore): Overlay | null {
  return store.getState().overlay;
}

/** Changes the palette's input by `change`, leaving which overlay is up alone. */
export function changePalette(
  store: OverlayStore,
  change: (input: PaletteInput) => PaletteInput,
): void {
  store.setState((state) => ({ palette: change(state.palette) }));
}

/** The overlay the window draws itself: it does not change as ⌘K opens or closes. */
export function useWindowOverlay(store: OverlayStore): Overlay | null {
  return useStore(store, drawnByWindow);
}

export function useOverlayUp(store: OverlayStore, overlay: Overlay): boolean {
  return useStore(store, (state) => state.overlay === overlay);
}

export function usePaletteInput(store: OverlayStore): PaletteInput {
  // The palette's input is replaced whole on each change, so it is its own selector.
  return useStore(store, (state) => state.palette);
}
