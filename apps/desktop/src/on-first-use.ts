import { createElement, lazy, useState, type ComponentType, type LazyExoticComponent } from 'react';

/** A component whose code is in its own chunk, fetched the first time it is wanted. */
export interface OnFirstUse<P extends object> {
  /** Render inside a `Suspense`: before its chunk has loaded, it suspends. */
  readonly Component: LazyExoticComponent<ComponentType<P>>;
  /**
   * Fetches the chunk and readies the component, so that its first render
   * draws it straight away. A chunk that cannot be loaded readies the
   * component's failed state instead.
   */
  readonly preload: () => Promise<void>;
}

/** What a part whose chunk could not be loaded is drawn with, in its place. */
export interface FailedPartProps<P> {
  /** What the part was given, for drawing its frame. */
  readonly props: P;
  readonly retrying: boolean;
  /** Imports the chunk again, and draws the part if it arrives. */
  readonly onRetry: () => void;
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

const warnUnloaded = (cause: unknown) => console.warn('A part of Atlas could not load:', cause);

/**
 * `load` names the component in its module, so a named export can be split off
 * too. A chunk that fails to import, or throws as it is evaluated, never
 * reaches React as an error, which would unmount the whole app: the part is
 * drawn as `Failed`, which can import it again.
 */
export function onFirstUse<P extends object>(
  load: () => Promise<ComponentType<P>>,
  Failed: ComponentType<FailedPartProps<P>>,
): OnFirstUse<P> {
  const Component = lazy(() =>
    load().then(
      (loaded) => ({ default: loaded }),
      (cause: unknown) => {
        warnUnloaded(cause);
        return { default: retryable(load, Failed) };
      },
    ),
  );
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

/**
 * What a part whose first import failed resolves to: `Failed` until an import
 * again succeeds, then the part. React keeps a lazy component's first answer
 * for good, so the retry is made here, with a fresh `import()` each time.
 */
function retryable<P extends object>(
  load: () => Promise<ComponentType<P>>,
  Failed: ComponentType<FailedPartProps<P>>,
): ComponentType<P> {
  // Shared by every place the part is drawn, so one that recovered recovers all later ones.
  let recovered: ComponentType<P> | null = null;
  return function UnloadedPart(props: P) {
    const [loaded, setLoaded] = useState(() => recovered);
    const [retrying, setRetrying] = useState(false);
    if (loaded !== null) return createElement(loaded, props);
    const onRetry = () => {
      setRetrying(true);
      load().then(
        (part) => {
          recovered = part;
          setLoaded(() => part);
        },
        (cause: unknown) => {
          warnUnloaded(cause);
          setRetrying(false);
        },
      );
    };
    return createElement(Failed, { props, retrying, onRetry });
  };
}
