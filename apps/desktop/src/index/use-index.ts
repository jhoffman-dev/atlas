import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createIndexSyncer,
  type ActivityLog,
  type IndexPort,
  type MarkdownPort,
  type NoteChanges,
  type VaultFsPort,
} from '@atlas/application';

export interface IndexPorts {
  fs: VaultFsPort;
  index: IndexPort;
  markdown: MarkdownPort;
}

export type IndexStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'working'; readonly done: number; readonly total: number }
  | {
      readonly kind: 'ready';
      readonly notes: number;
      /**
       * How many times the index has finished refreshing. The note count alone
       * does not change when a note is edited rather than added, so anything
       * re-running on "the index moved" needs a number that always does.
       */
      readonly revision: number;
    }
  | { readonly kind: 'failed'; readonly message: string };

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Keeps the index in step with the vault.
 *
 * It is opened and brought up to date whenever a vault is opened. Rebuilding
 * throws the database away and starts again, which is the check that nothing
 * depends on it surviving.
 */
export function useIndex({
  ports,
  vaultKey,
  activity,
  changes,
}: {
  ports: IndexPorts;
  vaultKey: string | null;
  /** Where a rebuild, and a failure, is said (U-28). */
  activity: ActivityLog;
  /** Where every refresh says which notes it found added, changed or removed (P28-03). */
  changes: NoteChanges;
}): {
  status: IndexStatus;
  refresh: () => Promise<void>;
  rebuild: () => Promise<void>;
} {
  const [status, setStatus] = useState<IndexStatus>({ kind: 'idle' });
  const revision = useRef(0);
  const syncer = useMemo(
    () =>
      createIndexSyncer({
        fs: ports.fs,
        index: ports.index,
        markdown: ports.markdown,
        activity,
        changes,
      }),
    [ports.fs, ports.index, ports.markdown, activity, changes],
  );

  const run = useCallback(
    async ({ fromScratch }: { fromScratch: boolean }) => {
      if (vaultKey === null) return;
      try {
        setStatus({ kind: 'working', done: 0, total: 0 });
        const stats = await syncer.sync({
          vault: vaultKey,
          fromScratch,
          onProgress: (done, total) => setStatus({ kind: 'working', done, total }),
        });
        revision.current += 1;
        setStatus({ kind: 'ready', notes: stats.notes, revision: revision.current });
      } catch (cause) {
        setStatus({ kind: 'failed', message: message(cause) });
      }
    },
    [syncer, vaultKey],
  );

  useEffect(() => {
    if (vaultKey === null) {
      setStatus({ kind: 'idle' });
      return;
    }
    void run({ fromScratch: false });
  }, [vaultKey, run]);

  return {
    status,
    refresh: useCallback(() => run({ fromScratch: false }), [run]),
    rebuild: useCallback(() => run({ fromScratch: true }), [run]),
  };
}
