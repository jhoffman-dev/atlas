import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isStrandedEditExpired,
  noteLabelForNotice,
  redateStrandedEdit,
  type StrandedComment,
  type StrandedComments,
  type VaultPath,
} from '@dfai/domain';
import type { KeptWorkStore } from './stranded-edits.ts';

export type StrandedCommentStore = KeptWorkStore<StrandedComments>;

/** What a closing note hands over: the comments it could not write, and the vault they were typed in. */
export interface CommentStranding {
  readonly vault: string;
  readonly path: VaultPath;
  readonly comments: readonly StrandedComment[];
  readonly reason: string;
}

export interface KeptComments {
  /** Keeps what a closing note could not write, in place of what was kept for it before. */
  readonly keep: (stranding: CommentStranding) => void;
  /**
   * The comments kept for a note of the open vault, to put back in its fields.
   * They stay kept until `settle`: put back is not written, and a quit before
   * they are must not lose them.
   */
  readonly offered: (path: VaultPath) => readonly StrandedComment[];
  /** Lets go of a note's kept comments, once its fields have written them. */
  readonly settle: (args: { vault: string; path: VaultPath }) => void;
  /** Throws away what was kept for a note: for a note that is gone, or comments nobody wants. */
  readonly forget: (path: VaultPath) => void;
  /** The notes with comments waiting, in the order they were kept. */
  readonly waiting: readonly VaultPath[];
  /** What to tell the person while comments are waiting: whose, why, and the words. */
  readonly notice: string | null;
}

/** The notice for what is kept: the words themselves, so they are never out of sight. */
export function describeKeptComments(kept: readonly StrandedComments[]): string | null {
  if (kept.length === 0) return null;
  return kept
    .map((each) => {
      const words = each.comments.map((one) => `“${one.comment}”`).join('; ');
      return `Comments on highlights in ${noteLabelForNotice(each.path)} could not be saved: ${each.reason} Open the note again to get them back. They read: ${words}`;
    })
    .join(' ');
}

/**
 * The comments typed in highlights (#534) that a closing note could not write
 * — a conflict, a refused write, a write that did not finish in time — kept
 * as its typing is (`useStrandedEdits`): in the store, so they outlast a quit,
 * and in memory for any vault, so a store that refuses them loses nothing
 * while DFAI runs. Offered back to the note's fields when it is opened again.
 */
export function useStrandedComments({
  store,
  vaultKey,
  now,
}: {
  store: StrandedCommentStore;
  vaultKey: string | null;
  now: () => number;
}): KeptComments {
  /** Everything kept while DFAI runs, by vault: the store's copy, or the only one. */
  const held = useRef(new Map<string, Map<VaultPath, StrandedComments>>());
  const openVault = useRef(vaultKey);
  const clock = useRef(now);
  clock.current = now;
  const [shown, setShown] = useState<readonly StrandedComments[]>([]);

  const heldIn = useCallback((vault: string) => {
    const found = held.current.get(vault) ?? new Map<VaultPath, StrandedComments>();
    held.current.set(vault, found);
    return found;
  }, []);

  const refresh = useCallback(() => {
    const vault = openVault.current;
    const kept = vault === null ? [] : [...heldIn(vault).values()];
    // Nothing kept before or now is no news: no commit for every note that closes cleanly.
    setShown((before) => (before.length === 0 && kept.length === 0 ? before : kept));
  }, [heldIn]);

  useEffect(() => {
    openVault.current = vaultKey;
    if (vaultKey !== null) {
      const at = clock.current();
      const kept = heldIn(vaultKey);
      for (const read of store.read(vaultKey)) {
        const each = redateStrandedEdit({ edit: read, now: at });
        if (isStrandedEditExpired({ edit: each, now: at })) {
          store.remove({ vaultKey, path: each.path });
        } else if (!kept.has(each.path)) {
          kept.set(each.path, each);
        }
      }
    }
    refresh();
  }, [store, vaultKey, heldIn, refresh]);

  const keep = useCallback(
    ({ vault, ...work }: CommentStranding) => {
      const edit: StrandedComments = { ...work, keptAt: clock.current() };
      // A refused put still leaves them held here, for as long as DFAI runs.
      store.put({ vaultKey: vault, edit });
      const kept = heldIn(vault);
      kept.delete(edit.path);
      kept.set(edit.path, edit);
      refresh();
    },
    [store, heldIn, refresh],
  );

  const offered = useCallback(
    (path: VaultPath) => {
      const vault = openVault.current;
      return vault === null ? [] : (heldIn(vault).get(path)?.comments ?? []);
    },
    [heldIn],
  );

  const settle = useCallback(
    ({ vault, path }: { vault: string; path: VaultPath }) => {
      if (!heldIn(vault).delete(path)) return;
      store.remove({ vaultKey: vault, path });
      refresh();
    },
    [store, heldIn, refresh],
  );

  const forget = useCallback(
    (path: VaultPath) => {
      if (openVault.current !== null) settle({ vault: openVault.current, path });
    },
    [settle],
  );

  return useMemo(
    () => ({
      keep,
      offered,
      settle,
      forget,
      waiting: shown.map((each) => each.path),
      notice: describeKeptComments(shown),
    }),
    [keep, offered, settle, forget, shown],
  );
}
