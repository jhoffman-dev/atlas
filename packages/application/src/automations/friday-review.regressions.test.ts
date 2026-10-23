/**
 * Regression tests from the review of PR #539 (#40): the Friday review preset run as the app
 * runs it — an in-memory vault, a scripted model, a fixed clock — through
 * crashes, fast clocks, interleaved runs and a long day of runs by hand.
 */
import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_PRESETS,
  createVaultPath,
  logPathFor,
  parseRunLog,
  type AutomationRule,
  type LogEntry,
} from '@dfai/domain';
import type { ModelEvent } from '../chat/ports.ts';
import { recordingActivity } from '../testing/fake-activity.ts';
import { automationVault, jsonNote } from '../testing/automation-vault.ts';
import { fakeClaudeStepPorts } from '../testing/fake-claude-step.ts';
import type { ScriptedRound } from '../testing/fake-model.ts';
import { runAutomation, type AutomationPorts } from './run-automation.ts';
import { undoLastRun } from './undo-last-run.ts';
import type { VaultGuard } from './vault-guard.ts';

const FRIDAY = '2026-10-23';
const VAULT = '/vaults/home';
const GUARD: VaultGuard = { vault: VAULT, currentVault: () => VAULT };
const PRESET = AUTOMATION_PRESETS.find((each) => each.name === 'Friday review')!;
const RULE: AutomationRule = {
  ...PRESET,
  id: 'Friday review',
  path: createVaultPath('.atlas/automations/Friday review.md'),
};
const PROMPT = '.atlas/prompts/friday-review.md';
const SHIPPED = 'Tasks/Send the file.md';
const OVERDUE = 'Tasks/Renew the lease.md';
const NOTES = {
  [PROMPT]: 'Draft the weekly review.\n',
  [SHIPPED]: jsonNote({ type: 'task', status: 'archive' }),
  // Overdue on every date these tests use, so a draft always has a note to cite.
  [OVERDUE]: jsonNote({ type: 'task', status: 'next-action', due: '2026-10-01' }),
};
const LOG = logPathFor(RULE.id);

const says = (value: unknown): ModelEvent[] => [{ type: 'text', text: JSON.stringify(value) }];
const draft = (title = 'Weekly review'): ModelEvent[] =>
  says({ note: { title, body: `## Open loops\n\n- Renew the lease: [[${OVERDUE}]]\n` } });

function setUp(rounds: readonly ScriptedRound[], rule: AutomationRule = RULE) {
  let today = FRIDAY;
  let time = '15:00:00';
  const clock = {
    today: () => today,
    localNow: () => `${today}T${time}`,
    now: () => Date.parse(`${today}T${time}Z`),
  };
  const claude = fakeClaudeStepPorts({ rounds, model: 'claude-test', today: FRIDAY });
  const vault = automationVault({ notes: NOTES, today: FRIDAY, ageDays: { [SHIPPED]: 2 }, claude });
  let failLogWrites = 0;
  const fs = vault.ports.fs;
  // The disk refuses the log once: what a quit, a full disk or a crash after the note looks like.
  const refusingFs: AutomationPorts['fs'] = {
    ...fs,
    createNote: async (args) => {
      if (args.path === LOG && failLogWrites > 0) {
        failLogWrites -= 1;
        throw new Error('the disk is full');
      }
      return fs.createNote(args);
    },
    writeTextFile: async (args) => {
      if (args.path === LOG && failLogWrites > 0) {
        failLogWrites -= 1;
        throw new Error('the disk is full');
      }
      return fs.writeTextFile(args);
    },
  };
  const ports: AutomationPorts = {
    ...vault.ports,
    fs: refusingFs,
    claude: { ...claude, clock: { today: clock.today, now: clock.now } },
  };
  const run = (at: { day?: string; time: string }, trigger: 'schedule' | 'hand' = 'schedule') => {
    today = at.day ?? today;
    time = at.time;
    return runAutomation({
      ports,
      rule,
      clock,
      guard: GUARD,
      activity: recordingActivity(),
      trigger,
    });
  };
  const notesIn = (folder: string) =>
    [...vault.files.keys()].filter((path) => path.startsWith(`${folder}/`)).sort();
  return {
    run,
    vault,
    undo: () =>
      undoLastRun({ ports, rule, clock: { ...clock }, guard: GUARD, activity: recordingActivity() }),
    notesIn,
    asked: () => claude.fake.requests.length,
    refuseLogOnce: () => {
      failLogWrites = 1;
    },
    logOf: (): LogEntry[] => parseRunLog(vault.files.get(LOG) ?? ''),
  };
}

