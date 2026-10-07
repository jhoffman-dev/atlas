import { describe, expect, it } from 'vitest';
import { journalText } from '@atlas/domain';
import { recordingActivity } from '../testing/fake-activity.ts';
import {
  fakeBlob,
  failed,
  memoryVault,
  memorySyncFiles,
  said,
  scriptedGit,
  statusText,
  type GitScript,
} from '../testing/fake-git.ts';
import { syncNow } from './sync-now.ts';

const clock = { now: () => 1_000, localNow: () => '2026-09-28T14:05:00' };
const MARKERS = /^(<<<<<<<|=======|>>>>>>>)/m;
/** What a merge leaves in a text file both sides changed. */
const MARKED = '<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> origin/main\n';
const HASH = 'a'.repeat(40);
/** macOS refuses a file name longer than this many UTF-8 bytes, as the host's move does. */
const NAME_MAX_BYTES = 255;

function setUp({
  script = {},
  files = {},
  sides = {},
  syncFiles = {},
}: {
  script?: GitScript;
  files?: Record<string, string>;
  sides?: Record<string, { ours: string; theirs: string }>;
  syncFiles?: Partial<Record<'journal.json' | 'exclude', string>>;
}) {
  const vault = memoryVault(files);
  const { git, called } = scriptedGit({ script, vault: vault.files, sides });
  const fs = {
    ...vault.fs,
    moveEntry: async (args: Parameters<typeof vault.fs.moveEntry>[0]) => {
      const tooLong = args.to
        .split('/')
        .some((name) => new TextEncoder().encode(name).length > NAME_MAX_BYTES);
      if (tooLong) throw new Error('cannot move: File name too long (os error 63)');
      return vault.fs.moveEntry(args);
    },
  };
  const { port: syncFilesPort } = memorySyncFiles(syncFiles);
  const activity = recordingActivity();
  const run = () =>
    syncNow({
      ports: { git, fs, files: syncFilesPort, unsaved: { flushAll: async () => {} }, activity },
      mac: 'Studio',
      clock,
    });
  return { run, called, files: vault.files, activity };
}

/**
 * A run where the merge freshly hits conflicts, giving each `path` its
 * actual text so a settled copy is written with it (see `sync-now.test.ts`
 * for why: `writeFromIndex` looks a copy's text up by its blob).
 */
function conflicted(
  conflicts: readonly { path: string; code: string }[],
  {
    changed = ['Mine.md'] as readonly string[],
    ahead = 2,
    sides = {} as Record<string, { ours: string; theirs: string }>,
  } = {},
): GitScript {
  const withBlobs = conflicts.map((conflict) => {
    const side = sides[conflict.path];
    return side === undefined
      ? conflict
      : { ...conflict, oursOid: fakeBlob(side.ours), theirsOid: fakeBlob(side.theirs) };
  });
  return {
    status: [
      said(statusText()),
      said(statusText()),
      said(statusText()),
      said(statusText({ changed })),
      // `behind: 1`: otherwise mergeFromOrigin never attempts the merge.
      said(statusText({ behind: 1 })),
      said(statusText({ conflicts: withBlobs })),
      said(statusText({ ahead })),
    ],
    merge: failed('CONFLICT (content): Merge conflict'),
  };
}

