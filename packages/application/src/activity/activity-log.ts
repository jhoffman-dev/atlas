import {
  ACTIVITY_REPEAT_MS,
  EVERY_ACTIVITY,
  activityEvent,
  activityRepeatKey,
  activityText,
  boundActivity,
  filterActivity,
  hasExpiredActivity,
  isOverActivityBound,
  parseActivityLog,
  repeatsActivity,
  type ActivityEvent,
  type ActivityReport,
} from '@atlas/domain';
import type { Clock } from '../ports.ts';
import type { ActivityLog, ActivityNews, ActivityRecorder, ActivityStore } from './ports.ts';

export interface ActivityLogOptions {
  readonly store: ActivityStore;
  readonly clock: Pick<Clock, 'now'>;
  /** The open vault's root, which names its log; null while none is open. */
  readonly vault: () => string | null;
  /** Runs the write of what has been recorded, a moment later — a timer in the app, by hand in a test. */
  readonly schedule: (write: () => void) => void;
  /** Told when the log itself could not be written, or a listener failed: nothing else can say so. */
  readonly onError: (cause: unknown) => void;
}

/** How many remembered lines a vault may hold before those past their minute are let go. */
const REPEAT_MEMORY = 512;

/**
 * The Activity log (U-28), kept cheaply: lines recorded together are written
 * in one append a moment later, so recording never waits on the disk; the
 * same line again within a minute is left out, found by one look-up; and the
 * file is cut back to its bound when an append takes it over, or when a read
 * finds expired lines in it. Listeners are handed the lines kept, not sent to
 * read the file again.
 *
 * Each line is kept for the vault its recorder names — the one open when it
 * was recorded, unless the work made its recorder earlier — even if the write
 * happens after a switch. Writes, trims and reads go one at a time.
 */
export function createActivityLog(options: ActivityLogOptions): ActivityLog & {
  /** Writes what has been recorded now, rather than when it is scheduled. */
  flush(): Promise<void>;
} {
  const { store, clock } = options;
  const pending = new Map<string, ActivityEvent[]>();
  const repeats = new Map<string, RepeatMemory>();
  const listeners = new Set<(news: ActivityNews) => void>();
  let scheduled = false;
  let queue: Promise<unknown> = Promise.resolve();

  /** Runs after everything before it, whether that worked or not. */
  const inTurn = <Result>(task: () => Promise<Result>): Promise<Result> => {
    const next = queue.then(task, task);
    // The queue only orders; each caller gets its own task's outcome.
    queue = next.catch(() => undefined);
    return next;
  };

  const tell = (news: ActivityNews) => {
    for (const listener of listeners) {
      try {
        listener(news);
      } catch (cause) {
        // One listener's failure must not keep the lines from the others, nor escape the write.
        options.onError(cause);
      }
    }
  };

  const write = async (batches: ReadonlyArray<[string, ActivityEvent[]]>) => {
    for (const [vault, events] of batches) {
      try {
        const size = await store.append({ vault, text: activityText(events) });
        if (isOverActivityBound(size))
          await trim(vault, parseActivityLog(await store.read({ vault })));
      } catch (cause) {
        options.onError(cause);
        continue;
      }
      tell({ vault, events });
    }
  };

  const trim = async (vault: string, events: readonly ActivityEvent[]) => {
    const kept = boundActivity(events, clock.now());
    await store.replace({ vault, text: activityText(kept) });
    return kept;
  };

  const flush = (): Promise<void> => {
    scheduled = false;
    const batches = [...pending];
    pending.clear();
    if (batches.length === 0) return inTurn(async () => undefined);
    return inTurn(() => write(batches));
  };

  const recordIn = (vault: string | null, report: ActivityReport) => {
    // No vault: there is no log to keep it in.
    if (vault === null) return;
    const event = activityEvent({ ...report, at: clock.now() });
    const memory = repeats.get(vault) ?? newRepeatMemory();
    repeats.set(vault, memory);
    if (isRepeat(memory, event)) return;
    pending.set(vault, [...(pending.get(vault) ?? []), event]);
    if (scheduled) return;
    scheduled = true;
    options.schedule(() => void flush());
  };

  const recorderFor = (vault: string | null): ActivityRecorder => ({
    record: (report) => recordIn(vault, report),
  });

  return {
    record: (report) => recordIn(options.vault(), report),
    inOpenVault: () => recorderFor(options.vault()),
    inVault: (vault) => recorderFor(vault),
    async read(query = EVERY_ACTIVITY) {
      await flush();
      const vault = options.vault();
      if (vault === null) return [];
      return inTurn(async () => {
        const events = parseActivityLog(await store.read({ vault }));
        const kept = hasExpiredActivity(events, clock.now()) ? await trim(vault, events) : events;
        return filterActivity(kept, query);
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    flush,
  };
}

/** The last line said of each kind, by what it says: a repeat is one look-up, not a scan. */
interface RepeatMemory {
  readonly lines: Map<string, ActivityEvent>;
  /** How many lines may be remembered before those past their minute are let go. */
  forgetAt: number;
}

function newRepeatMemory(): RepeatMemory {
  return { lines: new Map(), forgetAt: REPEAT_MEMORY };
}

/**
 * Whether the line repeats one said within a minute; remembers it when not.
 * A repeat is not remembered, so a line said every few seconds is kept once a
 * minute rather than never again.
 */
function isRepeat(memory: RepeatMemory, event: ActivityEvent): boolean {
  const key = activityRepeatKey(event);
  const earlier = memory.lines.get(key);
  if (earlier !== undefined && repeatsActivity(earlier, event)) return true;
  memory.lines.set(key, event);
  if (memory.lines.size > memory.forgetAt) forgetPast(memory, event.at);
  return false;
}

/** Lets go of lines no later one could repeat; doubles the room when a burst keeps them all. */
function forgetPast(memory: RepeatMemory, now: number): void {
  for (const [key, line] of memory.lines) {
    if (Math.abs(now - line.at) >= ACTIVITY_REPEAT_MS) memory.lines.delete(key);
  }
  memory.forgetAt = Math.max(REPEAT_MEMORY, memory.lines.size * 2);
}
