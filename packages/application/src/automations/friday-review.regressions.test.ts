/**
 * Attack tests for PR #539 (#40): the Friday review preset run as the app
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
    notesIn,
    asked: () => claude.fake.requests.length,
    refuseLogOnce: () => {
      failLogWrites = 1;
    },
    logOf: (): LogEntry[] => parseRunLog(vault.files.get(LOG) ?? ''),
  };
}

describe('the Friday review, one note a week (attack #539)', () => {
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
    await run({ day: '2026-11-20', time: '15:00:00' });
    expect(asked()).toBe(3);
    expect(notesIn('Reviews')).toHaveLength(3);
  });

  it('writes one draft when a run on time and a run by hand start together', async () => {
    const { run, notesIn } = setUp([draft(), draft()]);
    await Promise.allSettled([run({ time: '15:00:00' }), run({ time: '15:00:00' }, 'hand')]);
    expect(notesIn('Reviews')).toHaveLength(1);
  });
});

describe('a daily brief run by hand all day (attack #539)', () => {
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
