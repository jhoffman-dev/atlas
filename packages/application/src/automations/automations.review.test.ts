/**
 * A25-01's review findings on Phase 25's runner, undo and rule files: undo
 * only reverses what the rule could have done, a run's changes are always
 * logged or said to be unloggable, the cap never stalls on no-ops, and a
 * rule's log follows its stable id. The vault is held in memory with a
 * real-SQL index; the clock is fixed.
 */
import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  logPathFor,
  MAX_ACTIONS_PER_RUN,
  parseRunLog,
  type AutomationRule,
  type LogEntry,
} from '@atlas/domain';
import { automationVault, jsonNote } from '../testing/automation-vault.ts';
import { adoptAutomations } from './adopt-automations.ts';
import { AutomationLogError } from './automation-log.ts';
import { loadAutomations } from './load-automations.ts';
import { runAutomation } from './run-automation.ts';
import { createAutomation } from './save-automation.ts';
import { undoLastRun } from './undo-last-run.ts';
import type { VaultGuard } from './vault-guard.ts';
import { recordingActivity } from '../testing/fake-activity.ts';

/** Where the runs say how they went; these tests read the rule's own log instead. */
const ACTIVITY = recordingActivity();

const TODAY = '2026-09-27';
const CLOCK = { today: () => TODAY, localNow: () => `${TODAY}T03:00:00` };
const VAULT = '/vaults/home';
const GUARD: VaultGuard = { vault: VAULT, currentVault: () => VAULT };

const FLAG_RULE: AutomationRule = {
  id: 'Flag',
  path: createVaultPath('.atlas/automations/Flag.md'),
  name: 'Flag',
  enabled: true,
  when: { kind: 'daily', at: '03:00' },
  which: 'FROM task',
  olderThanDays: null,
  action: { kind: 'set', values: { flagged: true } },
};

const ARCHIVE_RULE: AutomationRule = {
  ...FLAG_RULE,
  id: 'Tidy',
  path: createVaultPath('.atlas/automations/Tidy.md'),
  name: 'Tidy',
  which: 'FROM task WHERE status = done',
  action: { kind: 'archive' },
};

const logText = (lines: string[]) =>
  [
    '---\natlas: automation-log\n---\n\n# A rule — run log\n',
    '## 2026-09-27 03:00:00 · Ran by hand\n',
    'Changed 1 note.\n',
    ...lines,
    '',
  ].join('\n');

const undoOf = (entry: LogEntry | null) => (entry?.kind === 'undo' ? entry : null);

describe('undo checks every log line against what the rule could have done', () => {
  it('skips a set line for a key the rule does not set, and names it', async () => {
    const vault = automationVault({
      today: TODAY,
      notes: {
        'Tasks/A.md': jsonNote({ type: 'task', status: 'done', flagged: true }),
        [logPathFor(FLAG_RULE.id)]: logText([
          '- set `"Tasks/A.md"` `"status"`: `"doing"` → `"done"`',
          '- set `"Tasks/A.md"` `"flagged"`: nothing → `true`',
        ]),
      },
    });
    const undo = undoOf(
      await undoLastRun({
        ports: vault.ports,
        rule: FLAG_RULE,
        clock: CLOCK,
        activity: ACTIVITY,
        guard: GUARD,
      }),
    );
    expect(vault.properties('Tasks/A.md')).toEqual({ type: 'task', status: 'done' });
    expect(undo?.done.map((action) => 'key' in action && action.key)).toEqual(['flagged']);
    expect(undo?.left).toEqual([
      { path: 'Tasks/A.md', reason: expect.stringMatching(/status/) as unknown },
    ]);
  });

  it('skips a line that would put back a value no property holds, a map', async () => {
    const vault = automationVault({
      today: TODAY,
      notes: {
        'Tasks/A.md': jsonNote({ type: 'task', flagged: true }),
        [logPathFor(FLAG_RULE.id)]: logText([
          '- set `"Tasks/A.md"` `"flagged"`: `{"__proto__":{"x":1}}` → `true`',
        ]),
      },
    });
    const undo = undoOf(
      await undoLastRun({
        ports: vault.ports,
        rule: FLAG_RULE,
        clock: CLOCK,
        activity: ACTIVITY,
        guard: GUARD,
      }),
    );
    expect(vault.properties('Tasks/A.md')['flagged']).toBe(true);
    expect(undo?.left).toHaveLength(1);
  });

  it('puts back a note it archived that day, from where it came', async () => {
    const vault = automationVault({
      today: TODAY,
      notes: {
        'Archive/Tasks/A.md': jsonNote({ archived: TODAY, archivedFrom: 'Tasks/A.md' }),
        [logPathFor(ARCHIVE_RULE.id)]: logText([
          '- archived `"Tasks/A.md"` → `"Archive/Tasks/A.md"`',
        ]),
      },
    });
    await undoLastRun({
      ports: vault.ports,
      rule: ARCHIVE_RULE,
      clock: CLOCK,
      activity: ACTIVITY,
      guard: GUARD,
    });
    expect(vault.files.has('Tasks/A.md')).toBe(true);
  });

  it('names a note it leaves archived because its stamp is not the run’s', async () => {
    const vault = automationVault({
      today: TODAY,
      notes: {
        'Archive/Tasks/A.md': jsonNote({ archived: '2026-03-01', archivedFrom: 'Tasks/A.md' }),
        [logPathFor(ARCHIVE_RULE.id)]: logText([
          '- archived `"Tasks/A.md"` → `"Archive/Tasks/A.md"`',
        ]),
      },
    });
    const undo = undoOf(
      await undoLastRun({
        ports: vault.ports,
        rule: ARCHIVE_RULE,
        clock: CLOCK,
        activity: ACTIVITY,
        guard: GUARD,
      }),
    );
    expect(vault.files.has('Archive/Tasks/A.md')).toBe(true);
    expect(undo?.left.map((left) => left.path)).toEqual(['Archive/Tasks/A.md']);
  });
});

