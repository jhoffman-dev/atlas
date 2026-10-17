/**
 * Counts which components React rendered, by name, through the hook React
 * DevTools is given: React hands every commit to it, in a production build
 * as much as in a test. A test (or the perf harness, in a browser page)
 * installs it before React loads, then reads how often each component's
 * function ran between two points — which is how a memo that is defeated
 * shows itself.
 *
 * Test support only: the app never installs it.
 */

/** What was counted while counting was on. */
export interface RenderCounts {
  /** How many times each component rendered, mounts included, by name. */
  readonly renders: Readonly<Record<string, number>>;
  /**
   * Of each component's renders that were not mounts, how often each prop was
   * a different value from the render before: the props that defeat a memo.
   */
  readonly changedProps: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

interface Counter {
  on: boolean;
  renders: Record<string, number>;
  changedProps: Record<string, Record<string, number>>;
}

interface CountingGlobal {
  __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown;
  __renderCounter?: Counter;
}

/**
 * Installs the counter on the global object, switched off. Everything it uses
 * is inside it: the perf harness sends it into a page as its source.
 */
export function installRenderCounter(): void {
  // React's own numbers for the fibers that are components, and for "this one's function ran".
  const FUNCTION = 0;
  const CLASS = 1;
  const FORWARD_REF = 11;
  const SIMPLE_MEMO = 15;
  const PERFORMED_WORK = 1;

  interface Named {
    readonly name?: string;
    readonly displayName?: string;
    readonly render?: Named;
  }
  interface Fiber {
    readonly tag: number;
    readonly type: Named | string | null;
    readonly flags: number;
    readonly alternate: Fiber | null;
    readonly child: Fiber | null;
    readonly sibling: Fiber | null;
    readonly memoizedProps: Readonly<Record<string, unknown>> | null;
  }

  const target = globalThis as CountingGlobal;
  const counter: Counter = { on: false, renders: {}, changedProps: {} };
  target.__renderCounter = counter;

  const nameOf = (fiber: Fiber): string | null => {
    const { type } = fiber;
    if (type === null || typeof type === 'string') return null;
    if (fiber.tag === FORWARD_REF) {
      return type.displayName ?? type.render?.displayName ?? type.render?.name ?? null;
    }
    return type.displayName ?? type.name ?? null;
  };
  const isComponent = (fiber: Fiber) =>
    fiber.tag === FUNCTION ||
    fiber.tag === CLASS ||
    fiber.tag === FORWARD_REF ||
    fiber.tag === SIMPLE_MEMO;

  const record = (fiber: Fiber, before: Fiber | null) => {
    const name = isComponent(fiber) ? nameOf(fiber) : null;
    if (name === null || name === '') return;
    counter.renders[name] = (counter.renders[name] ?? 0) + 1;
    const now = fiber.memoizedProps;
    const was = before?.memoizedProps ?? null;
    if (now === null || was === null) return;
    const changed = (counter.changedProps[name] ??= {});
    for (const key of new Set([...Object.keys(now), ...Object.keys(was)])) {
      if (key !== 'children' && now[key] !== was[key]) changed[key] = (changed[key] ?? 0) + 1;
    }
  };
  const mounted = (fiber: Fiber) => {
    record(fiber, null);
    for (let child = fiber.child; child !== null; child = child.sibling) mounted(child);
  };
  // A subtree React did not visit keeps the same child fibers, so it is not walked.
  const updated = (fiber: Fiber, before: Fiber) => {
    if ((fiber.flags & PERFORMED_WORK) !== 0) record(fiber, before);
    if (fiber.child === before.child) return;
    for (let child = fiber.child; child !== null; child = child.sibling) {
      if (child.alternate === null) mounted(child);
      else updated(child, child.alternate);
    }
  };

  target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject: () => 1,
    checkDCE: () => undefined,
    onScheduleFiberRoot: () => undefined,
    onCommitFiberUnmount: () => undefined,
    onPostCommitFiberRoot: () => undefined,
    onCommitFiberRoot: (_renderer: number, root: { readonly current: Fiber }) => {
      if (!counter.on) return;
      const before = root.current.alternate;
      if (before === null) mounted(root.current);
      else updated(root.current, before);
    },
  };
}

function counterOf(): Counter {
  const counter = (globalThis as CountingGlobal).__renderCounter;
  if (counter === undefined) throw new Error('installRenderCounter() was not called first');
  return counter;
}

/** Starts counting from nothing. */
export function startCountingRenders(): void {
  Object.assign(counterOf(), { on: true, renders: {}, changedProps: {} });
}

/** Stops counting, and says what was counted since it started. */
export function stopCountingRenders(): RenderCounts {
  const counter = counterOf();
  counter.on = false;
  return { renders: { ...counter.renders }, changedProps: { ...counter.changedProps } };
}
