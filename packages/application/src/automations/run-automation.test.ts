/**
 * Running, dry-running and undoing an automation (P25-02), over a vault held
 * in memory whose index answers with real SQL. The clock is fixed; every
 * claim is about where notes are and what the files say afterwards.
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
import { planRun } from './plan-run.ts';
import { runAutomation } from './run-automation.ts';
import { undoLastRun } from './undo-last-run.ts';
import { VaultChangedError, type VaultGuard } from './vault-guard.ts';
import { recordingActivity } from '../testing/fake-activity.ts';

/** Where the runs say how they went; these tests read the rule's own log instead. */
const ACTIVITY = recordingActivity();

const TODAY = '2026-09-27';
const CLOCK = { today: () => TODAY, localNow: () => `${TODAY}T03:00:00` };
const VAULT = '/vaults/home';
const GUARD: VaultGuard = { vault: VAULT, currentVault: () => VAULT };

const RULE: AutomationRule = {
  id: 'Tidy',
  path: createVaultPath('.atlas/automations/Tidy.md'),
  name: 'Archive done tasks after 30 days',
  enabled: true,
  when: { kind: 'daily', at: '03:00' },
  which: 'FROM task WHERE status = done',
  olderThanDays: 30,
  action: { kind: 'archive' },
};

const task = (status: string, more: Record<string, unknown> = {}) =>
  jsonNote({ type: 'task', status, ...more });

function tidyVault(dirty: string[] = []) {
  return automationVault({
    today: TODAY,
    dirty,
    notes: {
      'Tasks/Old done.md': task('done'),
      'Tasks/Also old.md': task('done'),
      'Tasks/Fresh done.md': task('done'),
      'Tasks/Old doing.md': task('doing'),
      'Linker.md': 'See [[Tasks/Old done]].\n',
    },
    ageDays: { 'Tasks/Old done.md': 40, 'Tasks/Also old.md': 31, 'Tasks/Old doing.md': 90 },
  });
}

/** The undo entry, or null: narrowed so its lines can be read. */
const undoneBy = (entry: LogEntry | null) => (entry?.kind === 'undo' ? entry : null);

const logOf = (vault: ReturnType<typeof tidyVault>) =>
  parseRunLog(vault.files.get(logPathFor(RULE.id)) ?? '');

describe('planRun: the dry run', () => {
  it('lists the notes the rule would take today, and writes nothing', async () => {
    const vault = tidyVault();
    const plan = await planRun({ ports: vault.ports, rule: RULE, today: TODAY });
    expect([...plan.paths].sort()).toEqual(['Tasks/Also old.md', 'Tasks/Old done.md']);
    expect(vault.log).toEqual([]);
  });

  it('answers @today with the injected day, not the machine’s', async () => {
    const vault = automationVault({
      today: TODAY,
      notes: {
        'Due soon.md': task('doing', { due: '2031-05-01' }),
        'Due later.md': task('doing', { due: '2031-07-01' }),
      },
    });
    const rule = { ...RULE, which: 'FROM task WHERE due < @today', olderThanDays: null };
    const plan = await planRun({ ports: vault.ports, rule, today: '2031-06-01' });
    expect(plan.paths).toEqual(['Due soon.md']);
  });

  it('rejects a query that does not read, pointing at the problem', async () => {
    const vault = tidyVault();
    const rule = { ...RULE, which: 'FROM nothing' };
    await expect(planRun({ ports: vault.ports, rule, today: TODAY })).rejects.toMatchObject({
      name: 'AtlasQueryError',
    });
  });
});

