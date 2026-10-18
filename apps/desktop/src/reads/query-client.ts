import { QueryClient } from '@tanstack/react-query';
import type { VaultRead } from '@atlas/application';

/**
 * The window's one query cache (ADR-0040). A read is made again only when it
 * is invalidated (`staleTime: Infinity`), never because the window regained
 * focus or a component mounted. `networkMode: 'always'`: every read is of
 * this Mac's disk or index, which the browser's idea of being online has
 * nothing to say about. A failed read is shown as failed, not tried again at
 * once: it is read again when the index next has news (`indexMoved`), or
 * when a change touches it, whichever comes first.
 */
export function createWindowQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        networkMode: 'always',
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });
}

/** Every query the vault at `vault` holds: its reads begin with this, and are dropped by it. */
export const vaultQueries = (vault: string) => ['vault', vault] as const;

/** One whole-vault read, of one vault: the vault is in the key, so no answer is shown for another. */
export const vaultReadKey = (vault: string, read: VaultRead) =>
  [...vaultQueries(vault), read] as const;

/**
 * Marks a read stale and reads it again if anything shows it. A read already
 * under way may have begun before the change, so it is dropped rather than
 * joined: left alone, a first read still in flight is shared with the ask,
 * and would settle with what was there before.
 */
export async function readAgain(client: QueryClient, queryKey: readonly unknown[]): Promise<void> {
  await client.cancelQueries({ queryKey });
  await client.invalidateQueries({ queryKey });
}
