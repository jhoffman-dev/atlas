// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { withManagedIgnores } from '@atlas/domain';
import {
  failed,
  fakeVaultFs,
  memorySyncFiles,
  OK,
  recordingActivity,
  said,
  scriptedFolders,
  scriptedGit,
  statusText,
  type GitPort,
  type GitResult,
  type GitScript,
} from '@atlas/application';
import { remarkMarkdown } from '@atlas/adapters';
import { useSync, type SyncOptions } from './use-sync.ts';
import { syncConflictNotice, syncIndicatorBadge, syncSettingsView } from './sync-view.ts';
import { QUIT_SYNC_WAIT_MS, SYNC_TICK_MS } from './use-sync-schedule.ts';

const NOT_A_REPO = failed('fatal: not a git repository', 128);
/** What a vault Atlas set up for sync says in its settings, beside its `.gitignore` block. */
const SET_UP = 'sync: github\nautomationsMac: mac-studio\nautomationsMacName: Studio';

/** A clock the test moves by hand. */
function handClock(start = Date.UTC(2026, 8, 28, 14, 5)) {
  let now = start;
  return {
    now: () => now,
    localNow: () => '2026-09-28T14:05:00',
    advance: (ms: number) => (now += ms),
  };
}

/** The vault's settings note and `.gitignore`, as the host's `readNotes` hands them back. */
function vaultFiles(
  frontmatter: string,
  { gitignore = withManagedIgnores(null) as string | null } = {},
) {
  return fakeVaultFs({
    readNotes: async (paths) => [
      ...(paths.includes('.atlas/settings.md')
        ? [{ path: '.atlas/settings.md', text: `---\n${frontmatter}\n---\n`, modified: 1, size: 1 }]
        : []),
      ...(paths.includes('.gitignore') && gitignore !== null
        ? [{ path: '.gitignore', text: gitignore, modified: 1, size: 1 }]
        : []),
    ],
  });
}

/**
 * A repository on GitHub and this Mac's clone of it, as far as a sync can
 * tell: edits to stage, commits to push, other Macs' commits to fetch and
 * merge, and a merge that may stop on a conflict.
 */
function modelGit() {
  const state = {
    edits: [] as string[],
    staged: [] as string[],
    ahead: 0,
    onGitHub: 0,
    fetched: 0,
    head: 1,
    conflictOnMerge: false,
    conflicted: false,
    merging: false,
  };
  const script: GitScript = {
    status: () =>
      said(
        statusText({
          changed: state.staged,
          ahead: state.ahead,
          behind: state.fetched,
          conflicts: state.conflicted ? [{ path: 'Ideas.md', code: 'UU' }] : [],
        }),
      ),
    addAll: () => {
      state.staged = [...state.staged, ...state.edits];
      state.edits = [];
      state.conflicted = false;
      return OK;
    },
    commit: () => {
      state.staged = [];
      state.merging = false;
      state.ahead += 1;
      return OK;
    },
    fetch: () => {
      state.fetched = state.onGitHub;
      return OK;
    },
    merge: () => {
      if (state.fetched === 0) return said('Already up to date.');
      state.fetched = 0;
      state.onGitHub = 0;
      state.head += 1;
      if (!state.conflictOnMerge) return OK;
      state.conflicted = true;
      state.merging = true;
      return failed('CONFLICT (content): Merge conflict in Ideas.md');
    },
    head: () => said(`h${state.head}\u0000100\n`),
    // Every file asked about is there, a copy a settle made among them.
    hashFile: () => said(`${'f'.repeat(40)}\n`),
    mergeInProgress: () => (state.merging ? said(`${'e'.repeat(40)}\n`) : failed('', 1)),
    push: () => {
      state.ahead = 0;
      return OK;
    },
  };
  return { state, script };
}

