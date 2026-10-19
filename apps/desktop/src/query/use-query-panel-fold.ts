import { useCallback, useMemo, useState } from 'react';
import type { QueryPanelFold, QueryPanelFoldStore } from '@atlas/ui';

/**
 * Whether the query view a pane shows has its query folded to one line,
 * remembered per view on this Mac. A view not yet left either way opens
 * folded when its query is already written — the answer is what it is for —
 * and open when there is nothing to show yet. Opening another view reads
 * that view's fold; folding one writes it back at once.
 */
export function useQueryPanelFold({
  store,
  view,
  savedText,
}: {
  store: QueryPanelFoldStore;
  /** Which view's fold: its vault and path, so two vaults' views never share. */
  view: string;
  /** The query as the view's file holds it; empty for a view with none yet. */
  savedText: string;
}): QueryPanelFold {
  // Settled once per view as it opens: saving a query must not fold the
  // builder under the hands editing it, so the saved text counts only then.
  const settle = () => ({ view, collapsed: store.read(view) ?? savedText.trim() !== '' });
  const [fold, setFold] = useState(settle);
  // Another view opened in the pane: its own fold, read as it is drawn.
  const current = fold.view === view ? fold : settle();
  if (current !== fold) setFold(current);

  const { collapsed } = current;
  const onToggle = useCallback(() => {
    store.write(view, !collapsed);
    setFold({ view, collapsed: !collapsed });
  }, [store, view, collapsed]);
  return useMemo(() => ({ collapsed, onToggle }), [collapsed, onToggle]);
}