describe('runAutomation', () => {
  it('archives what the plan names, rewrites links, and logs exactly what it did', async () => {
    const vault = tidyVault();
    const entry = await runAutomation({
      ports: vault.ports,
      rule: RULE,
      clock: CLOCK,
      activity: ACTIVITY,
      guard: GUARD,
      trigger: 'hand',
    });

    expect(vault.files.has('Archive/Tasks/Old done.md')).toBe(true);
    expect(vault.files.has('Archive/Tasks/Also old.md')).toBe(true);
    expect(vault.files.has('Tasks/Fresh done.md')).toBe(true);
    expect(vault.files.has('Tasks/Old doing.md')).toBe(true);
    expect(vault.files.get('Linker.md')).toContain('Archive/Tasks/Old done');
    expect(vault.properties('Archive/Tasks/Old done.md')['archived']).toBe(TODAY);

    expect(entry.kind).toBe('run');
    expect(logOf(vault)).toEqual([entry]);
    expect(
      entry.kind === 'run' &&
        [...entry.done].map((action) => action.kind === 'archived' && action.to).sort(),
    ).toEqual(['Archive/Tasks/Also old.md', 'Archive/Tasks/Old done.md']);
  });

  it('leaves a note with unsaved typing where it is, and logs that it did', async () => {
    const vault = tidyVault(['Tasks/Old done.md']);
    const entry = await runAutomation({
      ports: vault.ports,
      rule: RULE,
      clock: CLOCK,
      activity: ACTIVITY,
      guard: GUARD,
      trigger: 'schedule',
    });
    expect(vault.files.has('Tasks/Old done.md')).toBe(true);
    expect(vault.files.has('Archive/Tasks/Also old.md')).toBe(true);
    expect(entry.kind === 'run' && entry.left).toEqual([
      { path: 'Tasks/Old done.md', reason: expect.stringMatching(/unsaved typing/) },
    ]);
    expect(vault.files.get(logPathFor(RULE.id))).toContain(
      '- left `"Tasks/Old done.md"`: It is open in Atlas with unsaved typing',
    );
  });

  it('stops at the most one run may do, and says the rest wait', async () => {
    const notes: Record<string, string> = {};
    const ageDays: Record<string, number> = {};
    for (let n = 0; n < MAX_ACTIONS_PER_RUN + 7; n += 1) {
      notes[`T/${n}.md`] = task('done');
      ageDays[`T/${n}.md`] = 60;
    }
    const vault = automationVault({ today: TODAY, notes, ageDays });
    const entry = await runAutomation({
      ports: vault.ports,
      rule: RULE,
      clock: CLOCK,
      activity: ACTIVITY,
      guard: GUARD,
      trigger: 'hand',
    });
    expect(entry.kind === 'run' && entry.done.length).toBe(MAX_ACTIONS_PER_RUN);
    expect(entry.kind === 'run' && entry.capped).toBe(true);
    expect([...vault.files.keys()].filter((path) => path.startsWith('T/'))).toHaveLength(7);
    expect(vault.files.get(logPathFor(RULE.id))).toContain(
      `Stopped at ${MAX_ACTIONS_PER_RUN}, the most one run may do; the rest wait for the next run.`,
    );
    // It asserts what a capped run does to 507 notes, not how fast: a few
    // seconds alone, but past 30 s when the gate shares the machine.
  }, 120_000);

  it('logs a run whose query does not read as one that could not run', async () => {
    const vault = tidyVault();
    const rule = { ...RULE, which: 'FROM nothing' };
    const entry = await runAutomation({
      ports: vault.ports,
      rule,
      clock: CLOCK,
      activity: ACTIVITY,
      guard: GUARD,
      trigger: 'open',
    });
    expect(entry).toMatchObject({ kind: 'failed', trigger: 'open' });
    expect(logOf(vault)).toEqual([entry]);
    expect(vault.log).toEqual([`create ${logPathFor(RULE.id)}`]);
  });

  it("logs a note it could not move without this machine's paths", async () => {
    const vault = tidyVault();
    const moveEntry = vault.ports.fs.moveEntry;
    const ports = {
      ...vault.ports,
      fs: {
        ...vault.ports.fs,
        moveEntry: async (args: Parameters<typeof moveEntry>[0]) => {
          if (args.from === 'Tasks/Old done.md') {
            throw new Error('Permission denied (os error 13): /Users/j/Vault/Tasks/Old done.md');
          }
          return moveEntry(args);
        },
      },
    };
    const entry = await runAutomation({
      ports,
      rule: RULE,
      clock: CLOCK,
      activity: ACTIVITY,
      guard: GUARD,
      trigger: 'hand',
    });

    expect(entry.kind === 'run' && entry.left.map(({ path }) => path)).toEqual([
      'Tasks/Old done.md',
    ]);
    expect(JSON.stringify(entry)).not.toContain('/Users/j');
    expect(vault.files.get(logPathFor(RULE.id))).toContain('Permission denied');
    expect(vault.files.get(logPathFor(RULE.id))).not.toContain('/Users/j');
  });

  it('never runs on a vault other than its own', async () => {
    const vault = tidyVault();
    const elsewhere = { vault: VAULT, currentVault: () => '/vaults/work' };
    await expect(
      runAutomation({
        ports: vault.ports,
        rule: RULE,
        clock: CLOCK,
        activity: ACTIVITY,
        guard: elsewhere,
        trigger: 'hand',
      }),
    ).rejects.toBeInstanceOf(VaultChangedError);
    expect(vault.log).toEqual([]);
  });

  it('stops changing notes the moment another vault is opened mid-run, and logs the one it moved', async () => {
    const vault = tidyVault();
    let open = VAULT;
    const guard = { vault: VAULT, currentVault: () => open };
    // The switch lands as the first note moves.
    const moveEntry = vault.ports.fs.moveEntry;
    const ports = {
      ...vault.ports,
      fs: {
        ...vault.ports.fs,
        moveEntry: async (move: Parameters<typeof moveEntry>[0]) => {
          await moveEntry(move);
          open = '/vaults/work';
        },
      },
    };
    await expect(
      runAutomation({
        ports,
        rule: RULE,
        clock: CLOCK,
        activity: ACTIVITY,
        guard,
        trigger: 'hand',
      }),
    ).rejects.toBeInstanceOf(VaultChangedError);
    expect(vault.log.filter((line) => line.startsWith('move'))).toHaveLength(1);
    expect(vault.log.some((line) => line.startsWith('write'))).toBe(false);
    // The record of the move is not a change: it goes to the rule's own vault, which the host guards (A25-01).
    const [entry] = logOf(vault);
    expect(entry?.kind === 'run' && entry.done.map((action) => action.kind)).toEqual(['archived']);
  });
});