function setUpHook({
  script = {},
  parentTop,
  settings = SET_UP,
  mac = 'Studio',
  macId = 'mac-studio',
  gitOverrides = {},
  fs,
  paused = false,
  beforeFetch,
}: {
  script?: GitScript;
  parentTop?: ReturnType<typeof said>;
  settings?: string;
  mac?: string;
  macId?: string;
  gitOverrides?: Partial<GitPort>;
  fs?: SyncOptions['fs'];
  paused?: boolean;
  /** Waited on before each fetch runs, so a test can hold one. */
  beforeFetch?: () => Promise<void>;
} = {}) {
  const { git, called } = scriptedGit({ script });
  const order: string[] = [];
  const closeTasks: (() => Promise<void>)[] = [];
  const activity = recordingActivity();
  const clock = handClock();
  const onPulled = vi.fn();
  const pauses = new Map<string, boolean>([['/Users/j/Notes', paused]]);
  const listRepositories = vi.fn(async (): Promise<GitResult> =>
    said(
      JSON.stringify([
        {
          name: 'notes',
          nameWithOwner: 'james/notes',
          defaultBranchRef: { name: 'main' },
          visibility: 'PRIVATE',
          url: 'https://github.com/james/notes',
        },
      ]),
    ),
  );
  const options: SyncOptions = {
    host: {
      git: () => ({
        ...git,
        commit: async (args) => {
          order.push('commit');
          return git.commit(args);
        },
        fetch: async () => {
          await beforeFetch?.();
          return git.fetch();
        },
        ...gitOverrides,
      }),
      files: () => memorySyncFiles().port,
      folders: scriptedFolders(parentTop === undefined ? {} : { topLevelOf: parentTop }),
      github: { listRepositories },
      thisMac: { name: async () => mac, id: async () => macId },
      pause: {
        read: (vault) => pauses.get(vault) ?? false,
        write: (vault, value) => void pauses.set(vault, value),
      },
    },
    fs: fs ?? vaultFiles(settings),
    markdown: remarkMarkdown,
    vaultKey: '/Users/j/Notes',
    changeKey: 'ready:1',
    clock,
    activity,
    flushAll: async () => void order.push('flush'),
    closing: {
      beforeClose: async (task) => {
        closeTasks.push(task);
        return () => {};
      },
    },
    onPulled,
  };
  const hook = renderHook((props: SyncOptions) => useSync(props), { initialProps: options });
  return { hook, called, order, closeTasks, clock, onPulled, options, pauses, listRepositories };
}

/** Moves the hand clock and the timers together, a tick at a time, as time passing would. */
async function wait(clock: ReturnType<typeof handClock>, ms: number) {
  for (let passed = 0; passed < ms; passed += SYNC_TICK_MS) {
    clock.advance(SYNC_TICK_MS);
    await act(async () => vi.advanceTimersByTime(SYNC_TICK_MS));
  }
}

afterEach(() => vi.useRealTimers());

