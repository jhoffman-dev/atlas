import type { QueryClient } from '@tanstack/react-query';
import { READS_ON_INDEX_NEWS, type VaultRead } from '@atlas/application';
import { readAgain, vaultQueries, vaultReadKey } from './query-client.ts';

/**
 * Where the window says which whole-vault reads a change made stale.
 * Rules about which change touches which read are `@atlas/application`'s
 * (`readsTouchedByPaths`, `reportingIndexWrites`); this only applies them.
 */
export interface ReadInvalidator {
  /** Read again now: what they are made from is already on disk. */
  invalidate(vault: string, reads: Iterable<VaultRead>): void;
  /**
   * Read again when the index next has news for its readers (`indexMoved`):
   * the index is part-way through a sync now, and a read of it would be half
   * written. A write outside a sync (a move taken out at once) is followed by
   * the refresh its caller asks for, whose settling is that news.
   */
  invalidateWithIndex(vault: string, reads: Iterable<VaultRead>): void;
  /**
   * The index of `vault` has news: a sync settled having found something, a
   * build finished, or one failed. What waited for it is read again, so are
   * the reads made again on any news (`READS_ON_INDEX_NEWS`), and so is every
   * read of the vault whose last read failed: whatever failed it (a busy
   * disk, a locked index) may have passed.
   */
  indexMoved(vault: string): void;
  /** The reads of the vault waiting for the index's news. */
  waitingFor(vault: string): ReadonlySet<VaultRead>;
  /** Drops the vault's reads, and any still waiting, as it closes. */
  forget(vault: string): void;
}

export function createReadInvalidator({ client }: { client: QueryClient }): ReadInvalidator {
  const waiting = new Map<string, Set<VaultRead>>();
  const invalidate = (vault: string, reads: Iterable<VaultRead>) => {
    for (const read of reads) void readAgain(client, vaultReadKey(vault, read));
  };
  return {
    invalidate,
    invalidateWithIndex(vault, reads) {
      const held = waiting.get(vault) ?? new Set<VaultRead>();
      for (const read of reads) held.add(read);
      if (held.size > 0) waiting.set(vault, held);
    },
    indexMoved(vault) {
      const due = new Set([...(waiting.get(vault) ?? []), ...READS_ON_INDEX_NEWS]);
      waiting.delete(vault);
      invalidate(vault, due);
      const failed = client.getQueryCache().findAll({
        queryKey: vaultQueries(vault),
        predicate: (query) => query.state.status === 'error',
      });
      for (const query of failed) void readAgain(client, query.queryKey);
    },
    waitingFor: (vault) => new Set(waiting.get(vault)),
    forget(vault) {
      waiting.delete(vault);
      client.removeQueries({ queryKey: vaultQueries(vault) });
    },
  };
}
