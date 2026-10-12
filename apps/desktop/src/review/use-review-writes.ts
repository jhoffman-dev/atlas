import { useCallback, useRef, useState } from 'react';
import type { VaultPath } from '@atlas/domain';
import {
  ChangedSinceError,
  TaskRuleRefusedError,
  type ActivityLog,
  type Clock,
  type MarkdownPort,
  type PropertyChanges,
  type VaultFsPort,
} from '@atlas/application';
import { withGiveUpRecorded } from '../activity/with-give-up-recorded.ts';
import type { OpenEditors } from '../panes/open-editors.ts';
import { errorMessage } from '../query/error-message.ts';
import { writeNoteProperties } from '../query/use-view-writes.ts';

export interface ReviewWritesOptions {
  readonly ports: { readonly fs: VaultFsPort; readonly markdown: MarkdownPort };
  /** A note open in a pane is written through the pane, as every view writes it. */
  readonly editors: OpenEditors;
  readonly clock: Pick<Clock, 'today'>;
  /** Re-reads the tree and the index once an item has been acted on. */
  readonly onSettled: () => void;
  /** Where a write the page gives up on is recorded; a refusal is not. */
  readonly activity: Pick<ActivityLog, 'inOpenVault'>;
}

/** What a write refuses the person, rather than fails at: shown to act on, and no fault. */
const REFUSALS = [TaskRuleRefusedError, ChangedSinceError] as const;

/**
 * The quick actions of the weekly review and the Today page: one at a time,
 * each a write every other view makes, held to the task rules where it lands.
 * Why the last one could not be done is kept for the page to say.
 */
export function useReviewWrites({
  ports,
  editors,
  clock,
  onSettled,
  activity,
}: ReviewWritesOptions) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // `busy` reaches the page a render late; two presses in one tick would both see it false.
  const running = useRef(false);

  /** Whether the action was done: false when another was running, or it could not be. */
  const act = useCallback(
    async (action: () => Promise<unknown>): Promise<boolean> => {
      if (running.current) return false;
      running.current = true;
      setBusy(true);
      setProblem(null);
      try {
        await action();
        onSettled();
        return true;
      } catch (cause) {
        setProblem(errorMessage(cause));
        return false;
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [onSettled],
  );

  const write = useCallback(
    (path: VaultPath, values: PropertyChanges) => {
      const edit = { activity, write: 'edit', path, refusal: REFUSALS } as const;
      const { fs, markdown } = ports;
      // Dated by the page's own clock, the one its sections were read on.
      const today = clock.today();
      return act(() =>
        withGiveUpRecorded(edit, () =>
          writeNoteProperties({ editors, fs, markdown, path, values, today }),
        ),
      );
    },
    [act, activity, clock, editors, ports],
  );

  return { busy, problem, setProblem, act, write };
}