describe('useSync', () => {
  it('pulls as a synced vault opens, writing unsaved typing before it commits', async () => {
    const model = modelGit();
    model.state.edits = ['Today.md'];
    model.state.onGitHub = 1;
    const { hook, order, onPulled } = setUpHook({ script: model.script });
    await waitFor(() => expect(hook.result.current.phase.kind).toBe('synced'));
    expect(order).toEqual(['flush', 'commit']);
    expect(onPulled).toHaveBeenCalledOnce();
    expect(hook.result.current.setup).toMatchObject({ kind: 'set-up' });
    expect(syncIndicatorBadge(hook.result.current)).toEqual({ tone: 'ok', label: 'Synced' });
  });

  it('does nothing to a vault that does not sync, and offers to set it up', async () => {
    const { hook, called } = setUpHook({ script: { topLevel: NOT_A_REPO } });
    await waitFor(() => expect(hook.result.current.phase.kind).toBe('not-set-up'));
    expect(called('fetch')).toHaveLength(0);
    expect(syncSettingsView(hook.result.current, 'Notes')).toMatchObject({
      stage: 'not-set-up',
      suggestedName: 'Notes',
    });
    expect(syncIndicatorBadge(hook.result.current)).toBeNull();
  });

  it('refuses a vault inside another repository, and never syncs it', async () => {
    const { hook, called } = setUpHook({
      script: { topLevel: said('/code\n') },
      parentTop: said('/code\n'),
    });
    await waitFor(() => expect(hook.result.current.phase.kind).toBe('refused'));
    expect(called('fetch')).toHaveLength(0);
    expect(syncSettingsView(hook.result.current, 'vault').problem).toContain(
      'inside another git repository',
    );
  });

  it('warns when both Macs changed a file', async () => {
    const model = modelGit();
    model.state.onGitHub = 1;
    model.state.conflictOnMerge = true;
    const { hook } = setUpHook({ script: model.script });
    await waitFor(() => expect(hook.result.current.phase.kind).toBe('synced'));
    const view = syncSettingsView(hook.result.current, 'Notes');
    expect(view.conflicts).toEqual([
      { path: 'Ideas.md', copy: 'Ideas (conflict from Laptop).md', whose: 'theirs' },
    ]);
    expect(view.tone).toBe('warning');
    expect(syncConflictNotice(hook.result.current.phase)).toContain('Both Macs changed Ideas.md');
  });

  it('says why a sync failed, and keeps the vault set up', async () => {
    const { hook } = setUpHook({
      script: { fetch: failed('fatal: Could not resolve host: github.com') },
    });
    await waitFor(() => expect(hook.result.current.phase.kind).toBe('failed'));
    const view = syncSettingsView(hook.result.current, 'Notes');
    expect(view.problem).toContain('couldn’t be reached');
    expect(view.stage).toBe('set-up');
    expect(view.statusLine).toContain('Last sync failed');
    expect(syncIndicatorBadge(hook.result.current)?.tone).toBe('error');
  });

  it('holds a vault switch until the sync under way has finished', async () => {
    let finishFetch: (result: ReturnType<typeof said>) => void = () => {};
    const { hook, options } = setUpHook({ script: { topLevel: NOT_A_REPO } });
    await waitFor(() => expect(hook.result.current.phase.kind).toBe('not-set-up'));
    const slow = scriptedGit().git;
    hook.rerender({
      ...options,
      host: {
        ...options.host,
        git: () => ({
          ...slow,
          fetch: () => new Promise((resolve) => (finishFetch = resolve)),
        }),
      },
      vaultKey: '/Users/j/Other',
    });
    await waitFor(() => expect(hook.result.current.phase.kind).toBe('syncing'));
    let settled = false;
    const waiting = hook.result.current.settle().then(() => (settled = true));
    await act(async () => {});
    expect(settled).toBe(false);
    finishFetch(said(''));
    await waiting;
    expect(settled).toBe(true);
  });

  it('sets up sync and names this Mac, by its id, for the automations', async () => {
    const written: string[] = [];
    const { hook, options } = setUpHook({ script: { topLevel: [NOT_A_REPO] }, settings: '' });
    hook.rerender({
      ...options,
      fs: {
        ...options.fs,
        createNote: async ({ path, contents }) => void written.push(`${path}:${contents}`),
        writeTextFile: async ({ path, contents }) => {
          written.push(`${path}:${contents}`);
          return 2;
        },
        readTextFile: async () => ({ text: '---\n---\n', modified: 1 }),
        listDirectory: async () => [],
      },
    });
    await waitFor(() => expect(hook.result.current.phase.kind).toBe('not-set-up'));
    act(() => hook.result.current.setUp({ kind: 'new-github', name: 'notes' }));
    await waitFor(() => expect(hook.result.current.phase.kind).toBe('synced'));
    expect(written.some((file) => file.startsWith('.gitignore:'))).toBe(true);
    const settings = written.filter((file) => file.startsWith('.atlas/settings.md:')).join('\n');
    expect(settings).toContain('sync: github');
    expect(settings).toContain('automationsMac: mac-studio');
    expect(settings).toContain('automationsMacName: Studio');
  });

  it('shows why setting up failed', async () => {
    const { hook } = setUpHook({ script: { topLevel: NOT_A_REPO } });
    await waitFor(() => expect(hook.result.current.phase.kind).toBe('not-set-up'));
    act(() => hook.result.current.setUp({ kind: 'existing', url: 'not an address' }));
    await waitFor(() => expect(hook.result.current.problem).not.toBeNull());
    expect(hook.result.current.phase.kind).toBe('not-set-up');
  });
});

