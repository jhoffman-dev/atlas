import {
  createVaultPath,
  parentVaultPath,
  vaultPathName,
  type VaultEntry,
  type VaultPath,
} from '@atlas/domain';
import { fakeIndexPort, fakeVaultFs, type ProposalPorts } from '@atlas/application';
import { remarkMarkdown } from '@atlas/adapters';

const path = (raw: string): VaultPath => createVaultPath(raw);

/** A vault in memory: a note's modified time moves on with every write, and the Trash takes notes away. */
export function inMemoryProposalVault(notes: Record<string, string>) {
  let clock = 10;
  const files = new Map(Object.entries(notes).map(([at, text]) => [at, { text, modified: clock }]));
  const dirs = new Set<string>();
  const parents = () => [
    ...dirs,
    ...[...files.keys()].flatMap((at) => {
      const segments = at.split('/').slice(0, -1);
      return segments.map((_, depth) => segments.slice(0, depth + 1).join('/'));
    }),
  ];
  const entry = (at: string, kind: VaultEntry['kind']) =>
    ({ kind, name: vaultPathName(path(at)), path: path(at) }) as VaultEntry;
  const read = (at: string) => {
    const file = files.get(at);
    if (file === undefined) throw new Error('no such entry');
    return file;
  };
  const fs = fakeVaultFs({
    listDirectory: async (parent) =>
      [...new Set(parents().filter((at) => parentVaultPath(path(at)) === parent))]
        .map((at) => entry(at, 'directory'))
        .concat(
          [...files.keys()]
            .filter((at) => parentVaultPath(path(at)) === parent)
            .map((at) => entry(at, 'file')),
        ),
    listNotes: async () =>
      [...files].map(([at, file]) => ({
        name: vaultPathName(path(at)),
        path: path(at),
        modified: file.modified,
        size: file.text.length,
      })),
    createFolder: async ({ path: at }) => void dirs.add(at),
    createNote: async ({ path: at, contents }) => {
      if (files.has(at)) throw new Error('already exists');
      const modified = (clock += 1);
      files.set(at, { text: contents, modified });
      return modified;
    },
    moveEntry: async ({ from, to }) => {
      const file = read(from);
      if (files.has(to)) throw new Error('already exists');
      files.delete(from);
      files.set(to, { ...file, modified: (clock += 1) });
    },
    readTextFile: async (at) => ({ ...read(at) }),
    readNotes: async (paths) =>
      paths.flatMap((at) => {
        const file = files.get(at);
        return file === undefined ? [] : [{ path: at, ...file, size: file.text.length }];
      }),
    writeTextFile: async ({ path: at, contents, expectedModified }) => {
      if (expectedModified !== null && read(at).modified !== expectedModified) {
        throw new Error('changed on disk');
      }
      files.set(at, { text: contents, modified: (clock += 1) });
      return clock;
    },
    trashEntry: async ({ path: at }) => {
      if (!files.delete(at)) throw new Error('no such entry');
    },
  });
  const ports: ProposalPorts = {
    fs,
    index: fakeIndexPort(),
    markdown: remarkMarkdown,
    editors: {
      state: () => 'closed',
      flush: async () => {},
      follow: () => {},
      abandon: () => {},
      reload: () => {},
    },
  };
  return { files, ports };
}

/** Test support for the Proposals hooks: the vault above, shared by their tests. */
