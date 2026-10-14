import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TASK_KEYS,
  taskDeferral,
  tasksStartInInbox,
  taskTypeOf,
  type ObjectType,
  type TaskAsRead,
  type VaultPath,
} from '@atlas/domain';
import {
  archiveTaskChange,
  changeUndoably,
  readToday,
  whileAsRead,
  type IndexPort,
  type PropertyChanges,
  type TodayReport,
  type UndoableChange,
} from '@atlas/application';
import type { TodayAction } from '@atlas/ui';
import { errorMessage } from '../query/error-message.ts';
import { useReviewWrites, type ReviewWritesOptions } from '../review/use-review-writes.ts';

/** How often an open page asks the clock whether the day has turned. */
const DAY_CHECK_MS = 60_000;

export interface TodayOptions extends Omit<ReviewWritesOptions, 'ports' | 'clock'> {
  readonly ports: ReviewWritesOptions['ports'] & { readonly index: Pick<IndexPort, 'query'> };
  /** Today's date, and now: the day the page turns on comes from here alone. */
  readonly clock: Parameters<typeof readToday>[0]['clock'];
  /** The vault's types: the page is offered once the vault has tasks. */
  readonly types: readonly ObjectType[];
  /** The vault that is open: what was read of one vault is never shown, or undone, in another. */
  readonly vaultKey: string | null;
  /** Changes when the index does, so the page shows what it now holds. */
  readonly indexKey: string;
  /**
   * Whether the index is ready to be asked; while it is not, nothing is read.
   * What was last read of this vault stays on the page meanwhile: the index
   * is refreshed after every change to a file, the page's own included, and
   * a page that emptied each time would lose its place, its focus and any
   * open menu. Ready unless said.
   */
  readonly indexReady?: boolean;
  /** Whether the page is showing, which is when it is read. */
  readonly open: boolean;
}

/**
 * The Today page (#111): the day as the index has it, and its row actions —
 * the weekly review's writes, the last of them remembered so it can be taken
 * back. A row moves once the index has the change; nothing is reloaded.
 *
 * A row acts on what it showed. The page is always a little behind the
 * files, so an action is made only while the task still says what its row
 * read, and a row that has been acted on takes no other action until a read
 * made after the write is on the page.
 */
export function useToday(options: TodayOptions) {
  const { ports, editors, clock, types, vaultKey, indexKey, open, onSettled, activity } = options;
  const indexReady = options.indexReady ?? true;
  const [read, setRead] = useState<ReadFrom | null>(null);
  const [last, setLast] = useState<LastChange | null>(null);
  const [settling, setSettling] = useState<Settling>(NOTHING_SETTLING);
  // Counts the reads begun, so a row can tell one made after its write from one already under way.
  const readsBegun = useRef(0);
  const day = useDayOf(clock, open);
  // The types the sidebar's Inbox count is read with, so the page's Inbox link counts the same.
  const startInInbox = tasksStartInInbox(types);
  const { busy, problem, setProblem, actOn } = useReviewWrites({
    ports,
    editors,
    clock,
    onSettled,
    activity,
  });

  useEffect(() => {
    if (!open || !indexReady) return;
    let cancelled = false;
    const { index, fs, markdown } = ports;
    readsBegun.current += 1;
    const begun = readsBegun.current;
    const land = (landed: Pick<ReadFrom, 'report' | 'error'>) => {
      if (cancelled) return;
      setRead({ index, vaultKey, ...landed });
      setSettling((rows) => withoutSettledBy(rows, begun));
    };
    readToday({ index, fs, markdown, clock, tasksStartInInbox: startInInbox })
      .then((report) => land({ report, error: null }))
      .catch((cause: unknown) => land({ report: null, error: errorMessage(cause) }));
    return () => {
      cancelled = true;
    };
    // `day` is here to read again when it turns; the read takes the day from the clock itself.
  }, [ports, clock, vaultKey, indexKey, indexReady, open, day, startInInbox]);

  // Only what was read of the vault now open: another vault's paths are not this one's.
  const ofThisVault = (from: OfAVault) => sameVault(from, { index: ports.index, vaultKey });
  const current = read !== null && ofThisVault(read) ? read : null;
  const undoable = last !== null && ofThisVault(last) ? last : null;
  const rows = useMemo(() => rowsAsRead(current?.report ?? null), [current]);
  const { index: indexOpen } = ports;
  const settlingHere = useMemo(
    () => new Set(sameVault(settling, { index: indexOpen, vaultKey }) ? settling.rows.keys() : []),
    [settling, indexOpen, vaultKey],
  );
  const knownHere = sameVault(settling, { index: indexOpen, vaultKey })
    ? settling.known
    : NONE_KNOWN;

  const change = useCallback(
    async ({ path, title, action, values }: Change) => {
      if (settlingHere.has(path)) return;
      const { fs, markdown, index } = ports;
      const row = knownHere.get(path) ?? rows.get(path);
      const guarded = row === undefined ? values : whileAsRead({ values, row });
      let made: UndoableChange | null = null;
      await actOn(path, async (put) => {
        made = await changeUndoably({
          fs,
          markdown,
          path,
          write: (readAt) => put(guarded, readAt),
        });
      });
      // Only now: an action that was refused or failed leaves the earlier undo on offer.
      if (made === null) return;
      // A change that could not be read back was still made: nothing to offer, and the row settles.
      const { undo: takeBack, was: before } = made as UndoableChange;
      setLast(
        takeBack === null
          ? null
          : { index, vaultKey, path, title, action, undo: takeBack, was: before },
      );
      const since = readsBegun.current;
      setSettling((was) => ({
        index,
        vaultKey,
        rows: new Map([...(sameVault(was, { index, vaultKey }) ? was.rows : []), [path, since]]),
        known: sameVault(was, { index, vaultKey }) ? was.known : new Map(),
      }));
    },
    [actOn, ports, vaultKey, rows, knownHere, settlingHere],
  );

  const done = useCallback(
    (task: Row) => void change({ ...task, action: { kind: 'done' }, values: archiveTaskChange() }),
    [change],
  );
  const setStatus = useCallback(
    ({ status, ...task }: Row & { status: string }) =>
      void change({
        ...task,
        action: { kind: 'move', status },
        values: { [TASK_KEYS.status]: status },
      }),
    [change],
  );
  const defer = useCallback(
    ({ days, ...task }: Row & { days: number }) => {
      const deferral = taskDeferral({ today: clock.today(), days });
      if (deferral === null) setProblem('Today’s date could not be read, so nothing was deferred.');
      else void change({ ...task, action: { kind: 'defer', days }, values: deferral });
    },
    [change, clock, setProblem],
  );
  const undo = useCallback(async () => {
    if (undoable === null) return;
    const { path } = undoable;
    const undone = await actOn(path, (put) => put(undoable.undo));
    // An undo that could not be written stays on offer, to be tried again.
    if (!undone) return;
    setLast((was) => (was === undoable ? null : was));
    // The task is back as it was, so its row can be acted on again — as what the
    // file held before the change, which the page's own read may be behind.
    setSettling((was) => ({
      ...was,
      rows: new Map([...was.rows].filter(([row]) => row !== path)),
      known: new Map([...was.known, [path, undoable.was]]),
    }));
  }, [undoable, actOn]);
  const dismiss = useCallback(() => setLast(null), []);
  // One notice per change, kept across renders, so its bar's time runs from when it was shown (#165).
  const undoNow = useRef(undo);
  useEffect(() => {
    undoNow.current = undo;
  });
  const notice = useMemo(
    () =>
      undoable === null
        ? null
        : {
            title: undoable.title,
            action: undoable.action,
            onUndo: () => void undoNow.current(),
            onDismiss: dismiss,
          },
    [undoable, dismiss],
  );

  return {
    /** Whether the vault has tasks, which is when the page's sidebar row shows. */
    shown: taskTypeOf(types) !== null,
    page: {
      today: current?.report ?? null,
      error: current?.error ?? null,
      busy,
      problem,
      settling: settlingHere,
      notice,
      onDone: done,
      onSetStatus: setStatus,
      onDefer: defer,
    },
  };
}

