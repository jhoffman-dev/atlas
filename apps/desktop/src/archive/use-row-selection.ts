import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ArchiveOutcome } from '@atlas/application';
import type { VaultPath } from '@atlas/domain';
import type { RowSelection } from '@atlas/ui';

/**
 * Which rows of a list are chosen. Let go of whenever `resetKey` changes —
 * another view, another search — so a choice never carries over to rows the
 * person has not seen.
 */
export function useRowSelection(resetKey: string): {
  selection: RowSelection;
  chosen: readonly string[];
  clear: () => void;
  /** Lets go of every chosen row but these. */
  keepOnly: (paths: readonly string[]) => void;
} {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    setSelected(new Set());
  }, [resetKey]);

  const onToggle = useCallback(
    (path: string) =>
      setSelected((was) => {
        const next = new Set(was);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      }),
    [],
  );

  const onToggleAll = useCallback(
    ({ paths, select }: { paths: readonly string[]; select: boolean }) =>
      setSelected((was) => {
        const next = new Set(was);
        for (const path of paths) {
          if (select) next.add(path);
          else next.delete(path);
        }
        return next;
      }),
    [],
  );

  const clear = useCallback(() => setSelected(new Set()), []);
  const keepOnly = useCallback(
    (paths: readonly string[]) =>
      setSelected((was) => new Set(paths.filter((path) => was.has(path)))),
    [],
  );
  const selection = useMemo(
    () => ({ selected, onToggle, onToggleAll }),
    [selected, onToggle, onToggleAll],
  );
  const chosen = useMemo(() => [...selected], [selected]);
  return { selection, chosen, clear, keepOnly };
}

/**
 * The rows still chosen once a batch settles: the ones it could not move, so
 * they can be tried again — or every one, when the batch did not start.
 */
export function stillChosen(
  outcome: ArchiveOutcome | null,
  chosen: readonly VaultPath[],
): readonly VaultPath[] {
  return outcome === null ? chosen : outcome.failed.map((failure) => failure.path);
}
