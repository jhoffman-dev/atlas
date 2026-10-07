import { VaultAccessError, type HostVaultFsPort, type VaultFsPort } from './ports.ts';

/**
 * The vault, as seen by work that belongs to one vault in particular.
 *
 * Paths are relative to a vault, and the host holds only the one that is open
 * now. Work started in one vault can finish after another is opened — a pane
 * saving on its way out, a write that was in flight — and its `notes.md` would
 * then be the other vault's `notes.md`. Every write through this names the vault
 * it was meant for, and the host refuses it once that is no longer the open one:
 * a late write becomes a refusal the caller can act on, never a quiet write into
 * a note nobody was editing (R14-01).
 *
 * Reads are passed through: a late read changes nothing on disk, and anything
 * that reads in order to write is caught at the write.
 */
export function inVault({ fs, vault }: { fs: HostVaultFsPort; vault: string }): VaultFsPort {
  return {
    listDirectory: (path) => fs.listDirectory(path),
    listNotes: (options) => fs.listNotes(options),
    readNotes: (paths) => fs.readNotes(paths),
    readTextFile: (path) => fs.readTextFile(path),
    readBinaryFile: (path) => fs.readBinaryFile(path),
    createNote: (args) => fs.createNote({ ...args, vault }),
    createFolder: (args) => fs.createFolder({ ...args, vault }),
    moveEntry: (args) => fs.moveEntry({ ...args, vault }),
    trashEntry: (args) => fs.trashEntry({ ...args, vault }),
    writeTextFile: (args) => fs.writeTextFile({ ...args, vault }),
    writeBinaryFile: (args) => fs.writeBinaryFile({ ...args, vault }),
  };
}

/**
 * The vault, as seen while none is open: every write is refused here, before
 * the host is asked, since there is no vault it could be meant for. Reads pass
 * through for the host to answer or refuse.
 */
export function noVaultOpen(fs: HostVaultFsPort): VaultFsPort {
  const refuse = () => Promise.reject(new VaultAccessError('no vault is open'));
  return {
    listDirectory: (path) => fs.listDirectory(path),
    listNotes: (options) => fs.listNotes(options),
    readNotes: (paths) => fs.readNotes(paths),
    readTextFile: (path) => fs.readTextFile(path),
    readBinaryFile: (path) => fs.readBinaryFile(path),
    createNote: refuse,
    createFolder: refuse,
    moveEntry: refuse,
    trashEntry: refuse,
    writeTextFile: refuse,
    writeBinaryFile: refuse,
  };
}