describe('useSync: sending and bringing in by itself (A29-01)', () => {
  it('sends a change about half a minute after it, and nothing without one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const model = modelGit();
    const { hook, called, clock, options } = setUpHook({
      script: model.script,
      settings: `${SET_UP}\nsyncInterval: 60`,
    });
    await waitFor(() => expect(hook.result.current.phase.kind).toBe('synced'));
    await waitFor(() => expect(hook.result.current.settings?.pullIntervalMinutes).toBe(60));
    const pushes = called('push').length;
    await wait(clock, 25_000);
    expect(called('commit')).toHaveLength(0);
    model.state.edits = ['Today.md'];
    hook.rerender({ ...options, changeKey: 'ready:2' });
    await wait(clock, 25_000);
    expect(called('commit')).toHaveLength(0);
    await wait(clock, 10_000);
    await waitFor(() => expect(called('commit')).toHaveLength(1));
    expect(called('push').length).toBe(pushes + 1);
  });

  it('sends at least every five minutes while changes keep coming', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const model = modelGit();
    const { hook, called, clock, options } = setUpHook({
      script: model.script,
      settings: `${SET_UP}\nsyncInterval: 60`,
    });
    await waitFor(() => expect(hook.result.current.phase.kind).toBe('synced'));
    await waitFor(() => expect(hook.result.current.settings?.pullIntervalMinutes).toBe(60));
    // A change every 20 s from the first one: the half-minute quiet never comes.
    for (let second = 0; second < 300; second += 20) {
      model.state.edits = [`Log ${second}.md`];
      hook.rerender({ ...options, changeKey: `ready:${second}` });
      await wait(clock, 20_000);
      if (second + 20 < 300) expect(called('commit'), `${second + 20} s in`).toHaveLength(0);
    }
    // Five minutes after the first change, still typing, it is sent.
    await waitFor(() => expect(called('commit')).toHaveLength(1));
  });

  it('looks at GitHub every minute, and brings changes in only when there are some', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const model = modelGit();
    const { hook, called, clock, onPulled } = setUpHook({ script: model.script });
    await waitFor(() => expect(hook.result.current.phase.kind).toBe('synced'));
    const fetches = called('fetch').length;
    const merges = called('merge').length;
    await wait(clock, 60_000);
    await waitFor(() => expect(called('fetch').length).toBe(fetches + 1));
    // Nothing new on GitHub: a look, and no sync.
    expect(called('merge').length).toBe(merges);
    expect(called('addAll')).toHaveLength(1);
    model.state.onGitHub = 2;
    await wait(clock, 60_000);
    await waitFor(() => expect(called('merge').length).toBe(merges + 1));
    await waitFor(() => expect(onPulled).toHaveBeenCalledOnce());
    expect(hook.result.current.behind).toBe(0);
  });

  it('waits for typing to stop before bringing other Macs’ changes in, showing the vault behind', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const model = modelGit();
    const { hook, called, clock, options } = setUpHook({ script: model.script });
    await waitFor(() => expect(hook.result.current.phase.kind).toBe('synced'));
    const merges = called('merge').length;
    model.state.onGitHub = 1;
    // Typing: a change every 20 s, through the minute's look.
    for (let second = 20; second <= 80; second += 20) {
      model.state.edits = [`Draft ${second}.md`];
      hook.rerender({ ...options, changeKey: `ready:${second}` });
      await wait(clock, 20_000);
    }
    await waitFor(() => expect(hook.result.current.behind).toBe(1));
    expect(called('merge').length).toBe(merges);
    expect(syncIndicatorBadge(hook.result.current)).toEqual({
      tone: 'behind',
      label: '1 change to bring in',
    });
    expect(syncSettingsView(hook.result.current, 'Notes').statusLine).toBe(
      '1 change from other Macs to bring in',
    );
    // Typing stops: the sync that sends it brings the other Mac's change in too.
    await wait(clock, 35_000);
    await waitFor(() => expect(called('merge').length).toBe(merges + 1));
    await waitFor(() => expect(hook.result.current.behind).toBe(0));
    expect(syncIndicatorBadge(hook.result.current)).toEqual({ tone: 'ok', label: 'Synced' });
  });

  it('runs nothing by itself while paused, and picks up again when resumed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const model = modelGit();
    const { hook, called, clock, options, pauses } = setUpHook({
      script: model.script,
      paused: true,
    });
    await waitFor(() => expect(hook.result.current.setup?.kind).toBe('set-up'));
    expect(hook.result.current.paused).toBe(true);
    expect(syncIndicatorBadge(hook.result.current)).toEqual({
      tone: 'paused',
      label: 'Sync paused',
    });
    // Paused: not even as the vault opens.
    expect(called('fetch')).toHaveLength(0);
    model.state.edits = ['Today.md'];
    hook.rerender({ ...options, changeKey: 'ready:2' });
    await wait(clock, 120_000);
    expect(called('fetch')).toHaveLength(0);
    expect(called('commit')).toHaveLength(0);
    act(() => hook.result.current.setPaused(false));
    expect(pauses.get('/Users/j/Notes')).toBe(false);
    await wait(clock, 10_000);
    await waitFor(() => expect(called('commit')).toHaveLength(1));
  });

  it('runs a sync asked for during a look at GitHub once the look ends, never beside it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const model = modelGit();
    let hold: Promise<void> | null = null;
    let release: () => void = () => {};
    const { hook, called, clock } = setUpHook({
      script: model.script,
      beforeFetch: () => hold ?? Promise.resolve(),
    });
    await waitFor(() => expect(hook.result.current.phase.kind).toBe('synced'));
    const stages = called('addAll').length;
    hold = new Promise<void>((resolve) => (release = resolve));
    await wait(clock, 60_000);
    act(() => hook.result.current.syncNow());
    await act(async () => {});
    // The look is still waiting on GitHub: the sync has not started beside it.
    expect(called('addAll')).toHaveLength(stages);
    hold = null;
    release();
    await waitFor(() => expect(called('addAll')).toHaveLength(stages + 1));
    await waitFor(() => expect(hook.result.current.phase.kind).toBe('synced'));
  });

  it('still syncs when asked while paused', async () => {
    const model = modelGit();
    const { hook, called } = setUpHook({ script: model.script, paused: true });
    await waitFor(() => expect(hook.result.current.setup?.kind).toBe('set-up'));
    act(() => hook.result.current.syncNow());
    await waitFor(() => expect(called('fetch')).toHaveLength(1));
  });

  it('syncs once more as the window closes, but lets it close when that hangs', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { hook, called, closeTasks, options } = setUpHook({ script: modelGit().script });
    await waitFor(() => expect(hook.result.current.phase.kind).toBe('synced'));
    expect(closeTasks).toHaveLength(1);
    await act(async () => {
      await closeTasks[0]?.();
    });
    expect(called('fetch')).toHaveLength(2);
    hook.rerender({ ...options, flushAll: () => new Promise<void>(() => {}) });
    let closed = false;
    const closing = closeTasks
      .at(-1)?.()
      .then(() => (closed = true));
    await act(async () => vi.advanceTimersByTime(QUIT_SYNC_WAIT_MS - 1));
    expect(closed).toBe(false);
    await act(async () => vi.advanceTimersByTime(1));
    await closing;
    expect(closed).toBe(true);
  });

  it('saves the intervals the person picks', async () => {
    const written: string[] = [];
    const { hook, options } = setUpHook({ script: modelGit().script });
    hook.rerender({
      ...options,
      fs: {
        ...options.fs,
        writeTextFile: async ({ contents }) => {
          written.push(contents);
          return 2;
        },
        readTextFile: async () => ({ text: `---\n${SET_UP}\n---\n`, modified: 1 }),
        listDirectory: async () => [],
      },
    });
    await waitFor(() => expect(hook.result.current.settings).not.toBeNull());
    act(() => hook.result.current.setPushDelay(120));
    await waitFor(() => expect(written.at(-1)).toContain('syncPushDelay: 120'));
    act(() => hook.result.current.setPullInterval(5));
    await waitFor(() => expect(written.at(-1)).toContain('syncInterval: 5'));
  });

  it('lists the person’s GitHub repositories for the picker, and says why it cannot', async () => {
    const { hook, listRepositories } = setUpHook({ script: { topLevel: NOT_A_REPO } });
    await waitFor(() => expect(hook.result.current.phase.kind).toBe('not-set-up'));
    expect(hook.result.current.repositories.kind).toBe('idle');
    act(() => hook.result.current.loadRepositories());
    await waitFor(() => expect(hook.result.current.repositories.kind).toBe('ready'));
    expect(hook.result.current.repositories).toMatchObject({
      repositories: [{ nameWithOwner: 'james/notes', defaultBranch: 'main', isPrivate: true }],
    });
    listRepositories.mockResolvedValueOnce(
      failed('To get started with GitHub CLI, please run:  gh auth login'),
    );
    act(() => hook.result.current.loadRepositories());
    await waitFor(() => expect(hook.result.current.repositories.kind).toBe('failed'));
    expect(hook.result.current.repositories).toMatchObject({
      problem: expect.stringContaining('gh auth login'),
    });
  });
});

