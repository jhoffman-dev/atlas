import {
  outsideChanges,
  type OwnWrites,
  type VaultFsPort,
  type VaultWatchPort,
} from '@atlas/application';
import { useVaultWatch } from './use-vault-watch.ts';

/**
 * Runs `onChange` with the paths the watcher reports that something other
 * than this app changed: the echo of the app's own writes, kept in
 * `ownWrites`, is dropped, since the app refreshed for those when it made
 * them (#254). A report with nothing else in it asks for nothing.
 */
export function useOutsideChanges({
  watch,
  vaultKey,
  fs,
  ownWrites,
  settled = () => Promise.resolve(),
  onChange,
}: {
  watch: VaultWatchPort;
  vaultKey: string | null;
  /** The open vault's files, read to tell an echo from a change. */
  fs: Pick<VaultFsPort, 'readNotes' | 'listDirectory'>;
  ownWrites: OwnWrites;
  /**
   * Resolves once the refreshes already asked have run. A report is judged
   * after them, so the app's own refresh for a write is in before its echo is
   * looked at: a busy window waits a little rather than walking the vault twice.
   */
  settled?: () => Promise<unknown>;
  onChange: (paths: readonly string[]) => void;
}): void {
  useVaultWatch({
    watch,
    vaultKey,
    onChange: (paths) => {
      if (vaultKey === null) return;
      void settled()
        // A refresh that failed has its own say; the report is judged all the same.
        .catch(() => undefined)
        .then(() => outsideChanges({ fs, ownWrites, vault: vaultKey, paths }))
        .then(
          (outside) => {
            if (outside.length > 0) onChange(outside);
          },
          // Nothing could be told apart, so every path is treated as a change.
          () => onChange(paths),
        );
    },
  });
}
