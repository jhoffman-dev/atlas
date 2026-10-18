import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/** A component whose code is in its own chunk, fetched the first time it is wanted. */
export interface OnFirstUse<P extends object> {
  /** Render inside a `Suspense`: before its chunk has loaded, it suspends. */
  readonly Component: LazyExoticComponent<ComponentType<P>>;
  /**
   * Fetches the chunk and readies the component, so that its first render
   * draws it straight away. Rejects if the chunk cannot be loaded.
   */
  readonly preload: () => Promise<void>;
}

/**
 * React's own handle on a lazy component: `_init(_payload)` returns the loaded
 * component, or throws the promise of it while it loads. It is the only way to
 * settle a lazy component before it renders, and without it a page preloaded
 * long ago still commits its fallback once on first open (`on-first-use.test.tsx`).
 */
interface LazyHandle {
  readonly _init: (payload: unknown) => unknown;
  readonly _payload: unknown;
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === 'object' && value !== null && 'then' in value;

/** `load` names the component in its module, so a named export can be split off too. */
export function onFirstUse<P extends object>(load: () => Promise<ComponentType<P>>): OnFirstUse<P> {
  const Component = lazy(() => load().then((loaded) => ({ default: loaded })));
  const handle = Component as unknown as LazyHandle;
  return {
    Component,
    preload: async () => {
      try {
        handle._init(handle._payload);
      } catch (thrown) {
        // Pending: React settles the component as this promise does, before any later await.
        if (!isThenable(thrown)) throw thrown;
        await thrown;
      }
    },
  };
}
