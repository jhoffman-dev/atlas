/**
 * The Friday review draft (#40): the ready-made rule run as the app runs it —
 * a vault in memory with a real-SQL index, a scripted model, and a fixed
 * clock. It writes one note a week in `Reviews/` from the weekly review it is
 * handed, however often it runs, and keeps only the items that cite a note.
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
const NEXT_FRIDAY = '2026-10-30';
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
const QUOTE = 'Tasks/Chase the quote.md';
const NOTES = {
  [PROMPT]: 'Draft the weekly review.\n',
  [SHIPPED]: jsonNote({ type: 'task', status: 'archive' }),
  [QUOTE]: jsonNote({ type: 'task', status: 'waiting', waiting_on: 'Mara Quill' }),
  'Tasks/Old win.md': jsonNote({ type: 'task', status: 'archive' }),
};
const AGES = { [SHIPPED]: 2, [QUOTE]: 12, 'Tasks/Old win.md': 20 };

const says = (value: unknown): ModelEvent[] => [{ type: 'text', text: JSON.stringify(value) }];
const draft = (body: string, title = 'Weekly review 2026-10-23'): ModelEvent[] =>
  says({ note: { title, body } });
const CITED = [
  '## Wins',
  '',
  `- Sent the file: [[${SHIPPED}]]`,
  '',
  '## Waiting for',
  '',
  `- Mara has not sent the quote: [[${QUOTE}]]`,
  '',
  'The Inbox is empty.',
  '',
].join('\n');

function setUp(rounds: readonly ScriptedRound[]) {
  let today = FRIDAY;
  let time = '15:00:00';
  const clock = {
    today: () => today,
    localNow: () => `${today}T${time}`,
    now: () => Date.parse(`${today}T${time}Z`),
  };
  const claude = fakeClaudeStepPorts({ rounds, model: 'claude-test', today: FRIDAY });
  const vault = automationVault({ notes: NOTES, today: FRIDAY, ageDays: AGES, claude });
  const ports: AutomationPorts = {
    ...vault.ports,
    claude: { ...claude, clock: { today: clock.today, now: clock.now } },
  };
  const activity = recordingActivity();
  const run = (at: { day?: string; time: string }, trigger: 'schedule' | 'hand' = 'schedule') => {
    today = at.day ?? today;
    time = at.time;
    return runAutomation({ ports, rule: RULE, clock, guard: GUARD, activity, trigger });
  };
  const reviews = () => [...vault.files.keys()].filter((path) => path.startsWith('Reviews/'));
  const logOf = (): LogEntry[] => parseRunLog(vault.files.get(logPathFor(RULE.id)) ?? '');
  return { claude, vault, run, reviews, logOf, asked: () => claude.fake.requests.length };
}

describe('the Friday review preset', () => {
  it('writes one draft in Reviews/ from the weekly review, citing its tasks', async () => {
    const { run, reviews, vault, claude, logOf } = setUp([draft(CITED)]);
    const entry = await run({ time: '15:00:00' });

    expect(reviews()).toEqual(['Reviews/Weekly review 2026-10-23.md']);
    expect(vault.files.get('Reviews/Weekly review 2026-10-23.md')).toBe(CITED);
    expect(entry).toMatchObject({ kind: 'run', period: { slot: '2026-10-23T15:00:00' } });
    expect(logOf().at(-1)).toMatchObject({ period: { slot: '2026-10-23T15:00:00' } });
    // Handed the review as data: the week's win and the stale waiting-for, by path, and the Inbox.
    const { system } = claude.fake.requests[0]!;
    expect(system).toContain(`- [[${SHIPPED}]] Send the file`);
    expect(system).toContain(`- [[${QUOTE}]] Chase the quote — waiting on Mara Quill`);
    expect(system).toContain('<vault_data about="The Inbox">');
    expect(system).not.toContain('Old win');
    expect(system).toContain('Every list item must link the task, project or meeting');
  });

  it('makes nothing more that week, on time, caught up or by hand, and asks Claude nothing', async () => {
    const { run, reviews, asked, logOf } = setUp([draft(CITED)]);
    await run({ time: '15:00:00' });
    const again = await run({ time: '16:30:00' });
    await run({ day: '2026-10-24', time: '09:00:00' }, 'hand');
    // Sunday is still the week of the Friday before; a run by hand then has nothing to make.
    await run({ day: '2026-10-25', time: '23:59:59' }, 'hand');

    expect(reviews()).toEqual(['Reviews/Weekly review 2026-10-23.md']);
    expect(asked()).toBe(1);
    expect(again).toMatchObject({ kind: 'run', done: [], period: { slot: '2026-10-23T15:00:00' } });
    expect(again).not.toHaveProperty('claude');
    const found = logOf().filter((entry) => entry.kind === 'run' && entry.done.length === 0);
    expect(found).toHaveLength(3);
  });

  it('writes the next week’s draft on the next Friday', async () => {
    const { run, reviews, asked } = setUp([draft(CITED), draft(CITED, 'Weekly review 2026-10-30')]);
    await run({ time: '15:00:00' });
    await run({ day: NEXT_FRIDAY, time: '15:00:00' });

    expect(reviews()).toEqual([
      'Reviews/Weekly review 2026-10-23.md',
      'Reviews/Weekly review 2026-10-30.md',
    ]);
    expect(asked()).toBe(2);
  });

  it('writes again in a period whose run failed, since it made nothing', async () => {
    const { run, reviews, asked } = setUp([says('not json'), draft(CITED)]);
    expect(await run({ time: '15:00:00' })).toMatchObject({ kind: 'failed' });
    await run({ time: '15:10:00' }, 'hand');

    expect(reviews()).toEqual(['Reviews/Weekly review 2026-10-23.md']);
    expect(asked()).toBe(2);
  });

  it('leaves out an item that cites nothing it was given, and says so in the log', async () => {
    const body = `${CITED}- Closed the quarter\n- Met [[Meetings/Elsewhere.md]]\n`;
    const { run, vault, logOf } = setUp([draft(body)]);
    const entry = await run({ time: '15:00:00' });

    expect(vault.files.get('Reviews/Weekly review 2026-10-23.md')).toBe(CITED);
    expect(entry.kind === 'run' && entry.claude?.dropped).toEqual([
      { title: 'Closed the quarter', reason: expect.stringContaining('links no task') },
      { title: 'Met [[Meetings/Elsewhere.md]]', reason: expect.stringContaining('links no task') },
    ]);
    expect(logOf().at(-1)).toMatchObject({
      claude: {
        dropped: [{ title: 'Closed the quarter' }, { title: 'Met [[Meetings/Elsewhere.md]]' }],
      },
    });
  });

  it('refuses a draft none of whose items cites a note, writing nothing', async () => {
    const { run, reviews, logOf } = setUp([draft('## Wins\n\n- A great week\n- Lots done\n')]);
    const entry = await run({ time: '15:00:00' });

    expect(reviews()).toEqual([]);
    expect(entry).toMatchObject({
      kind: 'failed',
      problem: expect.stringContaining('None of its 2 items links a task, project or meeting'),
    });
    // Nothing was made for the week: a run by hand may still write it.
    expect(logOf().at(-1)).not.toHaveProperty('period');
  });
});

describe('a daily note-writing step (#40: running twice creates nothing)', () => {
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

  it('writes no "Morning brief 2" on its second run of the day, and asks afresh the next', async () => {
    const brief = says({ note: { title: 'Morning brief', body: 'Chase Mara.\n' } });
    const claude = fakeClaudeStepPorts({ rounds: [brief, brief], today: FRIDAY });
    const vault = automationVault({ notes: NOTES, today: FRIDAY, ageDays: AGES, claude });
    let at = `${FRIDAY}T07:00:00`;
    const clock = {
      today: () => at.slice(0, 10),
      localNow: () => at,
      now: () => Date.parse(`${at}Z`),
    };
    const run = () =>
      runAutomation({
        ports: vault.ports,
        rule: BRIEF,
        clock,
        guard: GUARD,
        activity: recordingActivity(),
        trigger: 'schedule',
      });
    await run();
    at = `${FRIDAY}T12:00:00`;
    await run();
    const briefs = () => [...vault.files.keys()].filter((path) => path.startsWith('Briefs/'));
    expect(briefs()).toEqual(['Briefs/Morning brief.md']);
    expect(claude.fake.requests).toHaveLength(1);

    // The next morning nothing it matches has changed since the brief: it asks no one (#539 review).
    at = '2026-10-24T07:00:00';
    await run();
    expect(claude.fake.requests).toHaveLength(1);

    // Once the waiting task changes, the next morning asks afresh.
    vault.files.set(QUOTE, jsonNote({ type: 'task', status: 'waiting', waiting_on: 'Tobias' }));
    at = '2026-10-25T07:00:00';
    await run();
    expect(claude.fake.requests).toHaveLength(2);
    expect(claude.fake.requests[1]!.system).toContain(QUOTE);
    // A new day's note under a name taken is numbered past it: that is a second period, not a repeat.
    expect(briefs().sort()).toEqual(['Briefs/Morning brief 2.md', 'Briefs/Morning brief.md']);
  });
});
