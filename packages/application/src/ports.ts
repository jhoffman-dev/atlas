/** Where raw application identity comes from — the Tauri runtime, or a static value in a browser. */
export interface AppInfoPort {
  /** `build` is the commit the build was made from, when the build knows it. */
  read(): Promise<{ name: string; version: string; build?: string | null }>;
}

/**
 * Where chance comes from. A port rather than `Math.random()` so that what is
 * drawn — a new block id — can be fixed in a test.
 */
export interface Rng {
  /** A number in [0, 1). */
  next(): number;
}

/**
 * What day it is, where the person is.
 *
 * A port rather than `new Date()` so that anything named by the date — today's
 * note — can be tested on a day of the test's choosing.
 */
export interface Clock {
  /** Today in the person's own timezone, as `YYYY-MM-DD`. */
  today(): string;
  /** Now, in milliseconds since the epoch: when something ran, as a report dates it. */
  now(): number;
  /**
   * Now on the person's wall clock, as `YYYY-MM-DDTHH:MM:SS` — what "daily at
   * 03:00" is measured against, and what an automation's log dates a run by.
   */
  localNow(): string;
}
