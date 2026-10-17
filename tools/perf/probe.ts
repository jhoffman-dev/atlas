import type { Page } from '@playwright/test';

/**
 * What the performance harness reads off the page while an action runs (#217):
 * when the input arrived, when the page showed its answer, how long the main
 * thread went without drawing a frame, and every host command sent meanwhile.
 *
 * WebKit — the engine the app ships in — has no Long Tasks API, so a blocked
 * main thread is seen the way the person sees it: as a frame that came late.
 * Every `requestAnimationFrame` is timed, and the longest gap between two is
 * the longest the window could not answer.
 */

/** One host command, as the page sent it and heard back. */
export interface HostCall {
  readonly command: string;
  readonly start: number;
  readonly end: number | null;
}

/** One action, measured. Times are milliseconds. */
export interface Measured {
  /** From the input arriving to the frame that shows the page ready for the next one. */
  readonly inputToReady: number;
  /** The longest the main thread went without a frame, from the input until the work settled. */
  readonly longestFrame: number;
  /** Frames longer than 50 ms in that span: the page's long tasks, as WebKit can see them. */
  readonly longFrames: number;
  /**
   * From the input until no host command had been in flight for a while: the
   * work behind the action. Null when the next action was not waited for.
   */
  readonly settled: number | null;
  /** Host commands sent while the page was not yet ready: what the input path waited on. */
  readonly callsBeforeReady: number;
  /** Every host command sent until it settled, by name. */
  readonly calls: Readonly<Record<string, number>>;
  /** Time the host spent answering, summed over those commands. */
  readonly hostMs: number;
}

interface ProbeWindow {
  __perf: {
    frames: number[];
    calls: HostCall[];
    armedAt: number | null;
    inputAt: number | null;
    readyAt: number | null;
  };
}

/**
 * Starts timing frames and host commands from the first script the page runs.
 * Install after `installHost`, so it wraps the stand-in host's IPC.
 */
export async function installProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (window !== window.top) return;
    const perf: ProbeWindow['__perf'] = {
      frames: [],
      calls: [],
      armedAt: null,
      inputAt: null,
      readyAt: null,
    };
    (window as unknown as ProbeWindow).__perf = perf;
    const tick = (at: number) => {
      // Only while an action is being measured, so an idle page keeps no history.
      if (perf.armedAt !== null) perf.frames.push(at);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: { invoke: (command: string, ...rest: unknown[]) => Promise<unknown> };
      }
    ).__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    internals.invoke = (command, ...rest) => {
      if (perf.armedAt === null || command.startsWith('plugin:event')) {
        return invoke(command, ...rest);
      }
      const call = { command, start: performance.now(), end: null as number | null };
      perf.calls.push(call);
      return invoke(command, ...rest).finally(() => {
        call.end = performance.now();
      });
    };
    const firstInput = () => {
      if (perf.armedAt !== null && perf.inputAt === null) perf.inputAt = performance.now();
    };
    for (const kind of ['pointerdown', 'keydown', 'input', 'change']) {
      window.addEventListener(kind, firstInput, { capture: true });
    }
  });
}

/** How long the host has to be quiet before the work behind an action counts as done. */
const QUIET_MS = 400;
/** The longest the work behind one action is waited on. */
const SETTLE_LIMIT_MS = 20_000;

/**
 * Measures one action: `act` gives the input, as the person would, and
 * `ready` is true in the page once the page is ready for the next one.
 */
export async function measure<Arg>(
  page: Page,
  {
    act,
    ready,
    arg,
    settle = true,
  }: {
    act: () => Promise<void>;
    ready: (arg: Arg) => boolean;
    arg: Arg;
    /** Whether to wait for the work behind the action; false goes on at once, as a person working quickly does. */
    settle?: boolean;
  },
): Promise<Measured> {
  await page.evaluate(() => {
    const perf = (window as unknown as ProbeWindow).__perf;
    Object.assign(perf, { frames: [], calls: [], inputAt: null, readyAt: null });
    perf.armedAt = performance.now();
  });
  await act();
  await page.waitForFunction(
    ({ source, given }) => {
      const perf = (window as unknown as ProbeWindow).__perf;
      // The predicate crosses into the page as its source, to be called inside this one.
      const isReady = new Function(`return (${source})`)() as (arg: unknown) => boolean;
      if (!isReady(given)) return false;
      perf.readyAt = performance.now();
      return true;
    },
    { source: ready.toString(), given: arg as unknown },
    { polling: 'raf', timeout: 60_000 },
  );
  if (settle) await waitUntilQuiet(page);
  return page.evaluate((settled) => {
    const perf = (window as unknown as ProbeWindow).__perf;
    const inputAt = perf.inputAt ?? perf.armedAt ?? 0;
    const readyAt = perf.readyAt ?? inputAt;
    const lastEnd = Math.max(readyAt, ...perf.calls.map((call) => call.end ?? readyAt));
    const frames = perf.frames.filter((at) => at >= inputAt);
    const gaps = frames.slice(1).map((at, index) => at - (frames[index] ?? at));
    const calls: Record<string, number> = {};
    for (const call of perf.calls) calls[call.command] = (calls[call.command] ?? 0) + 1;
    perf.armedAt = null;
    return {
      inputToReady: readyAt - inputAt,
      longestFrame: Math.max(0, ...gaps),
      longFrames: gaps.filter((gap) => gap > 50).length,
      settled: settled ? lastEnd - inputAt : null,
      callsBeforeReady: perf.calls.filter((call) => call.start <= readyAt).length,
      calls,
      hostMs: perf.calls.reduce((sum, call) => sum + ((call.end ?? call.start) - call.start), 0),
    };
  }, settle);
}

/**
 * Waits until no host command is in flight, and none has ended nor (with the
 * render counter on) React committed for `QUIET_MS`, or the limit passes.
 * Polled in the page, on its own timers, so a timer the app set to fire
 * sooner than that runs first however busy the machine is.
 */
async function waitUntilQuiet(page: Page): Promise<void> {
  await page.waitForFunction(
    ({ quiet, limit }) => {
      const perf = (window as unknown as ProbeWindow).__perf;
      const counter = (window as unknown as { __renderCounter?: { lastCommitAt: number | null } })
        .__renderCounter;
      const now = performance.now();
      if (now - (perf.armedAt ?? now) > limit) return true;
      if (perf.calls.some((call) => call.end === null)) return false;
      const lastEnd = Math.max(
        perf.readyAt ?? 0,
        counter?.lastCommitAt ?? 0,
        ...perf.calls.map((call) => call.end ?? 0),
      );
      return now - lastEnd >= quiet;
    },
    { quiet: QUIET_MS, limit: SETTLE_LIMIT_MS },
    { polling: 100, timeout: SETTLE_LIMIT_MS + 5_000 },
  );
}

/** Waits until the app has sent the host nothing for a while: the work of opening, or of the last action, is done. */
export async function waitForQuiet(page: Page): Promise<void> {
  await measure(page, { act: () => Promise.resolve(), arg: null, ready: () => true });
}

/** The value at a percentile of a sample, nearest-rank. */
export function percentile(sample: readonly number[], p: number): number {
  if (sample.length === 0) return 0;
  const sorted = [...sample].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank] ?? 0;
}
