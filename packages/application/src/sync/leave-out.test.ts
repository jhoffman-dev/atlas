import { describe, expect, it } from 'vitest';
import { createVaultPath, LARGE_FILE_BYTES } from '@atlas/domain';
import { memorySyncFiles, said, scriptedGit, statusText } from '../testing/fake-git.ts';
import { leaveOut } from './leave-out.ts';

/** A folder listing fixed to what a test hands it, files sized as given. */
function fsOf(sizes: Record<string, number>, { missing = new Set<string>() } = {}) {
  return {
    listDirectory: async (folder: ReturnType<typeof createVaultPath>) => {
      if (missing.has(`${folder}`)) throw new Error('no such folder');
      const prefix = folder === '' ? '' : `${folder}/`;
      return Object.entries(sizes)
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(([path, size]) => ({
          kind: 'file' as const,
          name: path.slice(prefix.length),
          path: createVaultPath(path),
          modified: 0,
          size,
        }));
    },
  };
}

describe('leaveOut', () => {
  it('leaves out nothing, and clears then leaves the excludes file empty, when nothing is too large or nested', async () => {
    const { git } = scriptedGit({ script: { status: said(statusText()) } });
    const { port: files, files: written } = memorySyncFiles({ exclude: 'stale' });
    const { leftOut, newly } = await leaveOut({ git, fs: fsOf({}), files });
    expect(leftOut).toEqual({ large: [], nested: [] });
    expect(newly).toEqual({ large: [], nested: [] });
    expect(written.has('exclude')).toBe(false);
  });

  it('leaves out a file at or over GitHub’s limit, by the size the host lists it at', async () => {
    const { git } = scriptedGit({
      script: { status: said(statusText({ changed: ['Big.bin', 'Small.bin'] })) },
    });
    const { port: files, files: written } = memorySyncFiles();
    const { leftOut, newly } = await leaveOut({
      git,
      fs: fsOf({ 'Big.bin': LARGE_FILE_BYTES, 'Small.bin': 10 }),
      files,
    });
    expect(leftOut).toEqual({ large: ['Big.bin'], nested: [] });
    expect(newly).toEqual({ large: ['Big.bin'], nested: [] });
    expect(written.get('exclude')).toContain('/Big.bin');
    expect(written.get('exclude')).not.toContain('Small.bin');
  });

  it('leaves out a folder that is a repository of its own, from what is untracked', async () => {
    const { git } = scriptedGit({
      script: { status: said(statusText({ untracked: ['vendor/'] })) },
    });
    const { port: files } = memorySyncFiles();
    const { leftOut } = await leaveOut({ git, fs: fsOf({}), files });
    expect(leftOut).toEqual({ large: [], nested: ['vendor/'] });
  });

  it('only says what is newly left out, not what was already known', async () => {
    const { git } = scriptedGit({
      script: { status: said(statusText({ changed: ['Big.bin'], untracked: ['vendor/'] })) },
    });
    const { port: files } = memorySyncFiles({
      exclude: '/vendor/\n', // already known from a previous sync
    });
    const { leftOut, newly } = await leaveOut({
      git,
      fs: fsOf({ 'Big.bin': LARGE_FILE_BYTES }),
      files,
    });
    expect(leftOut).toEqual({ large: ['Big.bin'], nested: ['vendor/'] });
    // vendor/ was already known; only Big.bin is new.
    expect(newly).toEqual({ large: ['Big.bin'], nested: [] });
  });

  it('rewrites the excludes file each sync, so a file made smaller syncs again', async () => {
    const { git } = scriptedGit({ script: { status: said(statusText({ changed: ['Big.bin'] })) } });
    const { port: files } = memorySyncFiles({ exclude: '/Big.bin\n' });
    const { leftOut, newly } = await leaveOut({ git, fs: fsOf({ 'Big.bin': 10 }), files });
    expect(leftOut).toEqual({ large: [], nested: [] });
    expect(newly).toEqual({ large: [], nested: [] });
  });

  it('never mistakes a name it cannot spell as a vault path for a large file', async () => {
    const { git } = scriptedGit({ script: { status: said(statusText({ changed: ['a\\b'] })) } });
    const { port: files } = memorySyncFiles();
    const { leftOut } = await leaveOut({ git, fs: fsOf({}), files });
    expect(leftOut).toEqual({ large: [], nested: [] });
  });

  it('measures nothing from a folder git listed that is gone by the time sizes are asked', async () => {
    const { git } = scriptedGit({
      script: { status: said(statusText({ changed: ['Gone/Big.bin'] })) },
    });
    const { port: files } = memorySyncFiles();
    const { leftOut } = await leaveOut({
      git,
      fs: fsOf({ 'Gone/Big.bin': LARGE_FILE_BYTES }, { missing: new Set(['Gone']) }),
      files,
    });
    expect(leftOut).toEqual({ large: [], nested: [] });
  });

  // Issue #8: a line of the person's .gitignore leaving out `.atlas` kept the
  // types, views and settings off GitHub without a word.
  it('names Atlas’s own files that git neither tracks nor lists as untracked', async () => {
    const { git } = scriptedGit({
      script: { status: said(statusText({ untracked: ['.atlas/types/task.md'] })) },
      vault: new Map([['.atlas/settings.md', '---\n---\n']]),
    });
    const { port: files } = memorySyncFiles();
    const { ignored } = await leaveOut({
      git,
      fs: treeOf(['.atlas/settings.md', '.atlas/types/task.md', '.atlas/views/Board.md']),
      files,
    });
    expect(ignored).toEqual(['.atlas/views/']);
  });

  it('names nothing for a vault with no .atlas folder', async () => {
    const { git } = scriptedGit({ script: { status: said(statusText()) } });
    const { port: files } = memorySyncFiles();
    const { ignored } = await leaveOut({ git, fs: treeOf([]), files });
    expect(ignored).toEqual([]);
  });
});

/** A folder listing over these files, with the folders they are in. */
function treeOf(paths: readonly string[]) {
  return {
    listDirectory: async (folder: ReturnType<typeof createVaultPath>) => {
      const prefix = folder === '' ? '' : `${folder}/`;
      const inside = paths.filter((path) => path.startsWith(prefix));
      if (folder !== '' && inside.length === 0) throw new Error('no such folder');
      const names = new Map<string, 'file' | 'directory'>();
      for (const path of inside) {
        const [name = '', ...rest] = path.slice(prefix.length).split('/');
        names.set(name, rest.length > 0 ? 'directory' : 'file');
      }
      return [...names].map(([name, kind]) =>
        kind === 'file'
          ? { kind, name, path: createVaultPath(`${prefix}${name}`), modified: 0, size: 1 }
          : { kind, name, path: createVaultPath(`${prefix}${name}`) },
      );
    },
  };
}