describe('useSync, after the A29-01 review', () => {
  /** A vault's files for setting up: the settings note, and anything written. */
  function writableVault(frontmatter = '') {
    const written: string[] = [];
    const fs: SyncOptions['fs'] = {
      ...vaultFiles(frontmatter),
      createNote: async ({ path, contents }) => void written.push(`${path}:${contents}`),
      writeTextFile: async ({ path, contents }) => {
        written.push(`${path}:${contents}`);
        return 2;
      },
      readTextFile: async () => ({ text: '---\n---\n', modified: 1 }),
      listDirectory: async () => [],
    };
    return { fs, written };
  }

  it('runs setting up as the one sync at a time: a vault switch waits for it, and no sync runs beside it', async () => {
    let finish: (result: GitResult) => void = () => {};
    let creating = false;
    const { fs } = writableVault();
    const { hook, called } = setUpHook({
      script: { topLevel: [NOT_A_REPO] },
      settings: '',
      fs,
      gitOverrides: {
        createGitHubRepository: () => {
          creating = true;
          return new Promise((resolve) => (finish = resolve));
        },
      },
    });
    await waitFor(() => expect(hook.result.current.phase.kind).toBe('not-set-up'));
    act(() => hook.result.current.setUp({ kind: 'new-github', name: 'notes' }));
    await waitFor(() => expect(creating).toBe(true));
    let settled = false;
    const waiting = hook.result.current.settle().then(() => (settled = true));
    act(() => hook.result.current.syncNow());
    await act(async () => {});
    expect(settled).toBe(false);
    expect(called('fetch')).toHaveLength(0);
    finish(said(''));
    await waiting;
    expect(settled).toBe(true);
  });

  it('does not sync, commit or push a repository Atlas never set up, even with an origin', async () => {
    // A vault kept with obsidian-git: its own repository, an origin, no Atlas marker.
    const { hook, called } = setUpHook({
      fs: vaultFiles('theme: dark', { gitignore: '.obsidian/workspace.json\n' }),
    });
    await waitFor(() => expect(hook.result.current.phase.kind).toBe('not-set-up'));
    await act(async () => {});
    expect(called('commit')).toHaveLength(0);
    expect(called('fetch')).toHaveLength(0);
    expect(called('push')).toHaveLength(0);
  });

  it('takes a vault for set up only with both of Atlas’s marks', async () => {
    const onlySettings = setUpHook({ fs: vaultFiles(SET_UP, { gitignore: null }) });
    const onlyIgnores = setUpHook({ fs: vaultFiles('theme: dark') });
    const both = setUpHook({ fs: vaultFiles(SET_UP) });
    await waitFor(() => expect(both.hook.result.current.setup?.kind).toBe('set-up'));
    await waitFor(() => expect(onlySettings.hook.result.current.setup?.kind).toBe('not-set-up'));
    await waitFor(() => expect(onlyIgnores.hook.result.current.setup?.kind).toBe('not-set-up'));
  });

  it('runs no scheduled automations until the settings have been read', async () => {
    const neverRead = fakeVaultFs({ readNotes: () => new Promise(() => {}) });
    const { hook } = setUpHook({ fs: neverRead, script: { topLevel: NOT_A_REPO } });
    await waitFor(() => expect(hook.result.current.thisMac).not.toBeNull());
    expect(hook.result.current.automationsHere).toBe(false);
  });

  it('names the Mac for automations by an id of its own, so a renamed Mac keeps them', async () => {
    const renamed = setUpHook({
      settings: 'automationsMac: mac-studio\nautomationsMacName: Studio',
      mac: 'Studio (2)',
      macId: 'mac-studio',
      script: { topLevel: NOT_A_REPO },
    });
    const other = setUpHook({
      settings: 'automationsMac: mac-studio\nautomationsMacName: Studio',
      mac: 'Studio',
      macId: 'mac-laptop',
      script: { topLevel: NOT_A_REPO },
    });
    await waitFor(() => expect(renamed.hook.result.current.settings).not.toBeNull());
    await waitFor(() => expect(other.hook.result.current.settings).not.toBeNull());
    await waitFor(() => expect(renamed.hook.result.current.automationsHere).toBe(true));
    expect(other.hook.result.current.automationsHere).toBe(false);
    expect(syncSettingsView(other.hook.result.current, 'Notes').automationsMac).toBe('Studio');
  });
});

