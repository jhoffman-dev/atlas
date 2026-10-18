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
  onChange,
}: {
  watch: VaultWatchPort;
  vaultKey: string | null;
  /** The open vault's files, read to tell an echo from a change. */
  fs: Pick<VaultFsPort, 'readNotes' | 'listDirectory'>;
  ownWrites: OwnWrites;
  onChange: (paths: readonly string[]) => void;
}): void {
  useVaultWatch({
    watch,
    vaultKey,
    onChange: (paths) => {
      if (vaultKey === null) return;
      void outsideChanges({ fs, ownWrites, vault: vaultKey, paths }).then(
        (outside) => {
          if (outside.length > 0) onChange(outside);
        },
        // Nothing could be told apart, so every path is treated as a change.
        () => onChange(paths),
      );
    },
  });
}
