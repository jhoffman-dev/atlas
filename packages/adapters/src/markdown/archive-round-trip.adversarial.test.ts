/**
 * Adversarial pass on Phase 23 (A23): archiving and unarchiving a note with the
 * real YAML writer, over an in-memory vault that behaves like the host (a move
 * refuses to overwrite and needs its folder). The invariant under attack:
 * archive → unarchive gives back the note at its path, byte for byte.
 */
import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  movedPath,
  parentVaultPath,
  splitFrontmatter,
  vaultPathName,
  type EntryMove,
  type VaultEntry,
  type VaultPath,
} from '@atlas/domain';
import {
  archiveNotes,
  unarchiveNotes,
  type ArchivePorts,
  type IndexPort,
  type VaultFsPort,
} from '@atlas/application';
import { remarkMarkdown } from './markdown-port.ts';

const TODAY = '2026-09-27';

function memoryVault(notes: Record<string, string>) {
  const files = new Map(Object.entries(notes));
  const dirs = new Set<string>();
  for (const at of files.keys()) {
    let folder = parentVaultPath(createVaultPath(at));
    while (folder !== '') {
      dirs.add(folder);
      folder = parentVaultPath(folder);
    }
  }
  const entry = (at: string, kind: VaultEntry['kind']): VaultEntry =>
    ({ kind, name: vaultPathName(createVaultPath(at)), path: createVaultPath(at) }) as VaultEntry;
  const used: Partial<VaultFsPort> = {
    listDirectory: async (parent) => [
      ...[...dirs]
        .filter((at) => parentVaultPath(createVaultPath(at)) === parent)
        .map((at) => entry(at, 'directory')),
      ...[...files.keys()]
        .filter((at) => parentVaultPath(createVaultPath(at)) === parent)
        .map((at) => entry(at, 'file')),
    ],
    createFolder: async ({ path }) => {
      if (dirs.has(path) || files.has(path)) throw new Error('already there');
      dirs.add(path);
    },
    moveEntry: async (move: EntryMove) => {
      if (!files.has(move.from)) throw new Error('no such entry');
      if (files.has(move.to) || dirs.has(move.to)) throw new Error('already there');
      for (const [at, text] of [...files]) {
        const to = movedPath(at as VaultPath, move);
        if (to !== null) {
          files.delete(at);
          files.set(to, text);
        }
      }
    },
    readTextFile: async (at) => {
      const text = files.get(at);
      if (text === undefined) throw new Error('no such note');
      return { text, modified: 1 };
    },
    readNotes: async (paths) =>
      paths.flatMap((at) => {
        const text = files.get(at);
        return text === undefined ? [] : [{ path: at, text, modified: 1, size: text.length }];
      }),
    writeTextFile: async ({ path, contents }) => {
      files.set(path, contents);
      return 2;
    },
  };
  const fs = new Proxy(used, {
    get: (target, name: string) => {
      const method = target[name as keyof VaultFsPort];
      if (method === undefined) throw new Error(`fs.${name} is not faked`);
      return method;
    },
  }) as VaultFsPort;
  const index = { remove: async () => {} } as unknown as IndexPort;
  const ports: ArchivePorts = {
    fs,
    markdown: remarkMarkdown,
    index,
    editors: {
      state: () => 'closed',
      flush: async () => {},
      follow: () => {},
      abandon: () => {},
      reload: () => {},
    },
  };
  const notePaths = () => [...files.keys()].map((at) => createVaultPath(at));
  return { files, ports, notePaths };
}

async function roundTrip(path: string, text: string) {
  const vault = memoryVault({ [path]: text });
  const archived = await archiveNotes({
    ports: vault.ports,
    paths: [createVaultPath(path)],
    notePaths: vault.notePaths(),
    today: TODAY,
  });
  expect(archived.failed).toEqual([]);
  const [moved] = archived.moves;
  const restored = await unarchiveNotes({
    ports: vault.ports,
    paths: [moved!.move.to],
    notePaths: vault.notePaths(),
  });
  expect(restored.failed).toEqual([]);
  return vault.files;
}

