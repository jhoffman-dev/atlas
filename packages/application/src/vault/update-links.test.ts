/**
 * Links left pointing at a note's old name after it is renamed or moved: found
 * and counted, then, when the person says so, rewritten — through the file for
 * a note no pane holds, with a pane's unsaved typing written first for one
 * that does, and each note that cannot be rewritten reported.
 */
import { describe, expect, it, vi } from 'vitest';
import type { VaultPath } from '@atlas/domain';
import { fakeVaultFs } from '../testing/fake-ports.ts';
import { linksToUpdate, updateLinks } from './update-links.ts';

const PLAN = 'Plan.md' as VaultPath;
const ROADMAP = 'Roadmap.md' as VaultPath;
const move = { from: PLAN, to: ROADMAP };

function vault(files: Record<string, string>, { failOn = '' } = {}) {
  const disk = new Map(Object.entries(files));
  const fs = fakeVaultFs({
    readNotes: async (paths) =>
      paths.map((path) => ({ path, text: disk.get(path) ?? '', modified: 1, size: 1 })),
    readTextFile: async (path) => ({ text: disk.get(path) ?? '', modified: 1 }),
    writeTextFile: async ({ path, contents }) => {
      if (path === failOn) throw new Error('the note changed on disk');
      disk.set(path, contents);
      return 2;
    },
  });
  // The note has already moved when links are looked for.
  const notePaths = [PLAN, ...Object.keys(files).filter((path) => path !== ROADMAP)] as VaultPath[];
  return { fs, disk, notePaths };
}

const FILES = {
  'Roadmap.md': '# Roadmap\n',
  'a.md': 'See [[Plan]] and [[Plan#Goals|goals]].\n',
  'b.md': '---\nproject: "[[Plan]]"\n---\n\nBody.\n',
  'c.md': 'Nothing here but `[[Plan]]`.\n',
};

const closed = () => ({
  state: () => 'closed' as const,
  flush: vi.fn(async () => {}),
  reload: vi.fn(),
});

describe('linksToUpdate', () => {
  it('counts the links a rename left pointing at the old name, by note', async () => {
    const { fs, notePaths } = vault(FILES);
    const found = await linksToUpdate({ fs, move, notePaths });
    expect(found.notes).toEqual([
      { path: 'a.md', count: 2 },
      { path: 'b.md', count: 1 },
    ]);
    expect(found.total).toBe(3);
  });

  it('finds nothing when the move leaves every link opening the note', async () => {
    const { fs, notePaths } = vault({ 'Archive/Plan.md': '', 'a.md': '[[Plan]]' });
    const found = await linksToUpdate({
      fs,
      move: { from: PLAN, to: 'Archive/Plan.md' as VaultPath },
      notePaths: notePaths.filter((path) => path !== 'Archive/Plan.md'),
    });
    expect(found.total).toBe(0);
  });
});

describe('updateLinks', () => {
  it('rewrites each linking note and reports it', async () => {
    const { fs, disk, notePaths } = vault(FILES);
    const found = await linksToUpdate({ fs, move, notePaths });
    const report = await updateLinks({ fs, openNotes: closed(), update: found });
    expect(report).toEqual({ updated: ['a.md', 'b.md'], failed: [] });
    expect(disk.get('a.md')).toBe('See [[Roadmap]] and [[Roadmap#Goals|goals]].\n');
    expect(disk.get('b.md')).toBe('---\nproject: "[[Roadmap]]"\n---\n\nBody.\n');
    expect(disk.get('c.md')).toBe(FILES['c.md']);
  });

  it('writes a pane’s unsaved typing first, and has a clean pane read the note again', async () => {
    const { fs, notePaths } = vault(FILES);
    const found = await linksToUpdate({ fs, move, notePaths });
    const openNotes = {
      state: (path: VaultPath) => (path === 'a.md' ? ('dirty' as const) : ('clean' as const)),
      flush: vi.fn(async () => {}),
      reload: vi.fn(),
    };
    // Still dirty after the flush: typing landed meanwhile, so a.md is left alone.
    const report = await updateLinks({ fs, openNotes, update: found });
    expect(openNotes.flush).toHaveBeenCalledWith(['a.md']);
    // A20-06: marked, so a caller can tell typing left alone from a refused write.
    expect(report.failed).toEqual([
      { path: 'a.md', reason: 'The note has unsaved changes.', unsavedInApp: true },
    ]);
    expect(report.updated).toEqual(['b.md']);
    expect(openNotes.reload).toHaveBeenCalledWith('b.md');
  });

  it('reports a note it could not write, and writes the rest', async () => {
    const { fs, disk, notePaths } = vault(FILES, { failOn: 'a.md' });
    const found = await linksToUpdate({ fs, move, notePaths });
    const report = await updateLinks({ fs, openNotes: closed(), update: found });
    expect(report.failed).toEqual([{ path: 'a.md', reason: 'the note changed on disk' }]);
    expect(disk.get('b.md')).toContain('[[Roadmap]]');
  });
});

describe('linksToUpdate and updateLinks, for a moved note’s images', () => {
  const Q3_BEFORE = 'Work/Plans/q3.md' as VaultPath;
  const Q3_AFTER = 'q3.md' as VaultPath;
  const IMAGE = 'attachments/Pasted image 1.png' as VaultPath;
  const NOTE = 'Intro.\n\n![](../../attachments/Pasted%20image%201.png)\n';
  const q3Move = { from: Q3_BEFORE, to: Q3_AFTER };

  function vaultWithImage({ unlisted = false } = {}) {
    const disk = new Map<string, string>([[Q3_AFTER, NOTE]]);
    const fs = fakeVaultFs({
      listDirectory: async (folder) => {
        if (unlisted) throw new Error('The folder could not be read.');
        return folder === 'attachments'
          ? [{ kind: 'file' as const, name: 'Pasted image 1.png', path: IMAGE }]
          : [];
      },
      readNotes: async (paths) =>
        paths.map((path) => ({ path, text: disk.get(path) ?? '', modified: 1, size: 1 })),
      readTextFile: async (path) => ({ text: disk.get(path) ?? '', modified: 1 }),
      writeTextFile: async ({ path, contents }) => {
        disk.set(path, contents);
        return 2;
      },
    });
    return { fs, disk };
  }

  it('counts the image a move to the vault root broke, and re-points it', async () => {
    const { fs, disk } = vaultWithImage();
    const found = await linksToUpdate({ fs, move: q3Move, notePaths: [Q3_BEFORE] });
    expect(found.notes).toEqual([{ path: Q3_AFTER, count: 1 }]);

    await updateLinks({ fs, openNotes: closed(), update: found });
    expect(disk.get(Q3_AFTER)).toBe('Intro.\n\n![](attachments/Pasted%20image%201.png)\n');
  });

  it('leaves an image it cannot find alone rather than guessing', async () => {
    const { fs } = vaultWithImage({ unlisted: true });
    const found = await linksToUpdate({ fs, move: q3Move, notePaths: [Q3_BEFORE] });
    expect(found.total).toBe(0);
  });
});
