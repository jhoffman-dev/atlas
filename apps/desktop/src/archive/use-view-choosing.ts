import { useEffect, useMemo, useState } from 'react';
import { archiveRefusal, isArchivedPath, type VaultPath } from '@atlas/domain';
import type { ArchiveOutcome } from '@atlas/application';
import type { BulkAction, RowSelection } from '@atlas/ui';
import type { ArchiveCommands } from './use-archive.ts';
import { stillChosen, useRowSelection } from './use-row-selection.ts';

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

/**
 * Choosing a view's rows to archive or unarchive them together (P23-03).
 * Leaving select mode, or the view, lets go of the choice.
 */
export function useViewChoosing({
  viewKey,
  commands,
}: {
  viewKey: string;
  commands: ArchiveCommands;
}): ViewChoosing {
  const [on, setOn] = useState(false);
  const { selection, chosen, clear, keepOnly } = useRowSelection(`${viewKey}:${String(on)}`);

  useEffect(() => setOn(false), [viewKey]);

  const actions = useMemo(() => {
    const paths = chosen as VaultPath[];
    const archived = paths.filter(isArchivedPath);
    const archivable = paths.filter((path) => archiveRefusal(path) === null);
    // The choice stays until the batch is done, then holds only what could not go.
    const run = (work: () => Promise<ArchiveOutcome | null>) => () => {
      void work().then((outcome) => keepOnly(stillChosen(outcome, paths)));
    };
    const offered: BulkAction[] = [];
    if (archivable.length > 0) {
      offered.push({
        label: `Archive ${notes(archivable.length)}`,
        onRun: run(() => commands.archive(archivable)),
        disabled: commands.busy,
      });
    }
    if (archived.length > 0) {
      offered.push({
        label: `Unarchive ${notes(archived.length)}`,
        onRun: run(() => commands.unarchive(archived)),
        disabled: commands.busy,
      });
    }
    return offered;
  }, [chosen, commands, keepOnly]);

  return { on, setOn, selection, actions, count: chosen.length, clear };
}