describe('the Friday review, one note a week', () => {
  it('writes no second draft for the week after the log write that followed the note failed', async () => {
    const { run, notesIn, refuseLogOnce } = setUp([draft(), draft()]);
    refuseLogOnce();
    await run({ time: '15:00:00' }).catch(() => undefined);
    expect(notesIn('Reviews')).toHaveLength(1);
    await run({ time: '15:01:00' }, 'hand');
    expect(notesIn('Reviews')).toHaveLength(1);
  });

  it('writes the real Friday’s draft after a clock a month fast wrote one ahead of it', async () => {
    const { run, notesIn, asked } = setUp([draft(), draft(), draft()]);
    // The Mac's clock runs a month fast for one run, then is put right.
    await run({ day: '2026-11-20', time: '15:00:00' });
    await run({ day: '2026-10-30', time: '15:00:00' });
    // Back on the real Friday, later in the day: the week it wrote for is made.
    await run({ day: '2026-10-30', time: '16:00:00' });
    expect(asked()).toBe(2);
    expect(notesIn('Reviews')).toHaveLength(2);
  });

  it('writes one draft when a run on time and a run by hand start together', async () => {
    const { run, notesIn } = setUp([draft(), draft()]);
    await Promise.allSettled([run({ time: '15:00:00' }), run({ time: '15:00:00' }, 'hand')]);
    expect(notesIn('Reviews')).toHaveLength(1);
  });
});

describe('a daily brief run by hand all day', () => {
  const BRIEF: AutomationRule = {
    id: 'Morning brief',
    path: createVaultPath('.atlas/automations/Morning brief.md'),
    name: 'Morning brief',
    enabled: true,
    when: { kind: 'daily', at: '07:00' },
    which: 'FROM task',
    olderThanDays: null,
    action: {
      kind: 'claude',
      prompt: createVaultPath(PROMPT),
      tools: [],
      output: { kind: 'note', folder: 'Briefs' },
    },
  };
  const brief = says({ note: { title: 'Morning brief', body: 'Chase Mara.\n' } });

  it('writes one brief a day however many times it is run by hand', async () => {
    const { run, notesIn } = setUp([brief, brief], BRIEF);
    await run({ time: '07:00:00' });
    for (let minute = 0; minute < 101; minute += 1) {
      const at = `${String(8 + Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`;
      await run({ time: at }, 'hand');
    }
    expect(notesIn('Briefs')).toEqual(['Briefs/Morning brief.md']);
  });
});

describe('a draft deleted, undone or asked for by hand (review of #539, D4)', () => {
  it('does not write a deleted draft again on a scheduled run, though its note is gone', async () => {
    const { run, vault, notesIn, asked } = setUp([draft(), draft()]);
    await run({ time: '15:00:00' });
    await vault.ports.fs.trashEntry({ path: createVaultPath(notesIn('Reviews')[0]!) });
    expect(notesIn('Reviews')).toHaveLength(0);
    await run({ time: '16:00:00' });
    expect(notesIn('Reviews')).toHaveLength(0);
    expect(asked()).toBe(1);
  });

  it('writes a fresh draft when it is run by hand and the week’s note is gone', async () => {
    const { run, vault, notesIn, asked } = setUp([draft(), draft()]);
    await run({ time: '15:00:00' });
    await vault.ports.fs.trashEntry({ path: createVaultPath(notesIn('Reviews')[0]!) });
    await run({ time: '16:00:00' }, 'hand');
    expect(notesIn('Reviews')).toHaveLength(1);
    expect(asked()).toBe(2);
  });

  it('writes a fresh draft by hand after the run that made it is undone, and a scheduled run does not', async () => {
    const { run, undo, notesIn, asked } = setUp([draft(), draft()]);
    await run({ time: '15:00:00' });
    expect(await undo()).not.toBeNull();
    expect(notesIn('Reviews')).toHaveLength(0);
    await run({ time: '15:30:00' });
    expect(asked()).toBe(1);
    await run({ time: '15:40:00' }, 'hand');
    expect(notesIn('Reviews')).toHaveLength(1);
    expect(asked()).toBe(2);
  });

  it('takes a run by hand on Wednesday for the week it is in, once, and Monday for the next', async () => {
    const { run, notesIn, asked, logOf } = setUp([draft(), draft()]);
    await run({ day: '2026-10-21', time: '10:00:00' }, 'hand');
    expect(logOf().at(-1)).toMatchObject({ period: { slot: '2026-10-23T15:00:00' } });
    await run({ day: '2026-10-22', time: '10:00:00' }, 'hand');
    // The Friday on time finds the week’s note made.
    await run({ day: '2026-10-23', time: '15:00:00' });
    expect(asked()).toBe(1);
    // Sunday is still that week; Monday is the next.
    await run({ day: '2026-10-25', time: '23:00:00' }, 'hand');
    expect(asked()).toBe(1);
    await run({ day: '2026-10-26', time: '09:00:00' }, 'hand');
    expect(asked()).toBe(2);
    expect(notesIn('Reviews')).toHaveLength(2);
  });
});

