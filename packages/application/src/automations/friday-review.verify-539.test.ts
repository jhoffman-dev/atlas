/**
 * Verification of PR #539 after its fix round (#40): the Friday review preset
 * run as the app runs it — an in-memory vault, a scripted model, a fixed
 * clock — in an empty week, and beside another rule that writes into the same
 * folder.
 */
import { describe, expect, it } from 'vitest';
import { AUTOMATION_PRESETS, createVaultPath, type AutomationRule } from '@dfai/domain';
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
const REVIEW: AutomationRule = {
  ...PRESET,
  id: 'Friday review',
  path: createVaultPath('.atlas/automations/Friday review.md'),
};
const PROMPT = '.atlas/prompts/friday-review.md';
const OVERDUE = 'Tasks/Renew the lease.md';
const WAITING = 'Tasks/Chase the quote.md';

/** A daily Claude step a person pointed at the review's own folder. */
const DAILY: AutomationRule = {
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

const says = (value: unknown): ModelEvent[] => [{ type: 'text', text: JSON.stringify(value) }];
const noteAnswer = (title: string, body: string): ModelEvent[] => says({ note: { title, body } });

function setUp({
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
  return { run, inReviews, asked: () => claude.fake.requests.length };
}

describe('an empty week (coordinator decision on #539)', () => {
  it('writes a short draft for a week with nothing to cite, not a refusal', async () => {
    // Nothing done, nothing waiting, nothing overdue: every section is "None.".
    const { run, inReviews } = setUp({
      notes: { [PROMPT]: 'Draft the weekly review.\n' },
      rounds: [
        noteAnswer(
          'Weekly review 2026-10-23',
          '## Wins\n\n- Quiet week: nothing finished.\n\n0 notes wait in the Inbox.\n',
        ),
      ],
    });
    const entry = await run(REVIEW, `${FRIDAY}T15:00:00`);

    expect(entry.kind).toBe('run');
    expect(inReviews()).toEqual(['Reviews/Weekly review 2026-10-23.md']);
  });
});

describe('two rules that write into one folder (#539, atlas_period)', () => {
  it('still writes the week’s review after a daily rule wrote its note into Reviews/', async () => {
    const { run, inReviews, asked } = setUp({
      notes: {
        [PROMPT]: 'Draft the weekly review.\n',
        [OVERDUE]: jsonNote({ type: 'task', status: 'next-action', due: '2026-10-01' }),
        [WAITING]: jsonNote({ type: 'task', status: 'waiting', waiting_on: 'Mara Quill' }),
      },
      rounds: [
        noteAnswer('Daily notes 2026-10-21', 'Chase Mara.\n'),
        noteAnswer(
          'Weekly review 2026-10-23',
          `## Open loops\n\n- Renew the lease: [[${OVERDUE}]]\n`,
        ),
      ],
    });
    await run(DAILY, '2026-10-21T07:00:00');
    expect(inReviews()).toEqual(['Reviews/Daily notes 2026-10-21.md']);

    await run(REVIEW, `${FRIDAY}T15:00:00`);

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

describe('one review a week over random runs (seeded property, #539)', () => {
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
      const { run, inReviews } = setUp({ notes, rounds: Array.from({ length: 40 }, () => DRAFT) });
      const minutes = (n: number) =>
        `${String(15 + Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}:00`;
      for (const friday of FRIDAYS) {
        // Scheduled runs at or after the week's slot, on the Friday: on time, late, repeated.
        for (let step = 0; step < 4; step += 1) {
          await run(REVIEW, `${friday}T${minutes(Math.floor(random() * 300))}`);
        }
        const made = inReviews();
        // Every week whose time has come has its note, and only one.
        expect(made).toHaveLength(FRIDAYS.indexOf(friday) + 1);
      }
    },
  );
});
