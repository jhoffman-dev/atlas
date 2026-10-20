import { useEffect, useMemo } from 'react';
import type { VaultPath } from '@atlas/domain';
import type { BulkAction, RowSelection } from '@atlas/ui';
import type { ChosenPeopleMerge } from '../archive/use-view-choosing.ts';
import { useRowSelection } from '../archive/use-row-selection.ts';

/** A table's chosen rows and what can be done to them. */
export interface ChosenRows {
  readonly selection: RowSelection;
  readonly actions: readonly BulkAction[];
  readonly count: number;
  readonly clear: () => void;
}

const mergeLabel = (n: number) => (n === 1 ? 'Merge into…' : `Merge ${n} people into…`);

/**
 * People chosen in the Person type's table (#464): ticked rows, merged into
 * another person with "Merge … into…", and said to ⌘K's "Merge selected
 * people…". Null where the table is not of people. Let go of with `resetKey`.
 */
export function useChosenPeople({
  resetKey,
  merge,
}: {
  resetKey: string;
  merge: ChosenPeopleMerge | null;
}): ChosenRows | null {
  const { selection, chosen, clear } = useRowSelection(resetKey);
  useEffect(() => {
    if (merge === null) return;
    merge.noteChosen(chosen as VaultPath[]);
    return () => merge.noteChosen([]);
  }, [merge, chosen]);
  return useMemo(() => {
    if (merge === null) return null;
    const paths = chosen as VaultPath[];
    const actions: BulkAction[] =
      paths.length === 0
        ? []
        : [{ label: mergeLabel(paths.length), onRun: () => merge.mergeMany(paths) }];
    return { selection, actions, count: paths.length, clear };
  }, [merge, chosen, selection, clear]);
}