describe('the period is written into the note (review of #539, D5)', () => {
  it('stamps the note with the period it was made for', async () => {
    const { run, vault, notesIn } = setUp([draft()]);
    await run({ time: '15:00:00' });
    expect(vault.properties(notesIn('Reviews')[0]!)).toMatchObject({
      atlas_period: '2026-10-23T15:00:00',
    });
  });

  it('counts a note synced in from the other Mac as the week’s draft', async () => {
    const { run, vault, asked, notesIn } = setUp([draft()]);
    vault.files.set(
      'Reviews/Weekly review from the laptop.md',
      jsonNote({ atlas_period: '2026-10-23T15:00:00' }),
    );
    await run({ time: '15:00:00' });
    expect(asked()).toBe(0);
    expect(notesIn('Reviews')).toHaveLength(1);
  });

  it('does not let a note stamped for a week ahead use up this week', async () => {
    const { run, vault, asked } = setUp([draft()]);
    vault.files.set('Reviews/Ahead.md', jsonNote({ atlas_period: '2026-11-20T15:00:00' }));
    await run({ time: '15:00:00' });
    expect(asked()).toBe(1);
  });
});

describe('a daily rule on a fixed query (review of #539, D3)', () => {
  const BRIEF: AutomationRule = {
    id: 'Morning brief',
    path: createVaultPath('.atlas/automations/Morning brief.md'),
    name: 'Morning brief',
    enabled: true,
    when: { kind: 'daily', at: '07:00' },
    which: 'FROM task WHERE status = waiting',
    olderThanDays: null,
    action: {
      kind: 'claude',
      prompt: createVaultPath(PROMPT),
      tools: [],
      output: { kind: 'note', folder: 'Briefs' },
    },
  };
  const WAITING = 'Tasks/Chase the quote.md';
  const brief = says({ note: { title: 'Morning brief', body: 'Chase Mara.\n' } });
  const withWaiting = {
    ...NOTES,
    [WAITING]: jsonNote({ type: 'task', status: 'waiting', waiting_on: 'Mara Quill' }),
  };

  function briefSetUp() {
    const setup = setUp([brief, brief, brief], BRIEF);
    return setup;
  }

  it('asks nothing the next morning when none of the notes its query matches changed', async () => {
    const { run, vault, asked, notesIn, logOf } = briefSetUp();
    vault.files.set(WAITING, withWaiting[WAITING]);
    await run({ time: '07:00:00' });
    await run({ day: '2026-10-24', time: '07:00:00' });
    expect(asked()).toBe(1);
    expect(notesIn('Briefs')).toHaveLength(1);
    // The skipped morning is on the log as a run, so the schedule counts on from it.
    expect(logOf().at(-1)).toMatchObject({ kind: 'run', trigger: 'schedule', done: [] });
    await run({ day: '2026-10-24', time: '07:01:00' });
    expect(asked()).toBe(1);
  });

  it('asks again once a matched note changed, or a new one matches', async () => {
    const { run, vault, asked } = briefSetUp();
    vault.files.set(WAITING, withWaiting[WAITING]);
    await run({ time: '07:00:00' });
    vault.files.set(WAITING, jsonNote({ type: 'task', status: 'waiting', waiting_on: 'Tobias' }));
    await run({ day: '2026-10-24', time: '07:00:00' });
    expect(asked()).toBe(2);
    vault.files.set('Tasks/Another.md', jsonNote({ type: 'task', status: 'waiting' }));
    await run({ day: '2026-10-25', time: '07:00:00' });
    expect(asked()).toBe(3);
  });

  it('still writes the day’s brief by hand when nothing changed and the note is gone', async () => {
    const { run, vault, asked, notesIn } = briefSetUp();
    vault.files.set(WAITING, withWaiting[WAITING]);
    await run({ time: '07:00:00' });
    await vault.ports.fs.trashEntry({ path: createVaultPath(notesIn('Briefs')[0]!) });
    await run({ day: '2026-10-24', time: '09:00:00' }, 'hand');
    expect(asked()).toBe(2);
  });

  it('asks every period of a data-only step, whose data is what changes', async () => {
    const { run, asked } = setUp([draft(), draft()]);
    await run({ time: '15:00:00' });
    await run({ day: '2026-10-30', time: '15:00:00' });
    expect(asked()).toBe(2);
  });
});
