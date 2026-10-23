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
import { dryRunAutomation } from './dry-run-automation.ts';
import { runAutomation, type AutomationPorts } from './run-automation.ts';
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
      if (args.path === logPathFor(rule.id) && failLogWrites > 0) {
        failLogWrites -= 1;
        throw new Error('the disk is full');
      }
      return fs.createNote(args);
    },
    writeTextFile: async (args) => {
      if (args.path === logPathFor(rule.id) && failLogWrites > 0) {
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
    notesIn,
    asked: () => claude.fake.requests.length,
    refuseLogOnce: () => {
      failLogWrites = 1;
    },
    logOf: (): LogEntry[] => parseRunLog(vault.files.get(logPathFor(rule.id)) ?? ''),
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

describe('a draft deleted or asked for by hand (review of #539, D4)', () => {
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

  it('does not write a draft again on a scheduled run in the week it was made, whoever took it away', async () => {
    const { run, vault, notesIn, asked } = setUp([draft(), draft()]);
    await run({ time: '15:00:00' });
    await vault.ports.fs.trashEntry({ path: createVaultPath(notesIn('Reviews')[0]!) });
    await run({ time: '15:30:00' });
    await run({ day: '2026-10-25', time: '15:30:00' });
    expect(asked()).toBe(1);
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
      jsonNote({ atlas_period: '2026-10-23T15:00:00', atlas_period_rule: 'Friday review' }),
    );
    await run({ time: '15:00:00' });
    expect(asked()).toBe(0);
    expect(notesIn('Reviews')).toHaveLength(1);
  });

  it('does not let a note stamped for a week ahead use up this week', async () => {
    const { run, vault, asked } = setUp([draft()]);
    vault.files.set(
      'Reviews/Ahead.md',
      jsonNote({ atlas_period: '2026-11-20T15:00:00', atlas_period_rule: 'Friday review' }),
    );
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

const CHASED = 'Tasks/Chase the quote.md';

/** A daily Claude step a person pointed at the review's own folder. */
const DAILY_NOTES: AutomationRule = {
  id: 'Daily notes',
  path: createVaultPath('.atlas/automations/Daily notes.md'),
  name: 'Daily notes',
  enabled: true,
  when: { kind: 'daily', at: '07:00' },
  which: 'FROM task WHERE status = waiting',
  olderThanDays: null,
  action: {
    kind: 'claude',
    prompt: createVaultPath(PROMPT),
    tools: [],
    output: { kind: 'note', folder: 'Reviews' },
  },
};

const noteAnswer = (title: string, body: string): ModelEvent[] => says({ note: { title, body } });

function setUpRules({
  notes,
  rounds,
}: {
  notes: Record<string, string>;
  rounds: readonly ScriptedRound[];
}) {
  let at = `${FRIDAY}T15:00:00`;
  const clock = {
    today: () => at.slice(0, 10),
    localNow: () => at,
    now: () => Date.parse(`${at}Z`),
  };
  const claude = fakeClaudeStepPorts({ rounds, model: 'claude-test', today: FRIDAY });
  const vault = automationVault({ notes, today: FRIDAY, claude });
  const ports: AutomationPorts = {
    ...vault.ports,
    claude: { ...claude, clock: { today: clock.today, now: clock.now } },
  };
  const run = (rule: AutomationRule, when: string) => {
    at = when;
    return runAutomation({
      ports,
      rule,
      clock,
      guard: GUARD,
      activity: recordingActivity(),
      trigger: 'schedule',
    });
  };
  const inReviews = () => [...vault.files.keys()].filter((path) => path.startsWith('Reviews/'));
  return { run, inReviews, vault, asked: () => claude.fake.requests.length };
}

describe('an empty week (verification of #539)', () => {
  it('writes the frame and DFAI’s own line for a week with nothing to cite, not a refusal', async () => {
    // Nothing done, nothing waiting, nothing overdue: every section is "None.".
    const { run, inReviews, vault } = setUpRules({
      notes: { [PROMPT]: 'Draft the weekly review.\n' },
      rounds: [
        noteAnswer(
          'Weekly review 2026-10-23',
          '## Wins\n\n- Quiet week: nothing finished.\n\n0 notes wait in the Inbox.\n',
        ),
      ],
    });
    const entry = await run(RULE, `${FRIDAY}T15:00:00`);

    expect(entry.kind).toBe('run');
    expect(inReviews()).toEqual(['Reviews/Weekly review 2026-10-23.md']);
    const written = vault.files.get('Reviews/Weekly review 2026-10-23.md')!;
    expect(written).toContain('## Wins');
    expect(written).toContain('0 notes wait in the Inbox.');
    expect(written).toContain('Nothing to cite this week.');
    expect(written).not.toContain('Quiet week: nothing finished.');
    expect(entry).toMatchObject({
      claude: { dropped: [{ title: 'Quiet week: nothing finished.' }] },
    });
  });
});

describe('two rules that write into one folder (verification of #539)', () => {
  it('still writes the week’s review after a daily rule wrote its note into Reviews/', async () => {
    const { run, inReviews, asked } = setUpRules({
      notes: {
        [PROMPT]: 'Draft the weekly review.\n',
        [OVERDUE]: jsonNote({ type: 'task', status: 'next-action', due: '2026-10-01' }),
        [CHASED]: jsonNote({ type: 'task', status: 'waiting', waiting_on: 'Mara Quill' }),
      },
      rounds: [
        noteAnswer('Daily notes 2026-10-21', 'Chase Mara.\n'),
        noteAnswer(
          'Weekly review 2026-10-23',
          `## Open loops\n\n- Renew the lease: [[${OVERDUE}]]\n`,
        ),
      ],
    });
    await run(DAILY_NOTES, '2026-10-21T07:00:00');
    expect(inReviews()).toEqual(['Reviews/Daily notes 2026-10-21.md']);

    await run(RULE, `${FRIDAY}T15:00:00`);

    // The Wednesday note is the daily rule's, not this week's review.
    expect(asked()).toBe(2);
    expect(inReviews().sort()).toEqual([
      'Reviews/Daily notes 2026-10-21.md',
      'Reviews/Weekly review 2026-10-23.md',
    ]);
  });
});

/** A seeded generator (mulberry32), so a failing sequence is the same on every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe('one review a week over random runs (verification of #539, seeded)', () => {
  const FRIDAYS = ['2026-10-23', '2026-10-30', '2026-11-06'];
  const DRAFT = noteAnswer('Weekly review', `## Open loops\n\n- Renew the lease: [[${OVERDUE}]]\n`);
  const notes = {
    [PROMPT]: 'Draft the weekly review.\n',
    [OVERDUE]: jsonNote({ type: 'task', status: 'next-action', due: '2026-10-01' }),
  };

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'never holds two notes for one week (seed %i)',
    async (seed) => {
      const random = seeded(seed);
      const { run, inReviews } = setUpRules({
        notes,
        rounds: Array.from({ length: 40 }, () => DRAFT),
      });
      const minutes = (n: number) =>
        `${String(15 + Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}:00`;
      for (const friday of FRIDAYS) {
        // Scheduled runs at or after the week's slot, on the Friday: on time, late, repeated.
        for (let step = 0; step < 4; step += 1) {
          await run(RULE, `${friday}T${minutes(Math.floor(random() * 300))}`);
        }
        const made = inReviews();
        // Every week whose time has come has its note, and only one.
        expect(made).toHaveLength(FRIDAYS.indexOf(friday) + 1);
      }
    },
  );
});

describe('a week’s note that syncs in while Claude is asked (verification of #539, two Macs)', () => {
  it('writes nothing, and logs the week as made, when the other Mac’s note arrives mid-ask', async () => {
    let arrive = (): void => undefined;
    const answering: ScriptedRound = async function* () {
      arrive();
      yield* draft();
    };
    const { run, vault, asked, notesIn, logOf } = setUp([answering]);
    arrive = () =>
      vault.files.set(
        'Reviews/Weekly review from the laptop.md',
        jsonNote({ atlas_period: '2026-10-23T15:00:00', atlas_period_rule: 'Friday review' }),
      );

    const entry = await run({ time: '15:00:00' });

    expect(asked()).toBe(1);
    expect(notesIn('Reviews')).toEqual(['Reviews/Weekly review from the laptop.md']);
    expect(entry).toMatchObject({ kind: 'run', done: [], period: { slot: '2026-10-23T15:00:00' } });
    expect(logOf().at(-1)).toMatchObject({ kind: 'run', done: [] });
  });

  it('stamps the note it writes with the rule that made it', async () => {
    const { run, vault, notesIn } = setUp([draft()]);
    await run({ time: '15:00:00' });
    const [path] = notesIn('Reviews');
    expect(vault.files.get(path!)).toContain('atlas_period_rule');
    expect(vault.files.get(path!)).toContain('Friday review');
  });
});

describe('a dry run of a rule with its note made (review of #539)', () => {
  it('counts the period as made when a note is stamped with the rule’s id', async () => {
    const vault = automationVault({
      notes: {
        ...NOTES,
        'Reviews/Weekly review from the laptop.md': jsonNote({
          atlas_period: '2026-10-23T15:00:00',
          atlas_period_rule: 'Friday review',
        }),
      },
      today: FRIDAY,
    });
    const plan = await dryRunAutomation({
      ports: vault.ports,
      rule: RULE,
      log: [],
      named: RULE,
      today: FRIDAY,
      at: `${FRIDAY}T15:00:00`,
      activity: recordingActivity(),
    });
    expect(plan.periodNote).toEqual({ period: { slot: '2026-10-23T15:00:00' }, made: true });
  });

  it('does not count a note stamped with another rule’s id', async () => {
    const vault = automationVault({
      notes: {
        ...NOTES,
        'Reviews/Daily.md': jsonNote({
          atlas_period: '2026-10-23T15:00:00',
          atlas_period_rule: 'Daily notes',
        }),
      },
      today: FRIDAY,
    });
    const plan = await dryRunAutomation({
      ports: vault.ports,
      rule: RULE,
      log: [],
      named: RULE,
      today: FRIDAY,
      at: `${FRIDAY}T15:00:00`,
      activity: recordingActivity(),
    });
    expect(plan.periodNote).toMatchObject({ made: false });
  });
});
