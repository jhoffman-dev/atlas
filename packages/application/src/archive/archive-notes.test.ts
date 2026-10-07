/**
 * Archiving and unarchiving, over a vault held in memory that answers the way
 * the host does: a move refuses to overwrite and needs its folder to exist, a
 * write is refused against a note that changed since it was read. What is
 * asserted is where each note ends up and what it says, byte for byte.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createVaultPath,
  movedPath,
  parentVaultPath,
  vaultPathName,
  type EntryMove,
  type VaultEntry,
  type VaultPath,
} from '@atlas/domain';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { VaultAccessError } from '../vault/ports.ts';
import { archiveNotes, unarchiveNotes, type ArchivePorts } from './archive-notes.ts';

const path = (raw: string): VaultPath => createVaultPath(raw);
const TODAY = '2026-09-27';

function memoryVault(notes: Record<string, string>, folders: string[] = []) {
  const files = new Map(Object.entries(notes));
  const dirs = new Set<string>(folders);
  const log: string[] = [];
  const failWrites = new Set<string>();
  const exists = (at: string) => dirs.has(at) || files.has(at);
  const entry = (at: string, kind: VaultEntry['kind']): VaultEntry =>
    ({ kind, name: vaultPathName(path(at)), path: path(at) }) as VaultEntry;

  const fs = fakeVaultFs({
    listDirectory: async (parent) => [
      ...[...dirs]
        .filter((at) => parentVaultPath(path(at)) === parent)
        .map((at) => entry(at, 'directory')),
      ...[...files.keys()]
        .filter((at) => parentVaultPath(path(at)) === parent)
        .map((at) => entry(at, 'file')),
    ],
    createFolder: async ({ path: at }) => {
      if (exists(at)) throw new VaultAccessError('something with that name is already there');
      if (parentVaultPath(at) !== '' && !dirs.has(parentVaultPath(at))) {
        throw new VaultAccessError('no such folder');
      }
      dirs.add(at);
      log.push(`mkdir ${at}`);
    },
    moveEntry: async (move: EntryMove) => {
      if (!files.has(move.from)) throw new VaultAccessError('no such entry');
      if (exists(move.to)) throw new VaultAccessError('something with that name is already there');
      const folder = parentVaultPath(move.to);
      if (folder !== '' && !dirs.has(folder)) throw new VaultAccessError('no such folder');
      for (const [at, text] of [...files]) {
        const to = movedPath(at as VaultPath, move);
        if (to !== null) {
          files.delete(at);
          files.set(to, text);
        }
      }
      log.push(`move ${move.from} -> ${move.to}`);
    },
    readTextFile: async (at) => {
      const text = files.get(at);
      if (text === undefined) throw new VaultAccessError('no such note');
      return { text, modified: 1 };
    },
    readNotes: async (paths) =>
      paths.flatMap((at) => {
        const text = files.get(at);
        return text === undefined ? [] : [{ path: at, text, modified: 1, size: text.length }];
      }),
    writeTextFile: async ({ path: at, contents }) => {
      if (failWrites.has(at)) throw new VaultAccessError('the note changed on disk');
      files.set(at, contents);
      log.push(`write ${at}`);
      return 2;
    },
  });
  return { fs, files, dirs, log, failWrites, notePaths: () => [...files.keys()].map(path) };
}

function portsFor(vault: ReturnType<typeof memoryVault>, dirty: string[] = []): ArchivePorts {
  const unsaved = new Set(dirty);
  return {
    fs: vault.fs,
    markdown: fakeMarkdown(),
    index: fakeIndexPort({
      remove: async (paths) => void vault.log.push(`unindex ${paths.join(',')}`),
    }),
    editors: {
      state: (at) => (unsaved.has(at) ? 'dirty' : 'closed'),
      flush: async (paths) => {
        for (const at of paths.filter((each) => unsaved.has(each))) {
          unsaved.delete(at);
          vault.log.push(`flush ${at}`);
        }
      },
      follow: (move) => {
        for (const at of [...unsaved]) {
          const to = movedPath(at as VaultPath, move);
          if (to !== null) {
            unsaved.delete(at);
            unsaved.add(to);
          }
        }
        vault.log.push(`follow ${move.from} -> ${move.to}`);
      },
      abandon: () => {},
      reload: (at) => void vault.log.push(`reload ${at}`),
    },
  };
}

async function archive(
  vault: ReturnType<typeof memoryVault>,
  paths: string[],
  updateLinks = false,
) {
  return archiveNotes({
    ports: portsFor(vault),
    paths: paths.map(path),
    notePaths: vault.notePaths(),
    today: TODAY,
    updateLinks,
  });
}

async function unarchive(vault: ReturnType<typeof memoryVault>, paths: string[]) {
  return unarchiveNotes({
    ports: portsFor(vault),
    paths: paths.map(path),
    notePaths: vault.notePaths(),
  });
}

describe('archiveNotes', () => {
  it('moves the note under Archive at the path it had, making the folders it needs', async () => {
    const vault = memoryVault({ 'Projects/X.md': 'Body.\n' }, ['Projects']);
    const outcome = await archive(vault, ['Projects/X.md']);

    expect(outcome.failed).toEqual([]);
    expect(outcome.moves.map((each) => each.move)).toEqual([
      { from: 'Projects/X.md', to: 'Archive/Projects/X.md' },
    ]);
    expect([...vault.files.keys()]).toEqual(['Archive/Projects/X.md']);
    expect([...vault.dirs]).toEqual(['Projects', 'Archive', 'Archive/Projects']);
  });

  it('stamps the day and where it came from, and leaves the body byte for byte', async () => {
    const vault = memoryVault({ 'X.md': '---\nstatus: done\n---\n\n# X\n\n  Body  \n' });
    await archive(vault, ['X.md']);

    expect(vault.files.get('Archive/X.md')).toBe(
      '---\nstatus: done\narchived: 2026-09-27\narchivedFrom: X.md\n---\n\n# X\n\n  Body  \n',
    );
  });

  it('files it in the Archive folder the disk already has, however it is spelled', async () => {
    const vault = memoryVault({ 'X.md': '' }, ['archive']);
    await archive(vault, ['X.md']);
    expect([...vault.files.keys()]).toEqual(['archive/X.md']);
  });

  it('numbers the name when an archived note already has it', async () => {
    const vault = memoryVault({ 'Projects/X.md': 'new', 'Archive/Projects/X.md': 'old' }, [
      'Projects',
      'Archive',
      'Archive/Projects',
    ]);
    await archive(vault, ['Projects/X.md']);

    expect(vault.files.get('Archive/Projects/X 2.md')).toContain('archivedFrom: Projects/X.md');
    expect(vault.files.get('Archive/Projects/X.md')).toBe('old');
  });

  it('writes a pane’s unsaved typing before moving, and re-reads the pane after stamping', async () => {
    const vault = memoryVault({ 'X.md': 'Body.\n' });
    await archiveNotes({
      ports: portsFor(vault, ['X.md']),
      paths: [path('X.md')],
      notePaths: vault.notePaths(),
      today: TODAY,
    });
    expect(vault.log.filter((line) => !line.startsWith('mkdir'))).toEqual([
      'flush X.md',
      'move X.md -> Archive/X.md',
      'follow X.md -> Archive/X.md',
      'unindex X.md',
      'write Archive/X.md',
      'reload Archive/X.md',
    ]);
  });

  it('refuses what cannot be archived and carries on with the rest', async () => {
    const vault = memoryVault({ 'A.md': '', '.atlas/views/Board.md': '', 'Archive/Old.md': '' }, [
      '.atlas',
      '.atlas/views',
      'Archive',
    ]);
    const outcome = await archive(vault, ['.atlas/views/Board.md', 'Archive/Old.md', 'A.md']);

    expect(outcome.moves.map((each) => each.move.to)).toEqual(['Archive/A.md']);
    expect(outcome.failed).toEqual([
      { path: '.atlas/views/Board.md', reason: 'Atlas keeps its own files where they are.' },
      { path: 'Archive/Old.md', reason: 'It is already archived.' },
    ]);
  });

  it('reports a note the disk will not move, and moves the others', async () => {
    const vault = memoryVault({ 'A.md': '', 'B.md': '' });
    const outcome = await archive(vault, ['Gone.md', 'B.md']);
    expect(outcome.failed).toEqual([{ path: 'Gone.md', reason: 'no such entry' }]);
    expect(outcome.moves.map((each) => each.move.to)).toEqual(['Archive/B.md']);
  });

  it('keeps a note archived whose stamp could not be written, and says so', async () => {
    const vault = memoryVault({ 'A.md': 'Body.\n' });
    vault.failWrites.add('Archive/A.md');
    const outcome = await archive(vault, ['A.md']);

    expect(outcome.moves.map((each) => each.move.to)).toEqual(['Archive/A.md']);
    expect(outcome.failed).toEqual([
      {
        path: 'Archive/A.md',
        reason: 'Moved, but its frontmatter was not updated: the note changed on disk',
      },
    ]);
    // Unarchiving still knows where it came from, by its path.
    vault.failWrites.clear();
    await unarchive(vault, ['Archive/A.md']);
    expect(vault.files.get('A.md')).toBe('Body.\n');
  });

  it('rewrites the links each move leaves behind when asked, and counts them', async () => {
    const vault = memoryVault(
      {
        'Projects/X.md': 'Body.\n',
        'Other/X.md': 'Another X.\n',
        'Linker.md': 'See [[Projects/X]] and [[X]].\n',
      },
      ['Projects', 'Other'],
    );
    const outcome = await archive(vault, ['Projects/X.md'], true);

    expect(outcome.linksUpdated).toBe(1);
    expect(vault.files.get('Linker.md')).toBe('See [[Archive/Projects/X]] and [[X]].\n');
  });

  it('reads the vault once for a whole batch, and rewrites every link in one pass (A20-05)', async () => {
    const vault = memoryVault(
      {
        'Projects/A.md': 'A.\n',
        'Projects/B.md': 'B.\n',
        'Projects/C.md': 'C.\n',
        'Linker.md': 'See [[Projects/A]], [[Projects/B]] and [[Projects/C]].\n',
      },
      ['Projects'],
    );
    const ports = portsFor(vault);
    const readNotes = vi.fn(ports.fs.readNotes);
    const outcome = await archiveNotes({
      ports: { ...ports, fs: { ...ports.fs, readNotes } },
      paths: ['Projects/A.md', 'Projects/B.md', 'Projects/C.md'].map(path),
      notePaths: vault.notePaths(),
      today: TODAY,
      updateLinks: true,
    });

    expect(outcome.failed).toEqual([]);
    expect(readNotes).toHaveBeenCalledTimes(1);
    expect(outcome.linksUpdated).toBe(3);
    expect(vault.files.get('Linker.md')).toBe(
      'See [[Archive/Projects/A]], [[Archive/Projects/B]] and [[Archive/Projects/C]].\n',
    );
    expect(vault.log.filter((line) => line === 'write Linker.md')).toHaveLength(1);
  });

  it('keeps a note archived whose links could not be rewritten, and says so', async () => {
    const vault = memoryVault({ 'A.md': 'Body.\n' });
    const ports = portsFor(vault);
    const outcome = await archiveNotes({
      ports: {
        ...ports,
        fs: { ...ports.fs, readNotes: async () => Promise.reject(new Error('disk gone')) },
      },
      paths: [path('A.md')],
      notePaths: vault.notePaths(),
      today: TODAY,
      updateLinks: true,
    });
    expect(outcome.moves.map((each) => each.move.to)).toEqual(['Archive/A.md']);
    expect(outcome.failed).toEqual([
      { path: 'Archive/A.md', reason: 'Moved, but its links were not updated: disk gone' },
    ]);
  });

  it('leaves the links alone when not asked, for the person to be offered them', async () => {
    const vault = memoryVault({ 'Projects/X.md': '', 'Linker.md': 'See [[Projects/X]].\n' }, [
      'Projects',
    ]);
    const outcome = await archive(vault, ['Projects/X.md']);
    expect(outcome.linksUpdated).toBe(0);
    expect(vault.files.get('Linker.md')).toBe('See [[Projects/X]].\n');
  });
});

describe('unarchiveNotes', () => {
  it('puts a note back at the path it recorded and takes the stamps off', async () => {
    const vault = memoryVault(
      {
        'Archive/Projects/X 2.md':
          '---\nstatus: done\narchived: 2026-09-01\narchivedFrom: Projects/X.md\n---\n\nBody.\n',
      },
      ['Archive', 'Archive/Projects'],
    );
    const outcome = await unarchive(vault, ['Archive/Projects/X 2.md']);

    expect(outcome.failed).toEqual([]);
    expect([...vault.files]).toEqual([['Projects/X.md', '---\nstatus: done\n---\n\nBody.\n']]);
  });

  it('round-trips a note that had no frontmatter back to exactly its bytes', async () => {
    const original = '# Plan\n\nBody with  two spaces.\n';
    const vault = memoryVault({ 'Projects/Plan.md': original }, ['Projects']);
    await archive(vault, ['Projects/Plan.md']);
    expect(vault.files.get('Archive/Projects/Plan.md')).not.toBe(original);

    await unarchive(vault, ['Archive/Projects/Plan.md']);
    expect([...vault.files]).toEqual([['Projects/Plan.md', original]]);
  });

  it('numbers the name when something has taken the path since', async () => {
    const vault = memoryVault(
      { 'X.md': 'new', 'Archive/X.md': '---\narchivedFrom: X.md\n---\nold\n' },
      ['Archive'],
    );
    await unarchive(vault, ['Archive/X.md']);
    expect(vault.files.get('X 2.md')).toBe('old\n');
    expect(vault.files.get('X.md')).toBe('new');
  });

  it('goes back by its path when the note does not record one', async () => {
    const vault = memoryVault({ 'Archive/Old/Y.md': 'y' }, ['Archive', 'Archive/Old']);
    await unarchive(vault, ['Archive/Old/Y.md']);
    expect([...vault.files]).toEqual([['Old/Y.md', 'y']]);
    expect(vault.dirs.has('Old')).toBe(true);
  });

  it('gives two notes that both came from one path a number each, never the same path', async () => {
    const vault = memoryVault(
      {
        'Archive/X.md': '---\narchivedFrom: X.md\n---\nfirst',
        'Archive/X 2.md': '---\narchivedFrom: X.md\n---\nsecond',
      },
      ['Archive'],
    );
    await unarchive(vault, ['Archive/X.md', 'Archive/X 2.md']);
    expect(Object.fromEntries(vault.files)).toEqual({ 'X.md': 'first', 'X 2.md': 'second' });
  });

  it('keeps a frontmatter block it cannot read, rather than dropping it unread', async () => {
    const vault = memoryVault({ 'Archive/X.md': '---\n: : bad\n---\nBody\n' }, ['Archive']);
    const ports = portsFor(vault);
    await unarchiveNotes({
      ports: { ...ports, markdown: { ...ports.markdown, frontmatterProblem: () => 'unreadable' } },
      paths: [path('Archive/X.md')],
      notePaths: vault.notePaths(),
    });
    expect(vault.files.get('X.md')).toMatch(/^---\n[\s\S]*---\nBody\n$/);
  });

  it('writes a pane’s unsaved typing before reading where the note goes back to (A20-05)', async () => {
    // Archiving numbered the name; on disk the record was since edited away, on screen it is back.
    const vault = memoryVault({ 'Archive/X 2.md': '---\narchivedFrom: Y.md\n---\nBody\n' }, [
      'Archive',
    ]);
    const ports = portsFor(vault, ['Archive/X 2.md']);
    const flush = ports.editors.flush;
    const edited = {
      ...ports.editors,
      flush: async (paths: readonly VaultPath[]) => {
        if (paths.includes(path('Archive/X 2.md'))) {
          vault.files.set('Archive/X 2.md', '---\narchivedFrom: X.md\n---\nBody\n');
        }
        await flush(paths);
      },
    };
    const outcome = await unarchiveNotes({
      ports: { ...ports, editors: edited },
      paths: [path('Archive/X 2.md')],
      notePaths: vault.notePaths(),
    });
    expect(outcome.moves.map((each) => each.move.to)).toEqual(['X.md']);
  });

  it('leaves a pane still being typed in to its own save, rather than re-reading it', async () => {
    const vault = memoryVault({ 'Archive/X.md': '---\narchivedFrom: X.md\n---\nBody\n' }, [
      'Archive',
    ]);
    const ports = portsFor(vault);
    await unarchiveNotes({
      ports: { ...ports, editors: { ...ports.editors, state: () => 'dirty' } },
      paths: [path('Archive/X.md')],
      notePaths: vault.notePaths(),
    });
    expect(vault.files.get('X.md')).toBe('Body\n');
    expect(vault.log.some((line) => line.startsWith('reload'))).toBe(false);
  });

  it('reports a refusal the host gave as plain text', async () => {
    const vault = memoryVault({ 'Archive/X.md': '' }, ['Archive']);
    const ports = portsFor(vault);
    const outcome = await unarchiveNotes({
      ports: { ...ports, fs: { ...ports.fs, moveEntry: () => Promise.reject('locked') } },
      paths: [path('Archive/X.md')],
      notePaths: vault.notePaths(),
    });
    expect(outcome.failed).toEqual([{ path: 'Archive/X.md', reason: 'locked' }]);
  });

  it('refuses a note that is not archived', async () => {
    const vault = memoryVault({ 'X.md': '' });
    const outcome = await unarchive(vault, ['X.md']);
    expect(outcome.failed).toEqual([{ path: 'X.md', reason: 'It is not archived.' }]);
    expect(outcome.moves).toEqual([]);
  });
});

describe('a batch that must leave unsaved typing alone (A20-06)', () => {
  it('leaves a note being typed in where it is, and says why, without saving it', async () => {
    const vault = memoryVault({ 'A.md': 'a\n', 'B.md': 'b\n' });
    const outcome = await archiveNotes({
      ports: portsFor(vault, ['A.md']),
      paths: [path('A.md'), path('B.md')],
      notePaths: vault.notePaths(),
      today: TODAY,
      unsavedTyping: 'leave',
    });

    expect(outcome.moves.map((each) => each.move.to)).toEqual(['Archive/B.md']);
    expect(outcome.failed).toEqual([
      { path: 'A.md', reason: expect.stringMatching(/unsaved/), unsavedInApp: true },
    ]);
    expect(vault.files.has('A.md')).toBe(true);
    expect(vault.log.some((line) => line.startsWith('flush'))).toBe(false);
  });

  it('leaves a linking note being typed in unwritten, and names it', async () => {
    const vault = memoryVault({ 'Projects/X.md': 'x\n', 'Linker.md': 'See [[Projects/X]].\n' });
    const outcome = await archiveNotes({
      ports: portsFor(vault, ['Linker.md']),
      paths: [path('Projects/X.md')],
      notePaths: vault.notePaths(),
      today: TODAY,
      updateLinks: true,
      unsavedTyping: 'leave',
    });

    expect(outcome.moves.map((each) => each.move.to)).toEqual(['Archive/Projects/X.md']);
    expect(vault.files.get('Linker.md')).toBe('See [[Projects/X]].\n');
    expect(outcome.failed).toEqual([
      { path: 'Linker.md', reason: expect.stringMatching(/unsaved/), unsavedInApp: true },
    ]);
    expect(vault.log.some((line) => line.startsWith('flush'))).toBe(false);
  });

  it('still saves the typing first when the person asked from the app', async () => {
    const vault = memoryVault({ 'Projects/X.md': 'x\n', 'Linker.md': 'See [[Projects/X]].\n' });
    const outcome = await archiveNotes({
      ports: portsFor(vault, ['Linker.md']),
      paths: [path('Projects/X.md')],
      notePaths: vault.notePaths(),
      today: TODAY,
      updateLinks: true,
    });

    expect(outcome.failed).toEqual([]);
    expect(vault.log).toContain('flush Linker.md');
    expect(vault.files.get('Linker.md')).toBe('See [[Archive/Projects/X]].\n');
  });
});

describe('a link rewrite that fails for one note (A20-06)', () => {
  it('names the linking note it could not write, and why', async () => {
    const vault = memoryVault({
      'Projects/X.md': 'x\n',
      'Stuck.md': 'See [[Projects/X]].\n',
      'Fine.md': 'Also [[Projects/X]].\n',
    });
    vault.failWrites.add('Stuck.md');
    const outcome = await archive(vault, ['Projects/X.md'], true);

    expect(outcome.linksUpdated).toBe(1);
    expect(vault.files.get('Fine.md')).toBe('Also [[Archive/Projects/X]].\n');
    expect(outcome.failed).toEqual([
      { path: 'Stuck.md', reason: expect.stringContaining('the note changed on disk') },
    ]);
  });
});

describe('unarchiving a note whose frontmatter cannot be read (A20-06)', () => {
  it('moves it back and reports the block it left as it was', async () => {
    const vault = memoryVault({ 'Archive/X.md': '---\n: : bad\n---\nBody\n' }, ['Archive']);
    const ports = portsFor(vault);
    const outcome = await unarchiveNotes({
      ports: { ...ports, markdown: { ...ports.markdown, frontmatterProblem: () => 'unreadable' } },
      paths: [path('Archive/X.md')],
      notePaths: vault.notePaths(),
    });

    expect(vault.files.get('X.md')).toBe('---\n: : bad\n---\nBody\n');
    expect(outcome.failed).toEqual([
      { path: 'X.md', reason: expect.stringContaining('unreadable') },
    ]);
  });
});
