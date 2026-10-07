import { describe, expect, it } from 'vitest';
import { GitStatusError, parseGitStatus } from './git-status.ts';

/** Records as git prints them with `-z`: each ends in NUL. */
const z = (...records: string[]) => records.map((record) => `${record}\0`).join('');
const HASH = 'a'.repeat(40);

describe('parseGitStatus', () => {
  it('reads the branch, its upstream and how far apart they are', () => {
    const status = parseGitStatus(
      z(
        `# branch.oid ${HASH}`,
        '# branch.head main',
        '# branch.upstream origin/main',
        '# branch.ab +2 -3',
      ),
    );
    expect(status).toEqual({
      branch: 'main',
      born: true,
      upstream: 'origin/main',
      ahead: 2,
      behind: 3,
      compared: true,
      changed: [],
      staged: [],
      untracked: [],
      conflicts: [],
    });
  });

  it('knows a repository with no commit yet, and one with no upstream', () => {
    const status = parseGitStatus(z('# branch.oid (initial)', '# branch.head main'));
    expect(status.born).toBe(false);
    expect(status.compared).toBe(false);
    expect(status.upstream).toBeNull();
    expect(status.ahead).toBe(0);
    expect(status.behind).toBe(0);
  });

  it('knows a detached HEAD', () => {
    expect(parseGitStatus(z(`# branch.oid ${HASH}`, '# branch.head (detached)')).branch).toBeNull();
  });

  it('lists changed, renamed and untracked paths, spaces and all', () => {
    const status = parseGitStatus(
      z(
        '# branch.head main',
        `1 .M N... 100644 100644 100644 ${HASH} ${HASH} Notes/A day out.md`,
        `2 R. N... 100644 100644 100644 ${HASH} ${HASH} R100 New name.md`,
        'Old name.md',
        '? Inbox/Fresh idea.md',
        '! .atlas-cache/index.db',
      ),
    );
    expect(status.changed).toEqual(['Notes/A day out.md', 'New name.md', 'Inbox/Fresh idea.md']);
    expect(status.conflicts).toEqual([]);
    // `X` of `XY` is the index's side: `.` means nothing of this entry is staged yet.
    expect(status.staged).toEqual(['New name.md']);
    expect(status.untracked).toEqual(['Inbox/Fresh idea.md']);
  });

  it('lists every kind of unmerged file with its code', () => {
    const B = 'b'.repeat(40);
    const C = 'c'.repeat(40);
    const ZERO_MODE = '000000';
    // `<m1> <m2> <m3>` are the base's, this Mac's and the other's modes; `<h1> <h2> <h3>` their blobs.
    const unmerged = (
      code: string,
      path: string,
      { m1 = '100644', m2 = '100644', m3 = '100644' } = {},
    ) => `u ${code} N... ${m1} ${m2} ${m3} 100644 ${HASH} ${B} ${C} ${path}`;
    const status = parseGitStatus(
      z(
        unmerged('UU', 'Ideas.md'),
        unmerged('AA', 'New both.md', { m1: ZERO_MODE }),
        unmerged('UD', 'Kept here.md', { m3: ZERO_MODE }),
        unmerged('DU', 'Kept there.md', { m2: ZERO_MODE }),
        unmerged('AU', 'Added here.md', { m1: ZERO_MODE }),
        unmerged('UA', 'Added there.md', { m1: ZERO_MODE }),
        unmerged('DD', 'Gone.md', { m2: ZERO_MODE, m3: ZERO_MODE }),
      ),
    );
    expect(status.conflicts).toEqual([
      {
        path: 'Ideas.md',
        code: 'UU',
        base: { mode: '100644', oid: HASH },
        ours: { mode: '100644', oid: B },
        theirs: { mode: '100644', oid: C },
      },
      {
        path: 'New both.md',
        code: 'AA',
        base: null,
        ours: { mode: '100644', oid: B },
        theirs: { mode: '100644', oid: C },
      },
      {
        path: 'Kept here.md',
        code: 'UD',
        base: { mode: '100644', oid: HASH },
        ours: { mode: '100644', oid: B },
        theirs: null,
      },
      {
        path: 'Kept there.md',
        code: 'DU',
        base: { mode: '100644', oid: HASH },
        ours: null,
        theirs: { mode: '100644', oid: C },
      },
      {
        path: 'Added here.md',
        code: 'AU',
        base: null,
        ours: { mode: '100644', oid: B },
        theirs: { mode: '100644', oid: C },
      },
      {
        path: 'Added there.md',
        code: 'UA',
        base: null,
        ours: { mode: '100644', oid: B },
        theirs: { mode: '100644', oid: C },
      },
      {
        path: 'Gone.md',
        code: 'DD',
        base: { mode: '100644', oid: HASH },
        ours: null,
        theirs: null,
      },
    ]);
    expect(status.changed).toEqual([]);
  });

  it('reads a zero oid alongside a real mode as no file too', () => {
    // Git always zeros mode and oid together for a missing side; either alone tells it.
    const status = parseGitStatus(
      z(`u UD N... 100644 100644 000000 100644 ${HASH} ${HASH} ${'0'.repeat(40)} Note.md`),
    );
    expect(status.conflicts[0]?.theirs).toBeNull();
  });

  it('reads nothing as a clean tree', () => {
    expect(parseGitStatus('').changed).toEqual([]);
  });

  it.each([
    ['an unknown entry', z('X what is this')],
    ['a short entry', z('1 .M N... 100644')],
    ['an entry without a path', z(`1 .M N... 100644 100644 100644 ${HASH} ${HASH} `)],
    ['a bad unmerged code', z(`u XY N... 1 1 1 1 ${HASH} ${HASH} ${HASH} a.md`)],
    ['a bad ahead/behind', z('# branch.ab two -1')],
  ])('refuses %s rather than guessing', (_name, raw) => {
    expect(() => parseGitStatus(raw)).toThrow(GitStatusError);
  });

  it('ignores headers it does not use', () => {
    expect(parseGitStatus(z('# stash 2', '# branch.head main')).branch).toBe('main');
  });
});
