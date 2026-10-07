import { describe, expect, it } from 'vitest';
import { conflictCopyPath, macLabel, planConflictSteps } from './conflict-copy.ts';
import { explainGitFailure } from './git-failure.ts';
import { parseGitStatus } from './git-status.ts';
import { withManagedIgnores } from './sync-ignore.ts';
import {
  macOfCommit,
  remoteUrlProblem,
  repositoryNameOf,
  syncCommitMessage,
} from './sync-rules.ts';
import { dueSync, pullIntervalMinutes } from './sync-schedule.ts';

const HASH = 'a'.repeat(40);
const z = (...records: string[]) => records.map((record) => `${record}\0`).join('');
/** macOS refuses a file name longer than this many UTF-8 bytes (APFS and HFS+). */
const NAME_MAX_BYTES = 255;
const bytes = (text: string) => new TextEncoder().encode(text).length;

describe('parseGitStatus on odd paths', () => {
  it('keeps a path with spaces, unicode, `->` and a newline whole', () => {
    const odd = ['My note -> draft.md', 'Café/naïve 日本.md', 'two\nlines.md', ' lead.md'];
    const status = parseGitStatus(
      z(
        `# branch.oid ${HASH}`,
        '# branch.head main',
        ...odd.map((path) => `1 .M N... 100644 100644 100644 ${HASH} ${HASH} ${path}`),
      ),
    );
    expect(status.changed).toEqual(odd);
  });

  it('reads a rename as its new path and skips the old one, even when the old one looks like an entry', () => {
    const status = parseGitStatus(
      z(
        `2 R. N... 100644 100644 100644 ${HASH} ${HASH} R100 New name -> x.md`,
        `1 .M N... 100644 100644 100644 ${HASH} ${HASH} old.md`,
        '? after.md',
      ),
    );
    expect(status.changed).toEqual(['New name -> x.md', 'after.md']);
  });

  it('reads an untracked path that starts like a header or an entry as a path', () => {
    const status = parseGitStatus(z('? # branch.head evil', '? u UU x', '? 1 two'));
    expect(status.branch).toBeNull();
    expect(status.changed).toEqual(['# branch.head evil', 'u UU x', '1 two']);
  });

  it('reads a conflicted path with spaces', () => {
    const status = parseGitStatus(
      z(`u UU N... 100644 100644 100644 100644 ${HASH} ${HASH} ${HASH} A b  c.md`),
    );
    expect(status.conflicts).toEqual([
      {
        path: 'A b  c.md',
        code: 'UU',
        base: { mode: '100644', oid: HASH },
        ours: { mode: '100644', oid: HASH },
        theirs: { mode: '100644', oid: HASH },
      },
    ]);
  });

  it('reads an upstream whose branch is gone as tracking one with nothing ahead', () => {
    // What a clone of an empty repository prints: the upstream, but no `branch.ab`.
    const status = parseGitStatus(
      z('# branch.oid (initial)', '# branch.head main', '# branch.upstream origin/main', '? a.md'),
    );
    expect(status).toMatchObject({ born: false, upstream: 'origin/main', ahead: 0, behind: 0 });
  });
});

describe('conflictCopyPath on odd names', () => {
  const copy = (path: string, mac = 'Laptop', taken: string[] = []) =>
    conflictCopyPath({ path, mac, taken: new Set(taken) });

  it('names a hidden file’s copy after the whole name, and a dotted folder’s file by its own dot', () => {
    expect(copy('.gitignore')).toBe('.gitignore (conflict from Laptop)');
    expect(copy('v1.2/README')).toBe('v1.2/README (conflict from Laptop)');
    expect(copy('a.tar.gz')).toBe('a.tar (conflict from Laptop).gz');
  });

  it('never puts a slash from the Mac’s name into the path', () => {
    expect(copy('Notes/Idea.md', 'Work/Home Mac')).toBe(
      'Notes/Idea (conflict from Work-Home Mac).md',
    );
    expect(macLabel(' / ')).toBe('-');
  });

  it('skips a name taken under another case', () => {
    expect(copy('Idea.md', 'Laptop', ['idea (CONFLICT from laptop).md'])).toBe(
      'Idea (conflict from Laptop) 2.md',
    );
  });

  it('skips a name taken under the other Unicode normalization, which macOS treats as the same file', () => {
    const composed = 'Café.md'.normalize('NFC');
    const takenDecomposed = 'Café (conflict from Laptop).md'.normalize('NFD');
    expect(copy(composed, 'Laptop', [takenDecomposed]).normalize('NFC')).toBe(
      'Café (conflict from Laptop) 2.md'.normalize('NFC'),
    );
  });

  it('keeps the copy’s file name within what macOS can create', () => {
    const longTitle = `${'A long meeting title '.repeat(11)}.md`; // 234 bytes: a valid name
    expect(bytes(longTitle)).toBeLessThanOrEqual(NAME_MAX_BYTES);
    const made = copy(`Meetings/${longTitle}`, 'James’s MacBook Pro (16-inch, 2024)');
    const name = made.slice(made.lastIndexOf('/') + 1);
    expect(bytes(name)).toBeLessThanOrEqual(NAME_MAX_BYTES);
  });

  it('gives each of many copies of the same note its own name', () => {
    const steps = planConflictSteps({
      conflicts: [
        { path: 'Idea.md', code: 'UU' },
        { path: 'idea.md', code: 'AA' },
        { path: 'Idea (conflict from Laptop).md', code: 'UU' },
      ],
      mac: 'Laptop',
      existing: new Set(['Idea.md', 'Idea (conflict from Laptop).md']),
    });
    const copies = steps.flatMap((step) => (step.kind === 'copy-theirs' ? [step.copy] : []));
    expect(new Set(copies.map((path) => path.toLowerCase())).size).toBe(3);
    expect(copies).not.toContain('Idea (conflict from Laptop).md');
  });
});

