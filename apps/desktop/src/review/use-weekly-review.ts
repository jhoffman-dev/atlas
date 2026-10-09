import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PROJECT_STATUS_KEY,
  PROJECT_TYPE,
  REVIEW_ARCHIVE,
  reviewDeferral,
  TASK_KEYS,
  TASK_TYPE,
  type ObjectType,
  type VaultPath,
} from '@atlas/domain';
import {
  readWeeklyReview,
  type Clock,
  type IndexPort,
  type MarkdownPort,
  type VaultFsPort,
  type WeeklyReviewReport,
} from '@atlas/application';
import type { OpenEditors } from '../panes/open-editors.ts';
import { errorMessage } from '../query/error-message.ts';
import { writeNoteProperties } from '../query/use-view-writes.ts';

export interface WeeklyReviewOptions {
  readonly ports: {
    readonly index: Pick<IndexPort, 'query'>;
    readonly fs: VaultFsPort;
    readonly markdown: MarkdownPort;
  };
  /** A note open in a pane is written through the pane, as every view writes it. */
  readonly editors: OpenEditors;
  readonly clock: Pick<Clock, 'today' | 'now'>;
  /** The vault's types: the review is offered once tasks are, and a project moves among its type's statuses. */
  readonly types: readonly ObjectType[];
  /** Changes when the index does, so the review shows what it now holds. */
  readonly indexKey: string;
  /** Whether the review is showing, which is when it is read. */
  readonly open: boolean;
  /** Re-reads the tree and the index once an item has been acted on. */
  readonly onSettled: () => void;
  /** Moves a project into the Archive, as the app's Archive command does. */
  readonly archiveNote: (path: VaultPath) => Promise<unknown>;
}

/**
 * The weekly review page (P30-07): the review as the index has it, and its
 * quick actions. Each action is a write every other view makes — a status,
 * a defer, a finish, held to the task rules where the write lands — so an
 * item leaves its section once the index has the change.
 */
export function useWeeklyReview(options: WeeklyReviewOptions) {
  const { ports, editors, clock, types, indexKey, open, onSettled, archiveNote } = options;
  const [review, setReview] = useState<WeeklyReviewReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // `busy` reaches the page a render late; two presses in one tick would both see it false.
  const running = useRef(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    readWeeklyReview({ index: ports.index, clock })
      .then((read) => {
        if (cancelled) return;
        setReview(read);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [ports.index, clock, indexKey, open]);

  const act = useCallback(
    async (action: () => Promise<unknown>) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      setProblem(null);
      try {
        await action();
        onSettled();
      } catch (cause) {
        setProblem(errorMessage(cause));
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [onSettled],
  );

  const write = useCallback(
    (path: VaultPath, values: Readonly<Record<string, unknown>>) =>
      act(() =>
        writeNoteProperties({ editors, fs: ports.fs, markdown: ports.markdown, path, values }),
      ),
    [act, editors, ports.fs, ports.markdown],
  );

  const setStatus = useCallback(
    ({ path, status }: { path: VaultPath; status: string }) =>
      void write(path, { [TASK_KEYS.status]: status }),
    [write],
  );
  const setProjectStatus = useCallback(
    ({ path, status }: { path: VaultPath; status: string }) =>
      void write(path, { [PROJECT_STATUS_KEY]: status }),
    [write],
  );
  const defer = useCallback(
    (path: VaultPath) => {
      const deferral = reviewDeferral(clock.today());
      if (deferral === null) setProblem('Today’s date could not be read, so nothing was deferred.');
      else void write(path, deferral);
    },
    [write, clock],
  );
  const archiveTask = useCallback((path: VaultPath) => void write(path, REVIEW_ARCHIVE), [write]);
  const archiveProject = useCallback(
    (path: VaultPath) => void act(() => archiveNote(path)),
    [act, archiveNote],
  );

  const projectStatuses = useMemo(() => projectStatusesOf(types), [types]);
  return {
    /** Whether the vault has tasks to review, which is when its sidebar row shows. */
    shown: types.some((type) => type.name === TASK_TYPE),
    page: {
      review,
      error,
      projectStatuses,
      busy,
      problem,
      onSetStatus: setStatus,
      onSetProjectStatus: setProjectStatus,
      onDefer: defer,
      onArchiveTask: archiveTask,
      onArchiveProject: archiveProject,
    },
  };
}

/** The options of the project type's `status`, which the review moves a project among. */
function projectStatusesOf(types: readonly ObjectType[]): readonly string[] {
  const project = types.find((type) => type.name === PROJECT_TYPE);
  return project?.properties.find((property) => property.key === PROJECT_STATUS_KEY)?.options ?? [];
}
