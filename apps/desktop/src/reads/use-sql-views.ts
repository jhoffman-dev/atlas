import { useEffect, useEffectEvent, useRef } from 'react';
import { viewSpecsFor, type DefinedType, type IndexPort } from '@atlas/application';

/**
 * The SQL view behind each type, rebuilt when the definitions change — adding
 * a property to a type makes a column appear — and when the index is ready
 * after a build, which made the database afresh without them. A rebuild that
 * failed is tried again when the index next has news (`revision` moves).
 * Nothing else rebuilds them: `types` is the same array until a definition
 * changes (#259).
 */
export function useSqlViews({
  index,
  types,
  ready,
  revision,
}: {
  index: Pick<IndexPort, 'rebuildViews'>;
  types: readonly DefinedType[];
  ready: boolean;
  /** The index's revision: it moves when the index has news. */
  revision: number;
}): void {
  const failed = useRef(false);
  const rebuild = useEffectEvent(() => {
    failed.current = false;
    if (!ready || types.length === 0) return;
    index.rebuildViews(viewSpecsFor(types)).catch(() => {
      // A view that cannot be built shows as a failing query until the retry.
      failed.current = true;
    });
  });

  useEffect(() => rebuild(), [index, types, ready]);
  // Only a failed rebuild listens for news; one that worked waits for new definitions.
  useEffect(() => {
    if (failed.current) rebuild();
  }, [revision]);
}