describe('archive → unarchive gives the note back byte for byte (A23)', () => {
  it('keeps a comment-only frontmatter block rather than dropping it as empty', async () => {
    const text = '---\n# owner: James — keep this note private\n---\nBody.\n';
    const files = await roundTrip('Projects/X.md', text);
    expect(files.get('Projects/X.md')).toBe(text);
  });

  it('keeps an empty frontmatter block the note already had', async () => {
    const text = '---\n---\nBody.\n';
    const files = await roundTrip('Projects/X.md', text);
    expect(files.get('Projects/X.md')).toBe(text);
  });

  it('keeps the person’s own `archived` property instead of overwriting then deleting it', async () => {
    const text = '---\ntitle: Plan\narchived: false\n---\nBody.\n';
    const files = await roundTrip('Projects/X.md', text);
    expect(files.get('Projects/X.md')).toBe(text);
  });

  it('keeps a stale `archivedFrom` the note carried in from elsewhere', async () => {
    const text = '---\narchivedFrom: Old/Place.md\n---\nBody.\n';
    const files = await roundTrip('Projects/X.md', text);
    expect(files.get('Projects/X.md')).toBe(text);
  });

  it('round-trips CRLF frontmatter', async () => {
    const text = '---\r\ntitle: Plan\r\n---\r\nBody.\r\n';
    const files = await roundTrip('Projects/X.md', text);
    expect(files.get('Projects/X.md')).toBe(text);
  });

  it('round-trips a flow-map frontmatter', async () => {
    const text = '---\n{title: Plan, status: open}\n---\nBody.\n';
    const files = await roundTrip('Projects/X.md', text);
    expect(files.get('Projects/X.md')).toBe(text);
  });

  it('archiving a flow-map note leaves its frontmatter readable, with its own keys intact', async () => {
    const text = '---\n{title: Plan, status: open}\n---\nBody.\n';
    const vault = memoryVault({ 'Projects/X.md': text });
    await archiveNotes({
      ports: vault.ports,
      paths: [createVaultPath('Projects/X.md')],
      notePaths: vault.notePaths(),
      today: TODAY,
    });
    const archived = splitFrontmatter(vault.files.get('Archive/Projects/X.md') ?? '').frontmatter;
    expect(remarkMarkdown.frontmatterProblem(archived)).toBeNull();
    expect(remarkMarkdown.frontmatterProperties(archived)).toEqual({
      title: 'Plan',
      status: 'open',
      archived: TODAY,
      archivedFrom: 'Projects/X.md',
    });
  });

  it('round-trips a note whose file starts with a byte-order mark', async () => {
    const text = '\uFEFF---\ntitle: Plan\n---\nBody.\n';
    const files = await roundTrip('Projects/X.md', text);
    expect(files.get('Projects/X.md')).toBe(text);
  });

  it('while archived, a BOM note still has exactly one frontmatter block, not two', async () => {
    const text = '\uFEFF---\ntitle: Plan\n---\nBody.\n';
    const vault = memoryVault({ 'Projects/X.md': text });
    await archiveNotes({
      ports: vault.ports,
      paths: [createVaultPath('Projects/X.md')],
      notePaths: vault.notePaths(),
      today: TODAY,
    });
    const archived = vault.files.get('Archive/Projects/X.md') ?? '';
    expect(archived.match(/^\uFEFF?---$/gm)?.length).toBe(2);
  });

  it('round-trips a note whose folder name needs YAML quoting in archivedFrom', async () => {
    const text = 'Body.\n';
    const files = await roundTrip('[draft] #1: plan/- x.md', text);
    expect(files.get('[draft] #1: plan/- x.md')).toBe(text);
  });

  it('round-trips a frontmatter block with a trailing comment after the last key', async () => {
    const text = '---\ntitle: Plan # the working title\n---\nBody.\n';
    const files = await roundTrip('Projects/X.md', text);
    expect(files.get('Projects/X.md')).toBe(text);
  });
});
