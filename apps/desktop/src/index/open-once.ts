import type { IndexOpening, IndexPort } from '@atlas/application';

/**
 * The index, opened once for the vault it was made for (#238). Every sync
 * opens the index first, and the host answered each `index_open` by opening
 * the database again: once a refresh, so once a save. Make one of these per
 * vault, so a switch opens the next vault's index afresh.
 *
 * The opening is forgotten when it fails, and when any call a sync makes
 * fails — the connection may be what broke, and the next sync reopens it.
 * A rebuild needs nothing: the host reopens the index itself after `clear()`,
 * and the syncer measures from what it remembers rather than from `fresh`.
 */
export function openOnce(index: IndexPort): IndexPort {
  let opening: Promise<IndexOpening> | null = null;
  const forgetOnFailure = <T>(call: Promise<T>): Promise<T> =>
    call.catch((cause: unknown) => {
      opening = null;
      throw cause;
    });
  return {
    ...index,
    open() {
      opening ??= forgetOnFailure(index.open());
      return opening;
    },
    clear: () => forgetOnFailure(index.clear()),
    manifest: () => forgetOnFailure(index.manifest()),
    put: (notes, scope) => forgetOnFailure(index.put(notes, scope)),
    remove: (paths, scope) => forgetOnFailure(index.remove(paths, scope)),
    stats: () => forgetOnFailure(index.stats()),
  };
}