describe('useSync, after the second A29-01 review', () => {
  // [M3] A sync that committed and then could not reach GitHub left its
  // commits unsent until the next edit: a look found nothing behind.
  it('sends what a failed sync left unsent at the next look, with no new edit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const model = modelGit();
    model.state.edits = ['Today.md'];
    let offline = true;
    const script: GitScript = {
      ...model.script,
      fetch: () => {
        if (offline) return failed('fatal: unable to access: Could not resolve host: github.com');
        model.state.fetched = model.state.onGitHub;
        return OK;
      },
    };
    const { hook, called, clock } = setUpHook({ script });
    await waitFor(() => expect(hook.result.current.phase.kind).toBe('failed'));
    expect(model.state.ahead).toBe(1);
    offline = false;
    await wait(clock, 60_000);
    await waitFor(() => expect(called('push')).toHaveLength(1));
    await waitFor(() => expect(hook.result.current.phase.kind).toBe('synced'));
    expect(model.state.ahead).toBe(0);
  });

  // [L1] A tick between a vault switch's wait and the switch itself started
  // a sync on the vault being left, whose host calls were then refused.
  it('starts nothing on the vault being left once a switch has waited for it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const model = modelGit();
    const { hook, called, clock, options } = setUpHook({ script: model.script });
    await waitFor(() => expect(hook.result.current.phase.kind).toBe('synced'));
    model.state.edits = ['Today.md'];
    hook.rerender({ ...options, changeKey: 'ready:2' });
    const fetches = called('fetch').length;
    await act(async () => hook.result.current.settle());
    act(() => hook.result.current.syncNow());
    await act(async () => {});
    expect(called('fetch')).toHaveLength(fetches);
    expect(called('commit')).toHaveLength(0);
    // A switch that never happens — the same vault chosen again — does not
    // stop sync for good: the vault's change is sent once the moment passes.
    await wait(clock, 35_000);
    await waitFor(() => expect(called('commit')).toHaveLength(1));
  });

  // [L8] The last vault's set-up error showed on the next.
  it('forgets why setting up failed once another vault opens', async () => {
    const { hook, options } = setUpHook({ script: { topLevel: NOT_A_REPO } });
    await waitFor(() => expect(hook.result.current.phase.kind).toBe('not-set-up'));
    act(() => hook.result.current.setUp({ kind: 'existing', url: 'not an address' }));
    await waitFor(() => expect(hook.result.current.problem).not.toBeNull());
    hook.rerender({ ...options, vaultKey: '/Users/j/Other' });
    await waitFor(() => expect(hook.result.current.problem).toBeNull());
  });

  // [L3] The window's notice said this Mac's version was kept when a name
  // that differed only in case had put this Mac's file in the copy.
  it('says in the window’s notice when this Mac’s file went to the copy', () => {
    const phase = {
      kind: 'synced' as const,
      report: {
        at: 0,
        committed: true,
        pulled: true,
        pushed: true,
        conflicts: [
          { path: 'idea.md', copy: 'idea (conflict from Laptop).md', whose: 'ours' as const },
        ],
        notSynced: [],
        ignored: [],
      },
    };
    const notice = syncConflictNotice(phase) ?? '';
    expect(notice).not.toContain('This Mac’s version was kept');
    expect(notice).toContain('idea (conflict from Laptop).md');
  });
});
