import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActivityLog, MarkdownPort, VaultFsPort } from '@atlas/application';
import { withGiveUpRecorded } from '../activity/with-give-up-recorded.ts';
import { useVaultSettingsRead } from './use-vault-settings-read.ts';

/** One setting kept in the vault's settings note: what it holds, and a way to change it. */
export interface VaultSetting<Value> {
  /** What this vault's settings hold; null when they say nothing, before they are read, or when they cannot be. */
  readonly value: Value | null;
  /** Whether `value` is what this vault's settings hold, rather than a stand-in until they are read. */
  readonly loaded: boolean;
  /**
   * Whether this vault's settings note has been read, whatever it answered:
   * `loaded`, or found `unreadable`. Until then nothing about the setting is known.
   */
  readonly answered: boolean;
  /** Shows `value` at once and writes it behind it. */
  readonly save: (value: Value) => void;
  /** As `save`, for a caller that waits on the write: settles once it has, with why it failed or null. */
  readonly write: (value: Value) => Promise<string | null>;
  /** Why the last save failed. */
  readonly problem: string | null;
  /** Why the settings note cannot be read; while it cannot, nothing is written to it. */
  readonly unreadable: string | null;
}

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/**
 * A setting read from the vault's settings note — the window's one read of
 * it (`useVaultSettingsRead`), made again when the note changes, so an edit
 * made in another editor shows up. A change shows at once and is written
 * behind it; it stays shown until its write has landed, and a read that
 * comes back in the meantime is set aside rather than shown, since it may
 * predate the write. Once the writes have landed the note is read again,
 * which puts back what the file holds if one of them failed. A failed write
 * is shown by the setting and recorded in the Activity log.
 */
export function useVaultSetting<Value>({
  fs,
  markdown,
  parse,
  store,
  vaultKey,
  activity,
}: {
  fs: Pick<VaultFsPort, 'readNotes'>;
  markdown: Pick<MarkdownPort, 'frontmatterProperties' | 'frontmatterProblem'>;
  /** The setting in the settings read; a new function means it is taken out of them again. */
  parse: (settings: Readonly<Record<string, unknown>>) => Value | null;
  /**
   * Writes the setting, through the vault's one settings writer. `previous` is
   * what this vault's settings were last read or saved as — null before the
   * first read — so a store can write only what changed.
   */
  store: (value: Value, previous: Value | null) => Promise<void>;
  vaultKey: string | null;
  activity: Pick<ActivityLog, 'inOpenVault'>;
}): VaultSetting<Value> {
  const read = useVaultSettingsRead({ fs, markdown, vaultKey });
  // Held with the vault it belongs to, so another vault's value is never handed out.
  const [held, setHeld] = useState<{ vault: string | null; value: Value | null } | null>(null);
  const value = held !== null && held.vault === vaultKey ? held.value : null;
  // The vault whose settings `value` was read from.
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null);
  // The vault whose settings note last answered a read, whether or not it could be read.
  const [answeredFor, setAnsweredFor] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [unreadable, setUnreadable] = useState<string | null>(null);
  const writing = useRef(0);
  // Once the writes land, the read they wait for: the vault's next after this answer.
  const waitingPast = useRef<{ vault: string | null; answer: object | null } | null>(null);
  const answer = useRef(read.answer);
  answer.current = read.answer;

  const { settings, unreadable: failure } = read;
  useEffect(() => {
    if (vaultKey === null) {
      setHeld(null);
      setLoadedFrom(null);
      setAnsweredFor(null);
      return;
    }
    if (writing.current > 0) return;
    const waiting = waitingPast.current;
    if (waiting?.vault === vaultKey && read.answer === waiting.answer) return;
    waitingPast.current = null;
    if (failure !== null) {
      setUnreadable(failure);
      setLoadedFrom(null);
      setAnsweredFor(vaultKey);
      return;
    }
    if (settings === undefined) return;
    setHeld({ vault: vaultKey, value: parse(settings) });
    setUnreadable(null);
    setLoadedFrom(vaultKey);
    setAnsweredFor(vaultKey);
  }, [settings, failure, read.answer, parse, vaultKey]);

  const { readAgain } = read;
  const write = useCallback(
    (next: Value): Promise<string | null> => {
      writing.current += 1;
      setHeld({ vault: vaultKey, value: next });
      setProblem(null);
      return withGiveUpRecorded({ activity, write: 'setting', path: null }, () =>
        store(next, value),
      )
        .then(
          () => null,
          (cause: unknown) => {
            const why = messageOf(cause);
            setProblem(why);
            return why;
          },
        )
        .finally(() => {
          writing.current -= 1;
          if (writing.current > 0) return;
          waitingPast.current = { vault: vaultKey, answer: answer.current };
          void readAgain();
        });
    },
    [store, vaultKey, value, activity, readAgain],
  );
  const save = useCallback((next: Value) => void write(next), [write]);

  return {
    value,
    loaded: vaultKey !== null && loadedFrom === vaultKey,
    answered: vaultKey !== null && answeredFor === vaultKey,
    save,
    write,
    problem,
    unreadable,
  };
}