describe('undo of a key that was there and empty', () => {
  it('writes the key back empty, not away, and says so', async () => {
    const vault = automationVault({
      today: TODAY,
      notes: { 'Tasks/A.md': jsonNote({ type: 'task', flagged: null }) },
    });
    const run = {
      ports: vault.ports,
      rule: FLAG_RULE,
      clock: CLOCK,
      activity: ACTIVITY,
      guard: GUARD,
    };
    await runAutomation({ ...run, trigger: 'hand' });
    expect(vault.properties('Tasks/A.md')['flagged']).toBe(true);
    const undo = undoOf(await undoLastRun(run));
    expect(vault.properties('Tasks/A.md')).toEqual({ type: 'task', flagged: null });
    expect(undo?.done).toEqual([
      expect.objectContaining({ key: 'flagged', after: { value: null } }) as unknown,
    ]);
  });
});

describe('the cap counts only notes that will change', () => {
  it('reaches the one live done task past 500 already archived ones, with INCLUDE ARCHIVED', async () => {
    const notes: Record<string, string> = {};
    for (let n = 0; n <= MAX_ACTIONS_PER_RUN; n += 1) {
      const name = `T${String(n).padStart(4, '0')}`;
      notes[`Archive/Tasks/${name}.md`] = jsonNote({
        type: 'task',
        status: 'done',
        archived: '2026-01-01',
        archivedFrom: `Tasks/${name}.md`,
      });
    }
    notes['Tasks/Zed.md'] = jsonNote({ type: 'task', status: 'done' });
    const vault = automationVault({ today: TODAY, notes });
    const rule = { ...ARCHIVE_RULE, which: 'FROM task WHERE status = done INCLUDE ARCHIVED' };
    const entry = await runAutomation({
      ports: vault.ports,
      rule,
      clock: CLOCK,
      activity: ACTIVITY,
      guard: GUARD,
      trigger: 'hand',
    });
    expect(vault.files.has('Archive/Tasks/Zed.md')).toBe(true);
    expect(entry.kind === 'run' && entry.capped).toBe(false);
  }, 30_000);
});

describe('a log that cannot be written', () => {
  it('rejects with what the run did, so the caller can pause the rule and say why', async () => {
    const vault = automationVault({
      today: TODAY,
      notes: { 'Tasks/A.md': jsonNote({ type: 'task' }) },
    });
    const fs = vault.ports.fs;
    const refusing = {
      ...fs,
      createNote: async (args: Parameters<typeof fs.createNote>[0]) => {
        if (args.path.startsWith('.atlas/automations/log/')) throw new Error('The disk is full.');
        return fs.createNote(args);
      },
    };
    const outcome = await runAutomation({
      ports: { ...vault.ports, fs: refusing },
      rule: FLAG_RULE,
      clock: CLOCK,
      activity: ACTIVITY,
      guard: GUARD,
      trigger: 'schedule',
    }).catch((cause: unknown) => cause);
    expect(outcome).toBeInstanceOf(AutomationLogError);
    const error = outcome as AutomationLogError;
    expect(error.message).toMatch(/The disk is full/);
    expect(
      error.entry.kind === 'run' &&
        error.entry.done.map((action) => 'path' in action && action.path),
    ).toEqual(['Tasks/A.md']);
  });
});

