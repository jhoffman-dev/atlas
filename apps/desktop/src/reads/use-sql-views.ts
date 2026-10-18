import { useEffect } from 'react';
import { viewSpecsFor, type DefinedType, type IndexPort } from '@atlas/application';

/**
 * The SQL view behind each type, rebuilt when the definitions change — adding
 * a property to a type makes a column appear — and when the index is ready
 * after a build, which made the database afresh without them. Nothing else
 * rebuilds them: `types` is the same array until a definition changes (#259).
 */
export function useSqlViews({
  index,
  types,
  ready,
}: {
  index: Pick<IndexPort, 'rebuildViews'>;
  types: readonly DefinedType[];
  ready: boolean;
}): void {
  useEffect(() => {
    if (!ready || types.length === 0) return;
    void index.rebuildViews(viewSpecsFor(types)).catch(() => {
      // A view that cannot be built shows as a failing query rather than here.
    });
  }, [index, types, ready]);
}
