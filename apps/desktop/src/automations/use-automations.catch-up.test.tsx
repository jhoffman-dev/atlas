// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  createVaultPath,
  digestOf,
  movedPath,
  type EntryMove,
  type VaultEntry,
  type VaultPath,
} from '@atlas/domain';
import {
  fakeClaudeStepPorts,
  fakeIndexPort,
  fakeVaultFs,
  recordingActivity,
  type AutomationPorts,
} from '@atlas/application';
import { remarkMarkdown } from '@atlas/adapters';
import { useAutomations, type AutomationsOptions } from './use-automations.ts';

/**
 * A rule a note sets off, and a meeting the import let in just before Atlas
 * was quit (ADR-0028, "Catching up when Atlas opens"): the feed has nothing
 * to say of it on opening, so the rule is run on it once, from what the
 * files and its log say. An archive rule stands in for a Claude step.
 */

const VAULT = '/vaults/home';
const RULE = '.atlas/automations/Sweep.md';
const MEETING = 'Inbox/Meetings/2026-10-06 Standup.md';
const OLDER = 'Inbox/Meetings/2026-10-01 Kickoff.md';

const RULE_TEXT = [
  '---',
  'atlas: automation',
  'name: Sweep',
  'enabled: true',
  'when: a meeting is created',
  'which: FROM meeting',
  'do: archive',
  '---',
  '',
].join('\n');
const LET_IN = '---\ntype: meeting\natlas_import_outcome: imported\n---\n';

/** A vault in memory: each file with the time it was last written, and an index that has read them all. */
function memoryVault(files: Record<string, string>, modified: Record<string, number>) {
  const dirs = new Set(['.atlas', '.atlas/automations', 'Inbox', 'Inbox/Meetings']);
  const parent = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
  const entry = (path: string, kind: VaultEntry['kind']) =>
    ({
      kind,
      name: path.slice(path.lastIndexOf('/') + 1),
      path: createVaultPath(path),
    }) as VaultEntry;
  const fs = fakeVaultFs({
    listNotes: async () =>
      Object.keys(files).map((path) => ({
        name: path.slice(path.lastIndexOf('/') + 1),
        path: createVaultPath(path),
        modified: modified[path] ?? 1,
        size: 1,
      })),
    listDirectory: async (at) => [
      ...[...dirs].filter((dir) => parent(dir) === at).map((dir) => entry(dir, 'directory')),
      ...Object.keys(files)
        .filter((file) => parent(file) === at)
        .map((file) => entry(file, 'file')),
    ],
    readNotes: async (paths) =>
      paths.flatMap((path) => {
        const text = files[path];
        return text === undefined
          ? []
          : [{ path, text, modified: modified[path] ?? 1, size: text.length }];
      }),
    readTextFile: async (path) => {
      const text = files[path];
      if (text === undefined) throw new Error('no such note');
      return { text, modified: modified[path] ?? 1 };
    },
    createFolder: async ({ path }) => void dirs.add(path),
    createNote: async ({ path, contents }) => void (files[path] = contents),
    writeTextFile: async ({ path, contents }) => {
      files[path] = contents;
      return 1;
    },
    moveEntry: async (move: EntryMove) => {
      for (const path of Object.keys(files)) {
        const to = movedPath(path as VaultPath, move);
        if (to === null) continue;
        files[to] = files[path]!;
        delete files[path];
      }
    },
  });
  const meetings = () => Object.keys(files).filter((path) => path.startsWith('Inbox/Meetings/'));
  const index = fakeIndexPort({
    manifest: async () =>
      meetings().map((path) => ({ path, type: 'meeting', digest: digestOf(files[path] ?? '') })),
    query: async (sql, parameters) =>
      sql.includes('value_text FROM props')
        ? // The import's stamps, as the index holds them.
          {
            columns: ['path', 'value_text'],
            rows: meetings().map((path) => [path, 'imported']),
            truncated: false,
          }
        : {
            columns: ['path', 'title', 'type'],
            rows: meetings()
              .filter((path) => parameters.includes(path))
              .map((path) => [path, path, 'meeting']),
            truncated: false,
          },
  });
  const ports: AutomationPorts & { notePaths: readonly VaultPath[] } = {
    fs,
    markdown: remarkMarkdown,
    index,
    editors: {
      state: () => 'closed',
      flush: async () => {},
      follow: () => {},
      abandon: () => {},
      reload: () => {},
    },
    types: [{ name: 'meeting', label: 'Meeting', properties: [] } as never],
    get notePaths() {
      return Object.keys(files).map(createVaultPath);
    },
    claude: fakeClaudeStepPorts(),
  };
  return { files, ports };
}

const clock = { today: () => '2026-10-08', localNow: () => '2026-10-08T09:00:00' };

async function settle() {
  for (let round = 0; round < 8; round += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAutomations: opening a vault whose rule missed a meeting’s arrival', () => {
  const open = (scheduled?: boolean) => {
    // The rule was saved at 100; one meeting was let in before that, one after.
    const vault = memoryVault(
      { [RULE]: RULE_TEXT, [OLDER]: LET_IN, [MEETING]: LET_IN },
      { [RULE]: 100, [OLDER]: 50, [MEETING]: 200 },
    );
    const activity = recordingActivity();
    const options: AutomationsOptions = {
      ports: vault.ports,
      clock,
      vaultKey: VAULT,
      indexKey: '1',
      indexReady: true,
      activity,
      onSettled: vi.fn(),
      ...(scheduled !== undefined && { scheduled }),
    };
    renderHook((props: AutomationsOptions) => useAutomations(props), { initialProps: options });
    return { vault, activity };
  };

  it('runs the rule once on the meeting let in since the rule was saved, and on no older one', async () => {
    const { vault, activity } = open();
    await settle();

    expect(vault.files[MEETING]).toBeUndefined();
    expect(Object.keys(vault.files)).toContain(`Archive/${MEETING}`);
    expect(vault.files[OLDER]).toBe(LET_IN);
    expect(activity.reports.map((report) => report.message)).toEqual([
      'Sweep: Ran when a note appeared or changed — 2026-10-06 Standup. Archived 1 note.',
    ]);
  });

  it('does not on a Mac that does not run the vault’s automations', async () => {
    const { vault } = open(false);
    await settle();

    expect(vault.files[MEETING]).toBe(LET_IN);
  });
});
