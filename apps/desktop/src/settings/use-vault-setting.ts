import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActivityLog } from '@atlas/application';
import { withGiveUpRecorded } from '../activity/with-give-up-recorded.ts';

/** One setting kept in the vault's settings note: what it holds, and a way to change it. */
export interface VaultSetting<Value> {
  /** What this vault's settings hold; null when they say nothing, before they are read, or when they cannot be. */
  readonly value: Value | null;
  /** Whether `value` is what this vault's settings hold, rather than a stand-in until they are read. */
  readonly loaded: boolean;
  readonly save: (value: Value) => void;
  /** Why the last save failed. */
  readonly problem: string | null;
  /** Why the settings note cannot be read; while it cannot, nothing is written to it. */
  readonly unreadable: string | null;
}

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/**
 * A setting read from the vault's settings note and re-read when its files
 * change — so an edit made in another editor shows up. A change shows at once
 * and is written behind it; it stays shown until its write has landed, and a
 * read that comes back in the meantime is set aside rather than shown, since
 * it may predate the write. Once the writes have landed the note is read again,
 * which puts back what the file holds if one of them failed. A failed write is
 * shown by the setting and recorded in the Activity log.
 */
export function useVaultSetting<Value>({
  load,
  store,
  vaultKey,
  changeKey,
  activity,
}: {
  /** Reads the setting; a new function means the ports changed and it is read again. */
  load: () => Promise<Value | null>;
  /**
   * Writes the setting, through the vault's one settings writer. `previous` is
   * what this vault's settings were last read or saved as — null before the
   * first read — so a store can write only what changed.
   */
  store: (value: Value, previous: Value | null) => Promise<void>;
  vaultKey: string | null;
  changeKey: string;
  activity: Pick<ActivityLog, 'inOpenVault'>;
}): VaultSetting<Value> {
  // Held with the vault it belongs to, so another vault's value is never handed out.
  const [held, setHeld] = useState<{ vault: string | null; value: Value | null } | null>(null);
  const value = held !== null && held.vault === vaultKey ? held.value : null;
  // The vault whose settings `value` was read from.
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [unreadable, setUnreadable] = useState<string | null>(null);
  // Bumped when the last write in flight lands, to read what the file now holds.
  const [landed, setLanded] = useState(0);
  // Reads overlap a save and can land out of order; only the latest may land.
  const latest = useRef(0);
  const writing = useRef(0);

  useEffect(() => {
    latest.current += 1;
    const ticket = latest.current;
    if (vaultKey === null) {
      setHeld(null);
      setLoadedFrom(null);
      return;
    }
    const current = () => ticket === latest.current && writing.current === 0;
    load()
      .then((found) => {
        if (!current()) return;
        setHeld({ vault: vaultKey, value: found });
        setUnreadable(null);
        setLoadedFrom(vaultKey);
      })
      .catch((cause: unknown) => {
        if (!current()) return;
        setUnreadable(messageOf(cause));
        setLoadedFrom(null);
      });
  }, [load, vaultKey, changeKey, landed]);

  const save = useCallback(
    (next: Value) => {
      latest.current += 1;
      writing.current += 1;
      setHeld({ vault: vaultKey, value: next });
      setProblem(null);
      withGiveUpRecorded({ activity, write: 'setting', path: null }, () => store(next, value))
        .catch((cause: unknown) => setProblem(messageOf(cause)))
        .finally(() => {
          writing.current -= 1;
          if (writing.current === 0) setLanded((count) => count + 1);
        });
    },
    [store, vaultKey, value, activity],
  );

  return {
    value,
    loaded: vaultKey !== null && loadedFrom === vaultKey,
    save,
    problem,
    unreadable,
  };
}
