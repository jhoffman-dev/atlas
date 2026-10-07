import { describe, expect, it } from 'vitest';
import { atlasPathsIgnored, ignoredByGitignoreWarning } from './sync-ignore.ts';

// Issue #8: a line of the person's own .gitignore that leaves out `.atlas`
// kept the types, views and settings off GitHub without a word.
describe('Atlas’s own files a .gitignore keeps out of sync', () => {
  const onDisk = [
    '.atlas/settings.md',
    '.atlas/types/task.md',
    '.atlas/types/project.md',
    '.atlas/views/Board.md',
    '.atlas/.DS_Store',
    '.atlas/types/.DS_Store',
  ];

  it('is nothing when git sees every file, tracked or not', () => {
    const inGit = new Set(onDisk.filter((path) => !path.endsWith('.DS_Store')));
    expect(atlasPathsIgnored({ onDisk, inGit })).toEqual([]);
  });

  it('names a file directly in .atlas, and otherwise its folder there, once each', () => {
    expect(atlasPathsIgnored({ onDisk, inGit: new Set() })).toEqual([
      '.atlas/settings.md',
      '.atlas/types/',
      '.atlas/views/',
    ]);
  });

  it('names only what git does not see', () => {
    const inGit = new Set(['.atlas/settings.md', '.atlas/types/task.md', '.atlas/views/Board.md']);
    expect(atlasPathsIgnored({ onDisk, inGit })).toEqual(['.atlas/types/']);
  });

  it('leaves out what Atlas’s own block ignores on purpose', () => {
    expect(atlasPathsIgnored({ onDisk: ['.atlas/.DS_Store'], inGit: new Set() })).toEqual([]);
  });

  it('says what is not synced, that the .gitignore says so, and offers nothing automatic', () => {
    const warning = ignoredByGitignoreWarning('.atlas/types/');
    expect(warning).toContain('.atlas/types/');
    expect(warning).toContain('.gitignore');
    expect(warning).toContain('other Macs');
  });
});
