/**
 * What running, dry-running and undoing an automation say in the Activity log
 * (U-28): one line each, linked to the rule, never a note's contents or a
 * machine path.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath, type AutomationRule } from '@atlas/domain';
import { automationVault, jsonNote } from '../testing/automation-vault.ts';
import { createActivityLog } from '../activity/activity-log.ts';
import { memoryActivityStore, recordingActivity } from '../testing/fake-activity.ts';
import { dryRunAutomation } from './dry-run-automation.ts';
import { runAutomation } from './run-automation.ts';
import { undoLastRun } from './undo-last-run.ts';
import type { VaultGuard } from './vault-guard.ts';

const TODAY = '2026-09-27';
const CLOCK = { today: () => TODAY, localNow: () => `${TODAY}T03:00:00` };
const VAULT = '/Users/james/My Vault';
const GUARD: VaultGuard = { vault: VAULT, currentVault: () => VAULT };
const SECRET_TEXT = 'the body nobody should see in a log';

const RULE: AutomationRule = {
  id: 'Tidy',
  path: createVaultPath('.atlas/automations/Tidy.md'),
  name: 'Tidy tasks',
  enabled: true,
  when: { kind: 'daily', at: '03:00' },
  which: 'FROM task WHERE status = done',
  olderThanDays: 30,
  action: { kind: 'archive' },
};
const RULE_SUBJECT = { kind: 'rule', path: RULE.path };

function tidyVault(dirty: string[] = []) {
  return automationVault({
    today: TODAY,
    dirty,
    notes: {
      'Tasks/Old done.md': `${jsonNote({ type: 'task', status: 'done' })}${SECRET_TEXT}\n`,
      'Tasks/Also old.md': jsonNote({ type: 'task', status: 'done' }),
    },
    ageDays: { 'Tasks/Old done.md': 40, 'Tasks/Also old.md': 31 },
  });
}

function setUp(dirty: string[] = []) {
  const vault = tidyVault(dirty);
  const activity = recordingActivity();
  const run = { ports: vault.ports, rule: RULE, clock: CLOCK, guard: GUARD, activity };
  return { vault, activity, run };
}

describe('a run in the Activity log', () => {
  it('records its summary, linked to the rule', async () => {
    const { activity, run } = setUp();
    await runAutomation({ ...run, trigger: 'schedule' });
    expect(activity.reports).toEqual([
      {
        level: 'info',
        kind: 'automation',
        message: 'Tidy tasks: Ran on schedule. Archived 2 notes.',
        subject: RULE_SUBJECT,
      },
    ]);
  });

  it('warns when the run left a note alone', async () => {
    const { activity, run } = setUp(['Tasks/Old done.md']);
    await runAutomation({ ...run, trigger: 'hand' });
    expect(activity.reports).toHaveLength(1);
    expect(activity.reports[0]).toMatchObject({
      level: 'warning',
      message: 'Tidy tasks: Ran by hand. Archived 1 note. Left 1 alone.',
    });
  });

  it('records a run whose query does not read as an error', async () => {
    const { activity, run } = setUp();
    await runAutomation({ ...run, rule: { ...RULE, which: 'FROM nothing' }, trigger: 'hand' });
    expect(activity.reports).toHaveLength(1);
    expect(activity.reports[0]).toMatchObject({ level: 'error', kind: 'automation' });
    expect(activity.reports[0]?.message).toMatch(/^Tidy tasks: Ran by hand, and could not\./);
  });

  it('records a run whose log could not be written as an error, and still rejects', async () => {
    const { activity, run, vault } = setUp();
    const fs = vault.ports.fs;
    const refusing = {
      ...fs,
      createNote: async (args: Parameters<typeof fs.createNote>[0]) => {
        if (args.path.startsWith('.atlas/automations/log/')) {
          throw new Error(`cannot write ${VAULT}/.atlas/automations/log/Tidy.md: disk full`);
        }
        return fs.createNote(args);
      },
    };
    await expect(
      runAutomation({ ...run, ports: { ...vault.ports, fs: refusing }, trigger: 'hand' }),
    ).rejects.toMatchObject({ name: 'AutomationLogError' });
    expect(activity.reports).toHaveLength(1);
    expect(activity.reports[0]).toMatchObject({ level: 'error', subject: RULE_SUBJECT });
    expect(activity.reports[0]?.message).toMatch(/^Tidy tasks: Could not run\. .*disk full/);
    expect(activity.reports[0]?.message).not.toContain('/Users/james');
  });

  it('records nothing for a run cut off by another vault opening', async () => {
    const { activity, run } = setUp();
    const elsewhere = { vault: VAULT, currentVault: () => '/Users/james/Work' };
    await expect(
      runAutomation({ ...run, guard: elsewhere, trigger: 'hand' }),
    ).rejects.toMatchObject({ name: 'VaultChangedError' });
    expect(activity.reports).toEqual([]);
  });
});

describe('an undo in the Activity log', () => {
  it('records what the undo put back', async () => {
    const { activity, run } = setUp();
    await runAutomation({ ...run, trigger: 'hand' });
    await undoLastRun(run);
    expect(activity.reports.at(-1)).toEqual({
      level: 'info',
      kind: 'automation',
      message: 'Tidy tasks: Undid its last run. Put back 2 notes.',
      subject: RULE_SUBJECT,
    });
  });

  it('records nothing when there was no run to undo', async () => {
    const { activity, run } = setUp();
    expect(await undoLastRun(run)).toBeNull();
    expect(activity.reports).toEqual([]);
  });

  it('records an undo that failed', async () => {
    const { activity, run, vault } = setUp();
    await runAutomation({ ...run, trigger: 'hand' });
    const fs = vault.ports.fs;
    const unreadable = {
      ...fs,
      readNotes: (paths: readonly string[]) =>
        paths.some((path) => path.startsWith('.atlas/automations/log/'))
          ? Promise.reject(new Error('log unreadable'))
          : fs.readNotes(paths),
    };
    await expect(
      undoLastRun({ ...run, ports: { ...vault.ports, fs: unreadable } }),
    ).rejects.toThrow('log unreadable');
    expect(activity.reports.at(-1)).toMatchObject({
      level: 'error',
      message: 'Tidy tasks: Could not undo its last run. log unreadable',
    });
  });
});

describe('a dry run in the Activity log', () => {
  it('records what the rule would do, and writes nothing to the vault', async () => {
    const { activity, vault } = setUp();
    const plan = await dryRunAutomation({
      ports: vault.ports,
      rule: RULE,
      named: RULE,
      today: TODAY,
      activity,
    });
    expect(plan.paths).toHaveLength(2);
    expect(vault.log).toEqual([]);
    expect(activity.reports).toEqual([
      {
        level: 'info',
        kind: 'automation',
        message: 'Tidy tasks: Dry run. Would archive 2 notes.',
        subject: RULE_SUBJECT,
      },
    ]);
  });

  it('warns when the query does not read, and still rejects', async () => {
    const { activity, vault } = setUp();
    await expect(
      dryRunAutomation({
        ports: vault.ports,
        rule: { ...RULE, which: 'FROM nothing' },
        named: { name: 'Draft', path: null },
        today: TODAY,
        activity,
      }),
    ).rejects.toMatchObject({ name: 'AtlasQueryError' });
    expect(activity.reports).toHaveLength(1);
    expect(activity.reports[0]).toMatchObject({ level: 'warning', subject: null });
    expect(activity.reports[0]?.message).toMatch(/^Draft: Dry run could not read its notes\./);
  });
});

describe('what a line never holds', () => {
  it('holds no note contents and no machine path, whatever happened', async () => {
    const { activity, run } = setUp(['Tasks/Also old.md']);
    await runAutomation({ ...run, trigger: 'hand' });
    await undoLastRun(run);
    const said = JSON.stringify(activity.reports);
    expect(activity.reports.length).toBeGreaterThan(1);
    expect(said).not.toContain(SECRET_TEXT);
    expect(said).not.toContain('/Users/');
  });
});

describe('a dry run in its own vault’s log (A28-01)', () => {
  it('keeps its line in the vault it ran in, though another opened before it finished', async () => {
    const files = memoryActivityStore();
    let open: string | null = VAULT;
    const activity = createActivityLog({
      store: files,
      clock: { now: () => Date.UTC(2026, 8, 27, 3) },
      vault: () => open,
      schedule: () => undefined,
      onError: (cause) => {
        throw cause;
      },
    });
    const running = dryRunAutomation({
      ports: tidyVault().ports,
      rule: RULE,
      named: RULE,
      today: TODAY,
      activity,
    });
    // Another vault opens while the rule's query is still being read.
    open = '/Users/james/Other Vault';
    await running;
    await activity.flush();
    expect(files.files.get(VAULT) ?? '').toContain('Tidy tasks');
    expect(files.files.get('/Users/james/Other Vault') ?? '').toBe('');
  });
});
