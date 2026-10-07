import { describe, expect, it } from 'vitest';
import {
  excludesText,
  LARGE_FILE_BYTES,
  largeFiles,
  leftOutWarnings,
  nestedRepositories,
  newlyLeftOut,
  NOTHING_LEFT_OUT,
  parseExcludes,
  type LeftOut,
} from './left-out.ts';

describe('nestedRepositories', () => {
  it('is the untracked paths that are folders, since git never looks inside a repository of its own', () => {
    expect(nestedRepositories(['Notes/Idea.md', 'Projects/site/', 'Inbox/'])).toEqual([
      'Projects/site/',
      'Inbox/',
    ]);
  });

  it('finds none among plain files', () => {
    expect(nestedRepositories(['a.md', 'b.md'])).toEqual([]);
  });
});

describe('largeFiles', () => {
  it('is exactly the files at or over the limit', () => {
    const sizes = new Map([
      ['small.md', 10],
      ['at-limit.bin', LARGE_FILE_BYTES],
      ['over.bin', LARGE_FILE_BYTES + 1],
      ['under.bin', LARGE_FILE_BYTES - 1],
    ]);
    expect(largeFiles(sizes)).toEqual(['at-limit.bin', 'over.bin']);
  });

  it('is a little under GitHub’s 100 MiB limit', () => {
    expect(LARGE_FILE_BYTES).toBeLessThan(100 * 1024 * 1024);
  });
});

describe('excludesText and parseExcludes round trip', () => {
  it.each([
    ['a plain path', ['Notes/Idea.md']],
    ['a folder', ['Projects/site/']],
    ['a path with every gitignore wildcard character', ['Weird * ? [ ] ! # name.md']],
    ['a path with a backslash', ['Weird \\ name.md']],
    ['a path with a trailing space', ['Trailing space.md ']],
    ['several paths together', ['a.bin', 'Nested/', 'name with spaces.md']],
  ])('round-trips %s', (_name, paths) => {
    const leftOut: LeftOut = {
      large: paths.filter((path) => !path.endsWith('/')),
      nested: paths.filter((path) => path.endsWith('/')),
    };
    const text = excludesText(leftOut);
    expect(parseExcludes(text)).toEqual({
      large: [...leftOut.large].sort(),
      nested: [...leftOut.nested].sort(),
    });
  });

  it('reads null as nothing left out', () => {
    expect(parseExcludes(null)).toEqual(NOTHING_LEFT_OUT);
  });

  it('escapes every character gitignore reads as a wildcard, so the pattern matches only that path', () => {
    const text = excludesText({ large: ['Weird * ? [ ] ! # \\ name.md'], nested: [] });
    expect(text).toContain('/Weird \\* \\? \\[ \\] \\! \\# \\\\ name.md');
  });

  it('escapes a trailing space, which gitignore would otherwise drop from the pattern', () => {
    const text = excludesText({ large: ['Trailing space.md '], nested: [] });
    expect(text).toContain('/Trailing space.md\\ \n');
  });

  it('writes a header line the person can read, which parseExcludes ignores', () => {
    const text = excludesText({ large: ['a.bin'], nested: [] });
    expect(text).toContain('Kept out of sync');
    expect(parseExcludes(text)).toEqual({ large: ['a.bin'], nested: [] });
  });

  it('anchors every pattern at the vault’s top', () => {
    const text = excludesText({ large: ['a.bin'], nested: [] });
    expect(text).toContain('\n/a.bin\n');
  });

  it('sorts the patterns it writes', () => {
    const text = excludesText({ large: ['z.bin', 'a.bin'], nested: [] });
    const lines = text.split('\n').filter((line) => line.startsWith('/'));
    expect(lines).toEqual(['/a.bin', '/z.bin']);
  });
});

describe('newlyLeftOut', () => {
  it('is only what was not left out before', () => {
    const before: LeftOut = { large: ['a.bin'], nested: ['Old/'] };
    const now: LeftOut = { large: ['a.bin', 'b.bin'], nested: ['Old/', 'New/'] };
    expect(newlyLeftOut({ before, now })).toEqual({ large: ['b.bin'], nested: ['New/'] });
  });

  it('is nothing when nothing changed', () => {
    const same: LeftOut = { large: ['a.bin'], nested: ['Old/'] };
    expect(newlyLeftOut({ before: same, now: same })).toEqual({ large: [], nested: [] });
  });

  it('is everything the first time, when there was nothing before', () => {
    const now: LeftOut = { large: ['a.bin'], nested: ['New/'] };
    expect(newlyLeftOut({ before: NOTHING_LEFT_OUT, now })).toEqual(now);
  });
});

describe('leftOutWarnings', () => {
  it('explains a large file, naming the size limit', () => {
    const [warning] = leftOutWarnings({ large: ['Movie.mp4'], nested: [] });
    expect(warning).toContain('Movie.mp4');
    expect(warning).toContain('100 MB');
  });

  it('explains a nested repository, with its folder name and no trailing slash', () => {
    const [warning] = leftOutWarnings({ large: [], nested: ['Projects/site/'] });
    expect(warning).toContain('Projects/site is a git repository of its own');
    expect(warning?.endsWith('/')).toBe(false);
  });

  // Issue #8: "move it out of the vault to sync the rest of it alone" read as
  // though nothing synced while the folder stayed.
  it('says plainly that only that folder stays behind and the rest of the vault still syncs', () => {
    const [warning] = leftOutWarnings({ large: [], nested: ['pkm-space/'] });
    expect(warning).toContain('only that folder');
    expect(warning).toContain('the rest of the vault still syncs');
  });

  it('is nothing when nothing is newly left out', () => {
    expect(leftOutWarnings(NOTHING_LEFT_OUT)).toEqual([]);
  });
});
