import { useQuery } from '@tanstack/react-query';
import type { ReadScope } from '@atlas/application';
import { indexKeyOf, type IndexStatusStore } from '../index/index-status-store.ts';
import { scopedReadKey, scopedReadMeta } from './query-client.ts';

/**
 * The index's key as a reader made from `scope` sees it (#325): a query of
 * the key, named by the reader, that the index's news reads again only when
 * it touched what the reader is made from (`scopeTouched`). A reader re-run on
 * it reads again for its own data, and not for a note saved anywhere, as one
 * re-run on the window's `indexKey` did.
 *
 * For a reader whose reads are its own to keep — rows that settle on a read
 * made after their write, or the editor's blocks, which ask when it moves.
 * `enabled` false keeps the key where it was, and reads it again once on.
 */
export function useScopedIndexKey({
  status,
  vault,
  reader,
  scope,
  enabled = true,
}: {
  status: IndexStatusStore;
  vault: string | null;
  /** Which reader this is: its name and what it reads, for its query's key. */
  reader: readonly unknown[];
  scope: ReadScope;
  enabled?: boolean;
}): string {
  const now = () => indexKeyOf(status.getState(), vault);
  const query = useQuery({
    queryKey: scopedReadKey(vault ?? '', 'index-key', ...reader),
    queryFn: now,
    initialData: now,
    meta: scopedReadMeta(scope),
    enabled: enabled && vault !== null,
    // Dropped as soon as no reader holds it: a key is read afresh as one starts
    // to, and keeping one per note a tab ever showed would hold a timer each.
    gcTime: 0,
  });
  return query.data;
}
