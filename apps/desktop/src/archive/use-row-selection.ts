import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  /**
   * Once a batch has been answered: lets go of the rows it `answered`, and
   * chooses again the ones it `failed`, to try again — keeping every row
   * chosen while it ran.
   */
  afterBatch: (batch: { answered: readonly string[]; failed: readonly string[] }) => void;
} {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    setSelected(new Set());
  }, [resetKey]);

  // The row last toggled on its own: where a shift-click's range starts.
  const anchor = useRef<string | null>(null);
  const onToggle = useCallback((path: string, extend?: { readonly order: readonly string[] }) => {
    const range = extend === undefined ? null : rowsBetween(extend.order, anchor.current, path);
    if (range === null) anchor.current = path;
    setSelected((was) => {
      const next = new Set(was);
      if (range !== null) for (const row of range) next.add(row);
      else if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

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
  const afterBatch = useCallback(
    ({ answered, failed }: { answered: readonly string[]; failed: readonly string[] }) =>
      setSelected((was) => {
        const next = new Set(was);
        for (const path of answered) next.delete(path);
        for (const path of failed) next.add(path);
        return next;
      }),
    [],
  );
  return { selection, chosen, clear, keepOnly, afterBatch };
}

/**
 * The rows from `from` to `to`, both included, in the order the list shows
 * them — either way round; null when either is not in it, so a shift-click
 * with nowhere to start from toggles its own row alone.
 */
export function rowsBetween(
  order: readonly string[],
  from: string | null,
  to: string,
): readonly string[] | null {
  const start = from === null ? -1 : order.indexOf(from);
  const end = order.indexOf(to);
  if (start === -1 || end === -1) return null;
  return order.slice(Math.min(start, end), Math.max(start, end) + 1);
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
