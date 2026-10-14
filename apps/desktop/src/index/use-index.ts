import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createIndexSyncer,
  type ActivityLog,
  type IndexPort,
  type MarkdownPort,
  type NoteChanges,
  type NoteDeriver,
  type VaultFsPort,
} from '@atlas/application';

export interface IndexPorts {
  fs: VaultFsPort;
  index: IndexPort;
  markdown: MarkdownPort;
  /** Where notes are read into rows; on this thread when left out, which only a test should do. */
  deriver?: NoteDeriver;
}

/** How far a build of the index has got: notes done, of how many. */
export interface IndexProgress {
  readonly done: number;
  readonly total: number;
}

/**
 * A build's progress, for whoever shows it to subscribe to (#135). It is kept
 * out of `IndexStatus` on purpose: the status is what the whole window hangs
 * off, and one that moved with every batch re-rendered the app, and re-ran
 * everything that reads the index, a hundred times a build.
 */
export interface IndexProgressStore {
  subscribe(listener: () => void): () => void;
  current(): IndexProgress;
}

const NOT_STARTED: IndexProgress = { done: 0, total: 0 };

function createIndexProgress(): IndexProgressStore & { set(progress: IndexProgress): void } {
  let progress = NOT_STARTED;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    current: () => progress,
    set(next) {
      progress = next;
      for (const listener of listeners) listener();
    },
  };
}

export type IndexStatus =
  | { readonly kind: 'idle' }
  /** Being built. How far it has got is `progress`'s to say, so `done` and `total` stay 0 here. */
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

/** One value for every build, so a refresh asked for during a build changes nothing the window sees. */
const WORKING: IndexStatus = { kind: 'working', done: 0, total: 0 };

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
  progress: IndexProgressStore;
  /** Resolves true once the index holds the files as they were when it was asked, false when it does not. */
  refresh: () => Promise<boolean>;
  rebuild: () => Promise<boolean>;
  /**
   * Resolves true once the index holds every change that has asked for a
   * refresh so far, without reading the vault again to get there: it waits
   * for the last build or refresh already asked, and asks for one only when
   * none has been, or the last did not hold the files.
   */
  catchUp: () => Promise<boolean>;
} {
  const [status, setStatus] = useState<IndexStatus>({ kind: 'idle' });
  const [progress] = useState(createIndexProgress);
  const revision = useRef(0);
  /** Syncs asked for and not yet settled, of the vault they were asked for: the one running, and any queued behind it. */
  const waiting = useRef<{ vault: string | null; count: number }>({ vault: null, count: 0 });
  // Read by every syncer this hook has made, so one left from a vault since
  // closed drops what is still queued on it instead of reading the new vault.
  const open = useRef(vaultKey);
  open.current = vaultKey;
  const syncer = useMemo(
    () =>
      createIndexSyncer({
        fs: ports.fs,
        index: ports.index,
        markdown: ports.markdown,
        ...(ports.deriver !== undefined && { deriver: ports.deriver }),
        activity,
        changes,
        openVault: () => open.current,
      }),
    [ports.fs, ports.index, ports.markdown, ports.deriver, activity, changes],
  );

  const run = useCallback(
    async ({ fromScratch }: { fromScratch: boolean }): Promise<boolean> => {
      if (vaultKey === null || open.current !== vaultKey) return false;
      // Another vault's syncs are not this one's: its count starts again, and so
      // does what the window says of how far it has got.
      if (waiting.current.vault !== vaultKey) waiting.current = { vault: vaultKey, count: 0 };
      const asked = waiting.current;
      // A refresh asked for while a build runs waits its turn behind it, and
      // must not wipe what the window says of the one under way.
      if (asked.count === 0) progress.set(NOT_STARTED);
      setStatus(WORKING);
      asked.count += 1;
      /** Whether this is the last word on the vault still open: nothing queued behind it, no switch since. */
      const settles = () => asked.count === 0 && waiting.current === asked;
      try {
        const stats = await syncer
          .sync({
            vault: vaultKey,
            fromScratch,
            onProgress: (done, total) => {
              // A build caught by a switch may report once more before it stops.
              if (waiting.current === asked) progress.set({ done, total });
            },
          })
          .finally(() => (asked.count -= 1));
        // Dropped: the vault closed while it waited, and the one open now has its own.
        if (stats === null) return false;
        revision.current += 1;
        // Not "ready" while a sync queued behind this one is still to write:
        // whatever reads the index on "ready" would read it half written (#135).
        if (settles()) {
          setStatus({ kind: 'ready', notes: stats.notes, revision: revision.current });
        }
        return true;
      } catch (cause) {
        // A sync still to come has the last word; this failure is in the Activity log.
        if (settles()) setStatus({ kind: 'failed', message: message(cause) });
        return false;
      }
    },
    [syncer, vaultKey, progress],
  );

  /** The last sync asked of the open vault: it settles after every one asked before it. */
  const lastAsked = useRef<{ vault: string; held: Promise<boolean> } | null>(null);
  const ask = useCallback(
    (fromScratch: boolean) => {
      const held = run({ fromScratch });
      if (vaultKey !== null) lastAsked.current = { vault: vaultKey, held };
      return held;
    },
    [run, vaultKey],
  );

  useEffect(() => {
    if (vaultKey === null) {
      setStatus({ kind: 'idle' });
      return;
    }
    void ask(false);
  }, [vaultKey, ask]);

  const catchUp = useCallback(async () => {
    const last = lastAsked.current;
    if (last?.vault === vaultKey && (await last.held)) return true;
    return ask(false);
  }, [vaultKey, ask]);

  return {
    status,
    progress,
    refresh: useCallback(() => ask(false), [ask]),
    rebuild: useCallback(() => ask(true), [ask]),
    catchUp,
  };
}