/**
 * The clock's day, asked again each minute and whenever the window is looked
 * at again, while the page is open: a page left open overnight — the Mac
 * asleep, timers and all — turns to the new day when it is next seen.
 */
function useDayOf(clock: Pick<TodayOptions['clock'], 'today'>, open: boolean): string {
  const [day, setDay] = useState(() => clock.today());
  useEffect(() => {
    if (!open) return;
    const ask = () => setDay(clock.today());
    ask();
    const timer = setInterval(ask, DAY_CHECK_MS);
    window.addEventListener('focus', ask);
    document.addEventListener('visibilitychange', ask);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', ask);
      document.removeEventListener('visibilitychange', ask);
    };
  }, [clock, open]);
  return day;
}

/** What each row on the page was read as, by its task's path. */
function rowsAsRead(report: TodayReport | null): ReadonlyMap<VaultPath, TaskAsRead> {
  const rows = new Map<VaultPath, TaskAsRead>();
  for (const section of report?.sections ?? []) {
    for (const group of section.groups) {
      for (const { path, status, due, defer } of group.tasks)
        rows.set(path, { status, due, defer });
    }
  }
  return rows;
}

/** The rows acted on and not yet read again, each with the count of reads begun when its write landed. */
interface Settling extends OfAVault {
  readonly rows: ReadonlyMap<VaultPath, number>;
  /**
   * What a row's task is known to be, where the page knows better than its
   * last read: a change the page made and took back leaves the task as the
   * file held it before. Forgotten once a read is on the page.
   */
  readonly known: ReadonlyMap<VaultPath, TaskAsRead>;
}

/** Something read or written in one vault, under one index. */
interface OfAVault {
  readonly index: unknown;
  readonly vaultKey: string | null;
}

const sameVault = (left: OfAVault, right: OfAVault) =>
  left.index === right.index && left.vaultKey === right.vaultKey;

const NONE_KNOWN: ReadonlyMap<VaultPath, TaskAsRead> = new Map();

const NOTHING_SETTLING: Settling = {
  index: null,
  vaultKey: null,
  rows: new Map(),
  known: new Map(),
};

/** Without the rows a read begun as the `begun`-th has caught up with: those written before it began. */
function withoutSettledBy(settling: Settling, begun: number): Settling {
  const rows = new Map([...settling.rows].filter(([, since]) => since >= begun));
  const unchanged = rows.size === settling.rows.size && settling.known.size === 0;
  return unchanged ? settling : { ...settling, rows, known: new Map() };
}

/** The row acted on: its task, and what the page calls it. */
interface Row {
  readonly path: VaultPath;
  readonly title: string;
}

interface Change extends Row {
  readonly action: TodayAction;
  readonly values: PropertyChanges;
}

/** The last change the page wrote, the vault it was written in, and the change that takes it back. */
interface LastChange extends Row, OfAVault {
  readonly action: TodayAction;
  /** The change that takes it back. */
  readonly undo: PropertyChanges;
  /** What the task was before, and is again once undone. */
  readonly was: TaskAsRead;
}

/** A read of the page, and the index it was read from. */
interface ReadFrom extends OfAVault {
  readonly report: TodayReport | null;
  readonly error: string | null;
}