describe('undoLastRun', () => {
  it('puts back every note the last run archived, and logs the undo', async () => {
    const vault = tidyVault();
    const run = { ports: vault.ports, rule: RULE, clock: CLOCK, activity: ACTIVITY, guard: GUARD };
    await runAutomation({ ...run, trigger: 'hand' });
    const undo = await undoLastRun({
      ...run,
      clock: { ...CLOCK, localNow: () => `${TODAY}T09:00:00` },
    });

    expect(vault.files.has('Tasks/Old done.md')).toBe(true);
    expect(vault.files.has('Tasks/Also old.md')).toBe(true);
    expect([...vault.files.keys()].some((path) => path.startsWith('Archive/'))).toBe(false);
    expect(vault.properties('Tasks/Old done.md')).toEqual({ type: 'task', status: 'done' });
    expect(vault.files.get('Linker.md')).toBe('See [[Tasks/Old done]].\n');
    expect(undo).toMatchObject({ kind: 'undo', of: `${TODAY}T03:00:00` });
    expect(logOf(vault).map((entry) => entry.kind)).toEqual(['run', 'undo']);
  });

  it('has nothing to undo twice, or before any run', async () => {
    const vault = tidyVault();
    const run = { ports: vault.ports, rule: RULE, clock: CLOCK, activity: ACTIVITY, guard: GUARD };
    expect(await undoLastRun(run)).toBeNull();
    await runAutomation({ ...run, trigger: 'hand' });
    await undoLastRun(run);
    const writes = vault.log.length;
    expect(await undoLastRun(run)).toBeNull();
    expect(vault.log).toHaveLength(writes);
  });

  it('leaves a note that has moved since, and one being typed in, and says so', async () => {
    const vault = tidyVault();
    const run = { ports: vault.ports, rule: RULE, clock: CLOCK, activity: ACTIVITY, guard: GUARD };
    await runAutomation({ ...run, trigger: 'hand' });
    await vault.ports.fs.moveEntry({
      from: createVaultPath('Archive/Tasks/Also old.md'),
      to: createVaultPath('Archive/Kept.md'),
    });
    vault.unsaved.add('Archive/Tasks/Old done.md');
    const undo = undoneBy(await undoLastRun(run));
    expect(vault.files.has('Archive/Kept.md')).toBe(true);
    expect(vault.files.has('Archive/Tasks/Old done.md')).toBe(true);
    expect(undo?.done).toEqual([]);
    expect(undo?.left.map((left) => left.reason)).toEqual([
      expect.stringMatching(/no longer where the run put it/),
      expect.stringMatching(/unsaved typing/),
    ]);
  });

  it('refuses to undo in another vault', async () => {
    const vault = tidyVault();
    await runAutomation({
      ports: vault.ports,
      rule: RULE,
      clock: CLOCK,
      activity: ACTIVITY,
      guard: GUARD,
      trigger: 'hand',
    });
    const elsewhere = { vault: VAULT, currentVault: () => null };
    await expect(
      undoLastRun({
        ports: vault.ports,
        rule: RULE,
        clock: CLOCK,
        activity: ACTIVITY,
        guard: elsewhere,
      }),
    ).rejects.toBeInstanceOf(VaultChangedError);
    expect(vault.files.has('Archive/Tasks/Old done.md')).toBe(true);
  });
});

