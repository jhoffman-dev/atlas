import { useEffect, useMemo, useState } from 'react';
import { archiveRefusal, isArchivedPath, type VaultPath } from '@atlas/domain';
import type { ArchiveOutcome } from '@atlas/application';
import type { BulkAction, RowSelection } from '@atlas/ui';
import type { ArchiveCommands } from './use-archive.ts';
import { batchSettled, useRowSelection } from './use-row-selection.ts';

/** A view's select mode: whether rows can be chosen, which are, and what can be done to them. */
export interface ViewChoosing {
  readonly on: boolean;
  readonly setOn: (on: boolean) => void;
  readonly selection: RowSelection;
  readonly actions: readonly BulkAction[];
  readonly count: number;
  readonly clear: () => void;
}

const notes = (n: number) => (n === 1 ? 'note' : `${n} notes`);
const mergeLabel = (n: number) => (n === 1 ? 'Merge into…' : `Merge ${n} people into…`);

/** Merging the people a People view's rows chose (#464). */
export interface ChosenPeopleMerge {
  /** Asks who to merge these people into, then shows what the merge does. */
  readonly mergeMany: (paths: readonly VaultPath[]) => void;
  /** Says which people are chosen now, for ⌘K's "Merge selected people…". */
  readonly noteChosen: (paths: readonly VaultPath[]) => void;
}

/**
 * Choosing a view's rows to archive or unarchive them together (P23-03).
 * Leaving select mode, or the view, lets go of the choice.
 */
export function useViewChoosing({
  viewKey,
  commands,
  people: merging,
}: {
  viewKey: string;
  commands: ArchiveCommands;
  /** Given for a view of people: its chosen rows can be merged into another person. */
  people?: ChosenPeopleMerge;
}): ViewChoosing {
  const [on, setOn] = useState(false);
  const { selection, chosen, clear, beginBatch } = useRowSelection(`${viewKey}:${String(on)}`);

  useEffect(() => setOn(false), [viewKey]);
  // ⌘K reads the choice of the People view shown last; letting go says none.
  useEffect(() => {
    if (merging === undefined) return;
    merging.noteChosen(chosen as VaultPath[]);
    return () => merging.noteChosen([]);
  }, [merging, chosen]);

  const actions = useMemo(() => {
    const paths = chosen as VaultPath[];
    const archived = paths.filter(isArchivedPath);
    const archivable = paths.filter((path) => archiveRefusal(path) === null);
    // The choice stays until the batch is done, then loses what went; rows
    // chosen meanwhile stay, and what could not go is chosen again.
    const run =
      (
        given: readonly VaultPath[],
        work: (given: readonly VaultPath[]) => Promise<ArchiveOutcome | null>,
      ) =>
      () => {
        const settle = beginBatch();
        void work(given)
          .catch((cause: unknown) => {
            // The commands say their own failures; one that throws instead is
            // logged, and settles as a batch that did not start.
            console.error('A batch could not be run:', cause);
            return null;
          })
          .then((outcome) => settle(batchSettled(outcome, given)));
      };
    const offered: BulkAction[] = [];
    if (merging !== undefined && paths.length > 0) {
      offered.push({
        label: mergeLabel(paths.length),
        onRun: () => merging.mergeMany(paths),
      });
    }
    if (archivable.length > 0) {
      offered.push({
        label: `Archive ${notes(archivable.length)}`,
        onRun: run(archivable, commands.archive),
        disabled: commands.busy,
      });
    }
    if (archived.length > 0) {
      offered.push({
        label: `Unarchive ${notes(archived.length)}`,
        onRun: run(archived, commands.unarchive),
        disabled: commands.busy,
      });
    }
    return offered;
  }, [chosen, commands, beginBatch, merging]);

  return { on, setOn, selection, actions, count: chosen.length, clear };
}