describe('a rule’s query is checked as the query page checks it, before its dates are pinned', () => {
  it('logs @today compared with a select as a run that could not start', async () => {
    const vault = automationVault({
      today: TODAY,
      notes: { 'Tasks/A.md': jsonNote({ type: 'task', status: TODAY }) },
    });
    const rule = { ...FLAG_RULE, which: 'FROM task WHERE status = @today' };
    const entry = await runAutomation({
      ports: vault.ports,
      rule,
      clock: CLOCK,
      activity: ACTIVITY,
      guard: GUARD,
      trigger: 'hand',
    });
    expect(entry.kind).toBe('failed');
    expect(entry.kind === 'failed' && entry.problem).toMatch(/@today is a date/);
    expect(vault.properties('Tasks/A.md')['flagged']).toBeUndefined();
  });
});

describe('stable ids', () => {
  const ruleFile = (extra: Record<string, unknown> = {}) =>
    jsonNote({
      atlas: 'automation',
      name: 'Tidy',
      enabled: true,
      when: 'daily at 03:00',
      which: 'FROM task',
      do: 'archive',
      ...extra,
    });

  it('writes an id into a new rule, one no log is kept under yet', async () => {
    const vault = automationVault({
      today: TODAY,
      notes: { [logPathFor('Tidy')]: logText([]) },
    });
    const path = await createAutomation({
      fs: vault.ports.fs,
      markdown: vault.ports.markdown,
      clock: CLOCK,
      draft: { ...ARCHIVE_RULE, name: 'Tidy' },
      takenPaths: vault.ports.notePaths,
    });
    expect(vault.properties(path)['id']).toBe('Tidy 2');
    expect(vault.files.has(logPathFor('Tidy 2'))).toBe(true);
  });

  it('migrates a rule the feature wrote before ids: its id is the name its log is under, and a rename keeps it', async () => {
    const rulePath = '.atlas/automations/Tidy.md';
    const vault = automationVault({
      today: TODAY,
      notes: { [rulePath]: ruleFile(), [logPathFor('Tidy')]: logText([]) },
    });
    const { fs, markdown } = vault.ports;
    const listing = await loadAutomations({ fs, markdown, notePaths: vault.ports.notePaths });
    await adoptAutomations({ fs, markdown, clock: CLOCK, listing });
    expect(vault.properties(rulePath)['id']).toBe('Tidy');

    // Renamed by hand: the log is still its log.
    vault.files.set('.atlas/automations/Tidier.md', vault.files.get(rulePath)!);
    vault.files.delete(rulePath);
    const renamed = await loadAutomations({ fs, markdown, notePaths: vault.ports.notePaths });
    expect(renamed.automations[0]?.rule.path).toBe('.atlas/automations/Tidier.md');
    expect(renamed.automations[0]?.log.map((entry) => entry.kind)).toEqual(['run']);
  });

  it('lists the second of two rules with one id as broken, so they never share a log', async () => {
    const vault = automationVault({
      today: TODAY,
      notes: {
        '.atlas/automations/A.md': ruleFile({ id: 'same', name: 'A' }),
        '.atlas/automations/B.md': ruleFile({ id: 'same', name: 'B' }),
      },
    });
    const { fs, markdown } = vault.ports;
    const listing = await loadAutomations({ fs, markdown, notePaths: vault.ports.notePaths });
    expect(listing.automations.map((loaded) => loaded.rule.name)).toEqual(['A']);
    expect(listing.broken.map((broken) => broken.name)).toEqual(['B']);
  });
});

describe('a rule never run gets its first mark when first seen', () => {
  it('marks an enabled scheduled rule once, and leaves one off, or run by hand, unmarked', async () => {
    const rule = (name: string, extra: Record<string, unknown>) =>
      jsonNote({
        atlas: 'automation',
        id: name,
        name,
        enabled: true,
        when: 'daily at 03:00',
        which: 'FROM task',
        do: 'archive',
        ...extra,
      });
    const vault = automationVault({
      today: TODAY,
      notes: {
        '.atlas/automations/Daily.md': rule('Daily', {}),
        '.atlas/automations/Off.md': rule('Off', { enabled: false }),
        '.atlas/automations/Hand.md': rule('Hand', { when: 'manually' }),
      },
    });
    const { fs, markdown } = vault.ports;
    const read = () => loadAutomations({ fs, markdown, notePaths: vault.ports.notePaths });
    await adoptAutomations({ fs, markdown, clock: CLOCK, listing: await read() });
    await adoptAutomations({ fs, markdown, clock: CLOCK, listing: await read() });
    expect(parseRunLog(vault.files.get(logPathFor('Daily')) ?? '')).toEqual([
      { kind: 'seen', at: `${TODAY}T03:00:00` },
    ]);
    expect(vault.files.has(logPathFor('Off'))).toBe(false);
    expect(vault.files.has(logPathFor('Hand'))).toBe(false);
  });
});
