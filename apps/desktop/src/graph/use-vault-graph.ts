import { useEffect, useState } from 'react';
import type { VaultGraph } from '@atlas/domain';
import { readVaultGraph, type IndexPort } from '@atlas/application';

/** The vault's graph as the index has it, or where reading it has got to. */
export type VaultGraphState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly graph: VaultGraph };

/**
 * Every note and connection, read once per index revision and shared: each
 * pane's links and the graph page read from the same copy, so they cannot
 * disagree, and opening a note asks the index nothing more.
 *
 * Read only once the index is ready — a half-built index would draw half a
 * vault and call it the whole.
 */
export function useVaultGraph({
  index,
  indexKey,
  ready,
}: {
  index: IndexPort;
  indexKey: string;
  ready: boolean;
}): VaultGraphState {
  const [state, setState] = useState<VaultGraphState>({ kind: 'loading' });

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    readVaultGraph({ index })
      .then((graph) => {
        if (!cancelled) setState({ kind: 'ready', graph });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            kind: 'failed',
            message: `The index could not be read: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [index, indexKey, ready]);

  return state;
}