describe('syncNow, adversarially', () => {
  it('pushes this Mac’s commits when the branch it tracks is not on GitHub yet (a clone of an empty repository)', async () => {
    // `git status` after cloning an empty repository names the upstream but
    // prints no `branch.ab`, because origin/main does not exist yet.
    const tracksMissing = said(
      [`# branch.oid ${HASH}`, '# branch.head main', '# branch.upstream origin/main']
        .map((record) => `${record}\0`)
        .join(''),
    );
    const { run, called } = setUp({
      script: {
        status: [
          said(statusText()),
          said(statusText()),
          said(statusText()),
          said(statusText({ changed: ['First.md'] })),
          tracksMissing,
        ],
        remoteBranchExists: failed('', 1),
      },
    });
    const report = await run();
    expect(report.committed).toBe(true);
    expect(called('push')).toHaveLength(1);
    expect(report.pushed).toBe(true);
  });

  it('concludes a merge whose conflicts were settled and staged before a quit, instead of failing every sync after', async () => {
    // Real git after `checkout --ours` + `add --all` on every conflict: MERGE_HEAD
    // stays, status lists nothing, and a new merge is refused.
    let concluded = false;
    const { run, called } = setUp({
      script: {
        status: [said(statusText()), said(statusText()), said(statusText({ ahead: 1 }))],
        mergeInProgress: () => (concluded ? failed('', 1) : said(`${HASH}\n`)),
        commit: () => ((concluded = true), said('')),
        // As git does: no merge while one waits to be committed.
        merge: () =>
          concluded
            ? said('')
            : failed(
                'fatal: You have not concluded your merge (MERGE_HEAD exists).\nPlease, commit your changes before you merge.\n',
                128,
              ),
      },
    });
    await expect(run()).resolves.toMatchObject({ pushed: true });
    expect(called('commit').length).toBeGreaterThan(0);
  });

  it('never throws away typing made in a note a failed sync left in conflict', async () => {
    // The last sync recorded the journal, then quit before settling; the
    // person then typed in the note, replacing what the merge had written.
    // The next sync must know the file no longer holds the merge's markers —
    // which only the journal it wrote first can tell it.
    const typed = 'mine, and a paragraph typed after the failed sync\n';
    const sides = { 'Ideas.md': { ours: 'mine\n', theirs: 'theirs\n' } };
    const journal = journalText({
      mergeHead: 'deadfeed',
      unreported: [],
      files: [
        {
          path: 'Ideas.md',
          merged: fakeBlob(MARKED),
          ours: fakeBlob(sides['Ideas.md'].ours),
          theirs: fakeBlob(sides['Ideas.md'].theirs),
          copy: null,
        },
      ],
    });
    const conflict = {
      path: 'Ideas.md',
      code: 'UU',
      oursOid: fakeBlob(sides['Ideas.md'].ours),
      theirsOid: fakeBlob(sides['Ideas.md'].theirs),
    };
    const { run, files } = setUp({
      script: {
        status: [
          said(statusText({ conflicts: [conflict] })),
          said(statusText({ conflicts: [conflict] })),
          said(statusText()),
          said(statusText()),
          said(statusText()),
          said(statusText({ ahead: 1 })),
        ],
        mergeInProgress: said('deadfeed\n'),
      },
      files: { 'Ideas.md': typed },
      sides,
      syncFiles: { 'journal.json': journal },
    });
    await run();
    expect([...files.values()]).toContain(typed);
  });

  it('leaves this Mac’s version in place when the other Mac’s copy cannot be saved', async () => {
    const title = `${'A long meeting title '.repeat(11)}.md`; // a valid 234-byte name
    const path = `Meetings/${title}`;
    const sides = { [path]: { ours: 'mine\n', theirs: 'theirs\n' } };
    const { run, files } = setUp({
      script: conflicted([{ path, code: 'UU' }], { sides }),
      files: { [path]: MARKED },
      sides,
    });
    await run().catch(() => undefined);
    expect(files.get(path)).toBe('mine\n');
  });

  it('settles many conflicts whose copies would collide with each other and with files already there', async () => {
    const paths = [
      'Ideas.md',
      'Ideas (conflict from Laptop).md',
      'Ideas (conflict from Laptop) 2.md',
    ];
    const sides = Object.fromEntries(
      paths.map((path, at) => [path, { ours: `ours ${at}`, theirs: `theirs ${at}` }]),
    );
    const { run, files } = setUp({
      script: {
        ...conflicted(
          paths.map((path) => ({ path, code: 'UU' })),
          { sides },
        ),
        // Each of the three paths is itself tracked (this is what a conflict
        // resolved before settling looks like in the index), so the domain
        // knows a copy must not land on any of them.
        indexEntries: said(
          paths.map((path) => `100644 ${'a'.repeat(40)} 0\t${path}`).join('\0') + '\0',
        ),
      },
      files: Object.fromEntries(paths.map((path) => [path, MARKED])),
      sides,
    });
    const report = await run();
    expect(report.conflicts).toHaveLength(3);
    for (const [at, path] of paths.entries()) {
      expect(files.get(path)).toBe(`ours ${at}`);
      expect([...files.values()]).toContain(`theirs ${at}`);
    }
    expect(new Set(report.conflicts.map(({ copy }) => copy)).size).toBe(3);
    for (const text of files.values()) expect(text).not.toMatch(MARKERS);
  });

  it('makes every missing folder for a copy of a deep .atlas file', async () => {
    const path = '.atlas/automations/logs/nightly.md';
    const sides = { [path]: { ours: 'mine', theirs: 'theirs' } };
    const { run, files } = setUp({
      script: conflicted([{ path, code: 'AA' }], { sides }),
      files: { [path]: MARKED },
      sides,
    });
    await run();
    expect(files.get(path)).toBe('mine');
    expect(
      files.get('Sync conflicts/atlas/automations/logs/nightly (conflict from Laptop).md'),
    ).toBe('theirs');
  });

  it('names the copy for the other Mac even when its last commit was not made by Atlas', async () => {
    const sides = { 'Ideas.md': { ours: 'mine', theirs: 'theirs' } };
    const { run, files } = setUp({
      script: {
        ...conflicted([{ path: 'Ideas.md', code: 'UU' }], { sides }),
        remoteSubject: said('Fix typo\n'),
      },
      files: { 'Ideas.md': MARKED },
      sides,
    });
    await run();
    expect(files.get('Ideas (conflict from another Mac).md')).toBe('theirs');
  });

  it('stops before pushing when a settle step fails, and says so in the Activity log', async () => {
    const { run, called, activity } = setUp({
      script: {
        ...conflicted([{ path: 'Ideas.md', code: 'UU' }]),
        checkout: failed("error: path 'Ideas.md' does not have their version"),
      },
      files: { 'Ideas.md': MARKED },
    });
    await expect(run()).rejects.toThrow('keep this Mac’s version');
    expect(called('push')).toHaveLength(0);
    expect(called('commit')).toHaveLength(1);
    expect(activity.reports.at(-1)).toMatchObject({ level: 'error', kind: 'sync' });
  });
});
