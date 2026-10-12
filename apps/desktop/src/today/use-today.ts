import { useCallback, useEffect, useState } from 'react';
import {
  TASK_KEYS,
  taskDeferral,
  taskTypeOf,
  type ObjectType,
  type VaultPath,
} from '@atlas/domain';
import {
  archiveTaskChange,
  readToday,
  undoableChange,
  type IndexPort,
  type PropertyChanges,
  type TodayReport,
  type UndoableChange,
} from '@atlas/application';
import type { TodayAction } from '@atlas/ui';
import { errorMessage } from '../query/error-message.ts';
import { useReviewWrites, type ReviewWritesOptions } from '../review/use-review-writes.ts';

export interface TodayOptions extends Omit<ReviewWritesOptions, 'ports' | 'clock'> {
  readonly ports: ReviewWritesOptions['ports'] & { readonly index: Pick<IndexPort, 'query'> };
  /** Today's date, and now: the day the page turns on comes from here alone. */
  readonly clock: Parameters<typeof readToday>[0]['clock'];
  /** The vault's types: the page is offered once the vault has tasks. */
  readonly types: readonly ObjectType[];
  /** Changes when the index does, so the page shows what it now holds. */
  readonly indexKey: string;
  /** The vault that is open: what was read of one vault is never shown, or undone, in another. */
  readonly vaultKey: string | null;
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
 * the weekly review's writes, each remembered so the last can be taken back.
 * A row moves once the index has the change; nothing is reloaded.
 */
export function useToday(options: TodayOptions) {
  const { ports, editors, clock, types, vaultKey, indexKey, open, onSettled, activity } = options;
  const indexReady = options.indexReady ?? true;
  const [read, setRead] = useState<ReadFrom | null>(null);
  const [last, setLast] = useState<LastChange | null>(null);
  const { busy, problem, setProblem, write } = useReviewWrites({
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
    readToday({ index, fs, markdown, clock })
      .then((report) => {
        if (!cancelled) setRead({ index, vaultKey, report, error: null });
      })
      .catch((cause: unknown) => {
        if (!cancelled) setRead({ index, vaultKey, report: null, error: errorMessage(cause) });
      });
    return () => {
      cancelled = true;
    };
  }, [ports, clock, vaultKey, indexKey, indexReady, open]);

  // Only what was read of the vault now open: another vault's paths are not this one's.
  const ofThisVault = (from: { index: unknown; vaultKey: string | null }) =>
    from.index === ports.index && from.vaultKey === vaultKey;
  const current = read !== null && ofThisVault(read) ? read : null;
  const undoable = last !== null && ofThisVault(last) ? last : null;

  const change = useCallback(
    async ({ path, title, action, values }: Change) => {
      const remembered = undoableChange(values);
      setLast(null);
      const written = await write(path, remembered.values);
      if (written) {
        setLast({ index: ports.index, vaultKey, path, title, action, change: remembered });
      }
    },
    [write, ports, vaultKey],
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
  const undo = useCallback(() => {
    const values = undoable?.change.undo() ?? null;
    if (undoable === null || values === null) return;
    setLast(null);
    void write(undoable.path, values);
  }, [undoable, write]);
  const dismiss = useCallback(() => setLast(null), []);

  return {
    /** Whether the vault has tasks, which is when the page's sidebar row shows. */
    shown: taskTypeOf(types) !== null,
    page: {
      today: current?.report ?? null,
      error: current?.error ?? null,
      busy,
      problem,
      notice:
        undoable === null
          ? null
          : { title: undoable.title, action: undoable.action, onUndo: undo, onDismiss: dismiss },
      onDone: done,
      onSetStatus: setStatus,
      onDefer: defer,
    },
  };
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

/** The last change the page wrote, the vault it was written in, and how to take it back. */
interface LastChange extends Row {
  readonly index: unknown;
  readonly vaultKey: string | null;
  readonly action: TodayAction;
  readonly change: UndoableChange;
}

/** A read of the page, and the index it was read from. */
interface ReadFrom {
  readonly index: unknown;
  readonly vaultKey: string | null;
  readonly report: TodayReport | null;
  readonly error: string | null;
}