describe('withManagedIgnores', () => {
  it.each([null, '', '\n', 'node_modules\n', 'node_modules', 'a\r\nb\r\n'])(
    'is the same file a second time round, from %j',
    (start) => {
      const once = withManagedIgnores(start);
      expect(withManagedIgnores(once)).toBe(once);
    },
  );

  it('never drops a line the person wrote when the block’s closing line was deleted', () => {
    const edited = [
      'node_modules/',
      '# >>> Atlas sync (managed: edits between these lines are replaced)',
      '.atlas-cache/',
      'private/diary.md',
      '',
    ].join('\n');
    const once = withManagedIgnores(edited);
    const twice = withManagedIgnores(once);
    expect(twice).toContain('private/diary.md');
    expect(twice).toBe(once);
  });
});

describe('remoteUrlProblem', () => {
  it('refuses an ssh address whose host starts like an option', () => {
    expect(remoteUrlProblem('ssh://-oProxyCommand=open${IFS}-a${IFS}Calculator/x')).not.toBeNull();
  });

  it.each([
    'ext::sh -c x',
    '-uhttps://x',
    'git@github.com:-oProxyCommand=sh',
    'https://github.com/a b',
    'https://',
    'file:///tmp/x',
  ])('refuses %j', (url) => {
    expect(remoteUrlProblem(url)).not.toBeNull();
  });

  // A30: a token pasted into the address lands in `.git/config` in plain text,
  // is handed back to the webview by `remote get-url`, and is shown in
  // Settings → Sync and the host's Connect dialog. Atlas never holds a GitHub
  // login (U-29) and the webview never receives a secret (ADR-0017).
  it.each([
    'https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/james/vault.git',
    'https://james:ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/james/vault.git',
    'ssh://git:hunter2@github.com/james/vault.git',
  ])('refuses an address that carries a login: %j', (url) => {
    expect(remoteUrlProblem(url)).not.toBeNull();
  });
});

describe('repositoryNameOf', () => {
  it.each([
    ['https://github.com/james/notes.git/', 'notes'],
    ['git@github.com:notes.GIT', 'notes'],
    ['/Volumes/USB/My Vault/', 'My Vault'],
    ['https://github.com/james/..', 'vault'],
    ['https://github.com/james/.git', 'vault'],
    ['https://github.com/james/-x', 'vault'],
  ])('names the folder for %j as %j', (url, name) => {
    expect(repositoryNameOf(url)).toBe(name);
  });

  it('names a folder macOS (and the host’s clone check) can create', () => {
    const name = repositoryNameOf(`https://example.com/${'n'.repeat(300)}.git`);
    expect(bytes(name)).toBeLessThanOrEqual(NAME_MAX_BYTES);
  });
});

describe('macOfCommit', () => {
  it.each(['Studio', 'Mac 2026-01-01 10:00', 'James’s (M3) Mac.*+?', '日本のMac'])(
    'reads %j back out of the sync message it wrote',
    (mac) => {
      expect(macOfCommit(syncCommitMessage({ mac, localNow: '2026-09-28T14:05:00' }))).toBe(mac);
    },
  );

  it('reads nothing out of a commit made by hand', () => {
    expect(macOfCommit('Atlas sync from ')).toBeNull();
    expect(macOfCommit('Merge branch main')).toBeNull();
  });
});

describe('dueSync at its edges', () => {
  const idle = {
    paused: false,
    lastSyncAt: 0,
    lastCheckAt: 0,
    lastEditAt: null,
    firstUnsyncedEditAt: null,
    pushDelaySeconds: 30,
    pullIntervalMinutes: 5,
  };

  it('sends a change exactly when the quiet time has passed, and not a millisecond before', () => {
    const at = (now: number) =>
      dueSync({ ...idle, now, lastEditAt: 1_000, firstUnsyncedEditAt: 1_000 });
    expect(at(1_000 + 30_000 - 1)).toBeNull();
    expect(at(1_000 + 30_000)).toBe('push');
  });

  it('never looks at GitHub more than once per interval with no edits', () => {
    const at = (now: number) => dueSync({ ...idle, now, pullIntervalMinutes: 1 });
    expect(at(59_999)).toBeNull();
    expect(at(60_000)).toBe('check');
  });

  it.each([
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
    [-0, 1],
    [0, 1],
    ['', 1],
    [null, 1],
    ['7', 7],
    [10_000, 120],
  ])('reads the look-for-changes setting %j as %j minutes', (value, minutes) => {
    expect(pullIntervalMinutes(value)).toBe(minutes);
  });
});

describe('explainGitFailure', () => {
  it('does not call a refused push a network problem', () => {
    const said = explainGitFailure({
      step: 'push to GitHub',
      stderr:
        "remote: Permission to james/notes.git denied to kid.\nfatal: unable to access 'https://github.com/james/notes.git/': The requested URL returned error: 403\n",
    });
    expect(said).not.toContain('couldn’t be reached');
  });
});
