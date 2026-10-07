import { useCallback, useEffect, useState } from 'react';
import { rankTagSuggestions, type TagCount, type TagSuggestion } from '@atlas/domain';
import { loadTagCounts, type IndexPort } from '@atlas/application';

/** The vault's tags as the index has them, or where reading them has got to. */
export type VaultTagsState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly counts: readonly TagCount[] };

/**
 * Every tag and how often it is used, read once per index revision and
 * shared: the `#` suggestions and the tags page read from the same copy.
 * Read only once the index is ready, as the graph is.
 */
export function useVaultTags({
  index,
  indexKey,
  ready,
}: {
  index: IndexPort;
  indexKey: string;
  ready: boolean;
}): { state: VaultTagsState; suggest: (query: string) => readonly TagSuggestion[] } {
  const [state, setState] = useState<VaultTagsState>({ kind: 'loading' });

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    loadTagCounts({ index })
      .then((counts) => {
        if (!cancelled) setState({ kind: 'ready', counts });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            kind: 'failed',
            message: `The tags could not be read: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [index, indexKey, ready]);

  const suggest = useCallback(
    (query: string) => rankTagSuggestions(query, state.kind === 'ready' ? state.counts : []),
    [state],
  );

  return { state, suggest };
}
