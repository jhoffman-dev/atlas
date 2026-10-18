import type { OwnWrites } from './own-writes.ts';
import type { VaultFsPort } from './ports.ts';

/**
 * The vault, with every write it makes kept in `ownWrites` as what it left
 * behind, so the watcher's report of it can be known as the app's own
 * (#254). A write whose result the host does not report in full — a new
 * note, an artifact's bytes — and a write that fails are forgotten instead:
 * what is there is not known, so a report of it is refreshed for.
 */
export function recordingOwnWrites({
  fs,
  ownWrites,
  vault,
}: {
  fs: VaultFsPort;
  ownWrites: OwnWrites;
  vault: string;
}): VaultFsPort {
  const at = (path: string) => ({ vault, path });
  /** Runs a write; whatever it fails on is forgotten at every path it named, then thrown on. */
  const forgetOnFailure = async <T>(paths: readonly string[], write: () => Promise<T>) => {
    try {
      return await write();
    } catch (error) {
      for (const path of paths) ownWrites.forget(at(path));
      throw error;
    }
  };
  const forgetAfter = async <T>(path: string, write: () => Promise<T>) => {
    try {
      return await write();
    } finally {
      ownWrites.forget(at(path));
    }
  };
  return {
    listDirectory: (path) => fs.listDirectory(path),
    listNotes: (options) => fs.listNotes(options),
    readNotes: (paths) => fs.readNotes(paths),
    readTextFile: (path) => fs.readTextFile(path),
    readBinaryFile: (path) => fs.readBinaryFile(path),
    writeTextFile: (args) =>
      forgetOnFailure([args.path], async () => {
        const modified = await fs.writeTextFile(args);
        ownWrites.record({
          ...at(args.path),
          left: { kind: 'text', text: args.contents, modified },
        });
        return modified;
      }),
    createFolder: (args) =>
      forgetOnFailure([args.path], async () => {
        await fs.createFolder(args);
        ownWrites.record({ ...at(args.path), left: { kind: 'folder' } });
      }),
    trashEntry: (args) =>
      forgetOnFailure([args.path], async () => {
        await fs.trashEntry(args);
        ownWrites.record({ ...at(args.path), left: { kind: 'absent' } });
      }),
    moveEntry: (args) =>
      forgetOnFailure([args.from, args.to], async () => {
        await fs.moveEntry(args);
        // A note moves with its bytes and its time; anything else moved is not known.
        const carried = ownWrites.leftAt(at(args.from));
        if (carried?.kind === 'text') ownWrites.record({ ...at(args.to), left: carried });
        else ownWrites.forget(at(args.to));
        ownWrites.record({ ...at(args.from), left: { kind: 'absent' } });
      }),
    createNote: (args) => forgetAfter(args.path, () => fs.createNote(args)),
    writeBinaryFile: (args) => forgetAfter(args.path, () => fs.writeBinaryFile(args)),
  };
}
