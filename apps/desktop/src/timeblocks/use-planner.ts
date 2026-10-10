import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createVaultPath,
  messageWithoutPaths,
  newBlockLength,
  noteTitle,
  slotValue,
  type ObjectType,
  type TrayTask,
} from '@atlas/domain';
import {
  addTaskToBlock,
  createBlockForTask,
  readPlanTray,
  undoScheduling,
  type IndexPort,
  type MarkdownPort,
  type Scheduling,
  type VaultFsPort,
  type WriteNoteProperties,
} from '@atlas/application';
import type { PlanDrop, Planner } from '@atlas/ui';
import type { OpenEditors } from '../panes/open-editors.ts';
import { writeNoteProperties } from '../query/use-view-writes.ts';
import { localToday } from '../today.ts';

/** The last drop, in the vault it was made in, so another vault's is never undone here. */
interface LastDrop {
  readonly vault: string | null;
  readonly scheduling: Scheduling;
  readonly title: string;
}

/** What the tray says of a drop, beside its Undo. */
function saidOf({ scheduling, title }: LastDrop): string {
  const block = noteTitle(scheduling.block);
  return scheduling.kind === 'created'
    ? `Planned ${title} in ${block}.`
    : `Added ${title} to ${block}.`;
}

/**
 * Planning the day on a calendar of blocks (P31-02): the next actions for the
 * tray, read again whenever the index changes; a task let go on empty time
 * made into a block sized to what it still needs, or linked into the block it
 * was let go on; and the last drop, to undo. Every write goes through the
 * task rules' chokepoints — a new note through `createNote`, a block's tasks
 * through a pane holding it or `setNoteProperties`. Null when `active` is
 * false: the calendar is not one of blocks, and nothing is read.
 */
export function usePlanner({
  active,
  vault,
  fs,
  markdown,
  index,
  editors,
  types,
  notePaths,
  indexKey,
  onChanged,
}: {
  active: boolean;
  vault: string | null;
  fs: VaultFsPort;
  markdown: MarkdownPort;
  index: IndexPort;
  editors: OpenEditors;
  types: readonly ObjectType[];
  notePaths: readonly string[];
  indexKey: string;
  /** After a block is written, so the calendar and the tray read it. */
  onChanged: () => void;
}): Planner | null {
  const [tasks, setTasks] = useState<readonly TrayTask[] | null>(null);
  const [readProblem, setReadProblem] = useState<string | null>(null);
  const [writeProblem, setWriteProblem] = useState<string | null>(null);
  const [last, setLast] = useState<LastDrop | null>(null);
  const paths = useMemo(() => notePaths.map(createVaultPath), [notePaths]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    readPlanTray({ index, types, notePaths })
      .then((read) => {
        if (cancelled) return;
        setTasks(read);
        setReadProblem(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setReadProblem(`The next actions could not be read: ${messageWithoutPaths(cause)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [active, index, types, notePaths, indexKey]);

  const writeProperties = useCallback<WriteNoteProperties>(
    ({ path, values }) => writeNoteProperties({ editors, fs, markdown, path, values }),
    [editors, fs, markdown],
  );

  /** Runs a write, then has everything read again; a failure is said in the tray. */
  const settle = useCallback(
    (write: Promise<LastDrop | null>, onDone: (drop: LastDrop | null) => void) => {
      setWriteProblem(null);
      write
        .then((drop) => {
          onDone(drop);
          onChanged();
        })
        .catch((cause: unknown) => setWriteProblem(messageWithoutPaths(cause)));
    },
    [onChanged],
  );

  const place = useCallback(
    (drop: PlanDrop) => {
      const task = { path: createVaultPath(drop.task.path), title: drop.task.title };
      const scheduled =
        drop.kind === 'time'
          ? createBlockForTask({
              fs,
              markdown,
              types,
              task,
              start: slotValue(drop.date, drop.minutes),
              minutes: newBlockLength(drop.task.schedule),
              notePaths: paths,
              today: localToday(),
            })
          : addTaskToBlock({
              writeProperties,
              block: createVaultPath(drop.block),
              task: task.path,
              notePaths: paths,
            });
      const kept = scheduled.then((scheduling) =>
        scheduling === null ? null : { vault, scheduling, title: task.title },
      );
      // A drop onto a block already holding the task did nothing: the last one stays undoable.
      settle(kept, (drop) => {
        if (drop !== null) setLast(drop);
      });
    },
    [fs, markdown, types, paths, writeProperties, vault, settle],
  );

  const undo = useMemo(() => {
    if (last === null || last.vault !== vault) return null;
    const run = () =>
      settle(
        undoScheduling({
          scheduling: last.scheduling,
          fs,
          index,
          writeProperties,
          notePaths: paths,
        }).then(() => null),
        () => setLast(null),
      );
    return { said: saidOf(last), run };
  }, [last, vault, settle, fs, index, writeProperties, paths]);

  const problem = writeProblem ?? readProblem;
  return useMemo(
    () => (active ? { tasks, problem, place, undo } : null),
    [active, tasks, problem, place, undo],
  );
}