describe('a rule that sets properties', () => {
  const FLAG: AutomationRule = {
    ...RULE,
    which: 'FROM task WHERE status = doing',
    olderThanDays: null,
    action: { kind: 'set', values: { status: 'done', flagged: true } },
  };

  function flagVault(dirty: string[] = []) {
    return automationVault({
      today: TODAY,
      dirty,
      notes: {
        'A.md': task('doing'),
        'B.md': task('doing', { flagged: true }),
        'C.md': task('done'),
      },
    });
  }

  it('sets them, recording what each held before, and undo puts that back', async () => {
    const vault = flagVault();
    const run = { ports: vault.ports, rule: FLAG, clock: CLOCK, activity: ACTIVITY, guard: GUARD };
    const entry = await runAutomation({ ...run, trigger: 'hand' });
    expect(vault.properties('A.md')).toEqual({ type: 'task', status: 'done', flagged: true });
    // B already held flagged: true, so only its status is recorded as set.
    expect(entry.kind === 'run' && entry.done).toEqual([
      {
        kind: 'set',
        path: 'A.md',
        key: 'status',
        before: { value: 'doing' },
        after: { value: 'done' },
      },
      {
        kind: 'set',
        path: 'A.md',
        key: 'flagged',
        before: { absent: true },
        after: { value: true },
      },
      {
        kind: 'set',
        path: 'B.md',
        key: 'status',
        before: { value: 'doing' },
        after: { value: 'done' },
      },
    ]);
    expect(logOf(vault)).toEqual([entry]);

    await undoLastRun(run);
    expect(vault.properties('A.md')).toEqual({ type: 'task', status: 'doing' });
    expect(vault.properties('B.md')).toEqual({ type: 'task', status: 'doing', flagged: true });
  });

  it('never writes a note with unsaved typing', async () => {
    const vault = flagVault(['A.md']);
    const entry = await runAutomation({
      ports: vault.ports,
      rule: FLAG,
      clock: CLOCK,
      activity: ACTIVITY,
      guard: GUARD,
      trigger: 'hand',
    });
    expect(vault.properties('A.md')).toEqual({ type: 'task', status: 'doing' });
    expect(entry.kind === 'run' && entry.left).toEqual([
      { path: 'A.md', reason: expect.stringMatching(/unsaved typing/) },
    ]);
  });

  it('leaves a value changed since the run when undoing, and restores the rest', async () => {
    const vault = flagVault();
    const run = { ports: vault.ports, rule: FLAG, clock: CLOCK, activity: ACTIVITY, guard: GUARD };
    await runAutomation({ ...run, trigger: 'hand' });
    vault.files.set('A.md', task('blocked', { flagged: true }));
    const undo = undoneBy(await undoLastRun(run));
    expect(vault.properties('A.md')).toEqual({ type: 'task', status: 'blocked' });
    expect(vault.properties('B.md')['status']).toBe('doing');
    expect(undo?.left).toEqual([
      { path: 'A.md', reason: 'Its status has changed since, so it was left as it is.' },
    ]);
  });

  it('reports a note whose write is refused, and carries on with the rest', async () => {
    const vault = flagVault();
    const writeTextFile = vault.ports.fs.writeTextFile;
    const ports = {
      ...vault.ports,
      fs: {
        ...vault.ports.fs,
        writeTextFile: async (args: Parameters<typeof writeTextFile>[0]) => {
          if (args.path === 'A.md') throw new Error('the disk is full');
          return writeTextFile(args);
        },
      },
    };
    const entry = await runAutomation({
      ports,
      rule: FLAG,
      clock: CLOCK,
      activity: ACTIVITY,
      guard: GUARD,
      trigger: 'hand',
    });
    expect(entry.kind === 'run' && entry.left).toEqual([
      { path: 'A.md', reason: 'the disk is full' },
    ]);
    expect(
      entry.kind === 'run' && entry.done.map((action) => action.kind === 'set' && action.path),
    ).toEqual(['B.md']);
  });

  it("logs a refused write's reason without this machine's paths", async () => {
    const vault = flagVault();
    const writeTextFile = vault.ports.fs.writeTextFile;
    const ports = {
      ...vault.ports,
      fs: {
        ...vault.ports.fs,
        writeTextFile: async (args: Parameters<typeof writeTextFile>[0]) => {
          if (args.path === 'A.md') throw new Error('Read-only file system: /Users/j/Vault/A.md');
          return writeTextFile(args);
        },
      },
    };
    const entry = await runAutomation({
      ports,
      rule: FLAG,
      clock: CLOCK,
      activity: ACTIVITY,
      guard: GUARD,
      trigger: 'hand',
    });

    expect(entry.kind === 'run' && entry.left).toEqual([
      { path: 'A.md', reason: 'Read-only file system: <path>' },
    ]);
    expect(vault.files.get(logPathFor(RULE.id))).not.toContain('/Users/j');
  });
});
