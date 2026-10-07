import { describe, expect, it } from 'vitest';
import { memorySyncFiles, memoryVault, said, scriptedGit } from '../testing/fake-git.ts';
import { SyncError } from './git-steps.ts';
import { followCaseRenames, moveCaseCollisionsAside } from './case-steps.ts';

const OID_A = 'a'.repeat(40);
const OID_B = 'b'.repeat(40);
const OID_C = 'c'.repeat(40);

/** `ls-tree -r -z`: one NUL-joined record per file. */
function tree(entries: readonly { mode?: string; oid: string; path: string }[]): string {
  return (
    entries.map(({ mode = '100644', oid, path }) => `${mode} blob ${oid}\t${path}`).join('\0') +
    (entries.length > 0 ? '\0' : '')
  );
}

describe('followCaseRenames', () => {
  it('records a note git missed as new, because the disk folds its case but the index does not', async () => {
    const { git, called } = scriptedGit({
      script: {
        indexEntries: said(`100644 ${OID_A} 0\tIdea.md\0`),
        untrackedExact: said('idea.md\0'),
      },
    });
    await followCaseRenames(git, {
      branch: 'main',
      born: true,
      upstream: null,
      ahead: 0,
      behind: 0,
      compared: false,
      changed: [],
      staged: [],
      untracked: [],
      conflicts: [],
    });
    expect(called('move').map(({ args }) => args)).toEqual([{ from: 'Idea.md', to: 'idea.md' }]);
  });

  it('moves nothing when every spelling in the index and on disk already agrees', async () => {
    const { git, called } = scriptedGit({
      script: {
        indexEntries: said(`100644 ${OID_A} 0\tIdea.md\0`),
        untrackedExact: said(''),
      },
    });
    await followCaseRenames(git, {
      branch: 'main',
      born: true,
      upstream: null,
      ahead: 0,
      behind: 0,
      compared: false,
      changed: [],
      staged: [],
      untracked: [],
      conflicts: [],
    });
    expect(called('move')).toHaveLength(0);
  });

  it('says why, when git refuses to record the rename', async () => {
    const { git } = scriptedGit({
      script: {
        indexEntries: said(`100644 ${OID_A} 0\tIdea.md\0`),
        untrackedExact: said('idea.md\0'),
        move: { code: 1, stdout: '', stderr: 'fatal: bad source' },
      },
    });
    await expect(
      followCaseRenames(git, {
        branch: 'main',
        born: true,
        upstream: null,
        ahead: 0,
        behind: 0,
        compared: false,
        changed: [],
        staged: [],
        untracked: [],
        conflicts: [],
      }),
    ).rejects.toThrow(SyncError);
  });
});

describe('moveCaseCollisionsAside', () => {
  it('moves this Mac’s file aside, and the other Mac’s takes the name', async () => {
    const { git, called } = scriptedGit({
      script: {
        tree: [
          said(tree([{ oid: OID_A, path: 'idea.md' }])), // HEAD (ours)
          said(tree([{ oid: OID_B, path: 'Idea.md' }])), // origin/main (theirs)
          said(tree([])), // the merge base
        ],
        mergeBase: said(`${OID_C}\n`),
      },
    });
    const { fs } = memoryVault({ 'idea.md': 'mine' });
    const moved = await moveCaseCollisionsAside({
      git,
      fs,
      files: memorySyncFiles().port,
      branch: 'main',
      mac: 'Laptop',
      untracked: [],
    });
    expect(moved).toEqual([
      { path: 'idea.md', copy: 'idea (conflict from Laptop).md', whose: 'ours' },
    ]);
    expect(called('move').map(({ args }) => args)).toEqual([
      { from: 'idea.md', to: 'idea (conflict from Laptop).md' },
    ]);
  });

  it('moves nothing when there is no merge base yet — the two histories share no common commit', async () => {
    const { git } = scriptedGit({
      script: {
        tree: [
          said(tree([{ oid: OID_A, path: 'idea.md' }])),
          said(tree([{ oid: OID_B, path: 'Idea.md' }])),
        ],
        mergeBase: { code: 1, stdout: '', stderr: 'fatal: no merge base' },
      },
    });
    const { fs } = memoryVault({ 'idea.md': 'mine' });
    // Both sides changed the file since there is no common ancestor: still a collision to move aside.
    const moved = await moveCaseCollisionsAside({
      git,
      fs,
      files: memorySyncFiles().port,
      branch: 'main',
      mac: 'Laptop',
      untracked: [],
    });
    expect(moved).toEqual([
      { path: 'idea.md', copy: 'idea (conflict from Laptop).md', whose: 'ours' },
    ]);
  });

  it('names the copy free of every path already on this Mac, ours, theirs or untracked', async () => {
    const { git } = scriptedGit({
      script: {
        tree: [
          said(tree([{ oid: OID_A, path: 'idea.md' }])),
          said(tree([{ oid: OID_B, path: 'Idea.md' }])),
          said(tree([])),
        ],
        mergeBase: said(`${OID_C}\n`),
      },
    });
    const { fs } = memoryVault({
      'idea.md': 'mine',
      'idea (conflict from Laptop).md': 'already used',
    });
    const moved = await moveCaseCollisionsAside({
      git,
      fs,
      files: memorySyncFiles().port,
      branch: 'main',
      mac: 'Laptop',
      // Untracked, but still a name a copy must not take.
      untracked: ['idea (conflict from Laptop).md'],
    });
    expect(moved).toEqual([
      { path: 'idea.md', copy: 'idea (conflict from Laptop) 2.md', whose: 'ours' },
    ]);
  });

  it('moves nothing when no name collides only in case', async () => {
    const { git, called } = scriptedGit({
      script: {
        tree: [
          said(tree([{ oid: OID_A, path: 'idea.md' }])),
          said(tree([{ oid: OID_B, path: 'other.md' }])),
          said(tree([])),
        ],
        mergeBase: said(`${OID_C}\n`),
      },
    });
    const { fs } = memoryVault();
    const moved = await moveCaseCollisionsAside({
      git,
      fs,
      files: memorySyncFiles().port,
      branch: 'main',
      mac: 'Laptop',
      untracked: [],
    });
    expect(moved).toEqual([]);
    expect(called('move')).toHaveLength(0);
  });
});

describe('moveCaseCollisionsAside, after the A29-01 review', () => {
  it('notes each move in the journal before making it, so a sync after a quit reports it', async () => {
    const tree = (...paths: string[]) =>
      said(paths.map((path) => `100644 blob ${'a'.repeat(40)}\t${path}`).join('\0') + '\0');
    const noted: string[] = [];
    const { port: files, files: journal } = memorySyncFiles();
    const { git } = scriptedGit({
      script: {
        tree: [tree('idea.md'), tree('Idea.md')],
        mergeBase: said(''),
        move: () => {
          noted.push(journal.get('journal.json') ?? '');
          return { code: 0, stdout: '', stderr: '' };
        },
      },
    });
    await moveCaseCollisionsAside({
      git,
      fs: memoryVault().fs,
      files,
      branch: 'main',
      mac: 'Laptop',
      untracked: [],
    });
    expect(JSON.parse(noted[0] ?? '{}')).toMatchObject({
      unreported: [{ path: 'idea.md', copy: 'idea (conflict from Laptop).md', whose: 'ours' }],
    });
  });
});
