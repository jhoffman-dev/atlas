/**
 * ADR-0035 part 4, #174: a rule's Claude step set off by the clock, by the
 * vault opening or by a note asks the gates of a fresh pull before it asks
 * Claude, and again after Claude's turn, right before it writes anything.
 * Shut, it is held for the next pull: nothing written, nothing said.
 */
import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  logPathFor,
  parseObjectType,
  type AutomationRule,
  type RunTrigger,
} from '@atlas/domain';
import type { ModelEvent } from '../chat/ports.ts';
import { automationVault, jsonNote, TASK_TYPES } from '../testing/automation-vault.ts';
import { recordingActivity } from '../testing/fake-activity.ts';
import { fakeClaudeStepPorts } from '../testing/fake-claude-step.ts';
import type { ScriptedRound } from '../testing/fake-model.ts';
import { MEETING_BODY, MEETING_HEADER } from '../testing/meeting-files.ts';
import { HeldForPullError } from './fresh-pull-hold.ts';
import { runAutomation } from './run-automation.ts';
import type { VaultGuard } from './vault-guard.ts';

const TODAY = '2026-10-08';
const CLOCK = {
  today: () => TODAY,
  localNow: () => `${TODAY}T09:00:00`,
  now: () => Date.parse(`${TODAY}T09:00:00Z`),
};
const VAULT = '/vaults/home';
const GUARD: VaultGuard = { vault: VAULT, currentVault: () => VAULT };
const MEETING = 'Inbox/Meetings/2026-10-06 Standup.md';
const PROMPT = '.atlas/prompts/meeting-actions.md';
const TYPES = [
  ...TASK_TYPES,
  parseObjectType({ name: 'meeting', label: 'Meeting', properties: { status: 'text' } }),
];

const ASK: AutomationRule = {
  id: 'Meeting actions',
  path: createVaultPath('.atlas/automations/Meeting actions.md'),
  name: 'Meeting actions',
  enabled: true,
  when: { kind: 'daily', at: '08:00' },
  which: 'FROM meeting',
  olderThanDays: null,
  action: {
    kind: 'claude',
    prompt: createVaultPath(PROMPT),
    tools: [],
    output: { kind: 'proposals', schema: 'proposals' },
  },
};

const says = (value: unknown): ModelEvent[] => [{ type: 'text', text: JSON.stringify(value) }];
const ONE = says({
  proposals: [
    {
      kind: 'task',
      title: 'Send Mara the file',
      source: '[[2026-10-06 Standup#^t0001]]',
      confidence: 'high',
      why: 'Mara asked for it.',
    },
  ],
});

/**
 * A vault holding one meeting the import let in, a scripted model, and the
 * gates: answering in turn from `answers` (the last repeats), and recording
 * what they were asked.
 */
function setUp({
  answers,
  rounds = [ONE],
}: {
  answers: readonly boolean[];
  rounds?: readonly ScriptedRound[];
}) {
  const claude = fakeClaudeStepPorts({ rounds, today: TODAY });
  const vault = automationVault({
    notes: {
      [PROMPT]: 'Find every action item and propose it as a task.\n',
      [MEETING]: jsonNote({ ...MEETING_HEADER, atlas_import_outcome: 'imported' }, MEETING_BODY),
    },
    today: TODAY,
    types: TYPES,
    claude,
  });
  const activity = recordingActivity();
  const asked: (readonly string[])[] = [];
  let turn = 0;
  const freshPull = async (paths: readonly string[]) => {
    asked.push(paths);
    const answer = answers[Math.min(turn, answers.length - 1)]!;
    turn += 1;
    return answer;
  };
  const before = new Map(vault.files);
  const run = (rule: AutomationRule = ASK, trigger: RunTrigger = 'schedule') =>
    runAutomation({
      ports: vault.ports,
      rule,
      clock: CLOCK,
      guard: GUARD,
      activity,
      trigger,
      freshPull,
    });
  return { vault, activity, asked, run, claude, before };
}

describe('a Claude step and the gates of a fresh pull (ADR-0035 part 4)', () => {
  it('asks nothing of Claude, and writes nothing, while the gates are shut', async () => {
    const { run, claude, vault, before, activity } = setUp({ answers: [false] });

    await expect(run()).rejects.toBeInstanceOf(HeldForPullError);

    expect(claude.fake.requests).toHaveLength(0);
    expect(vault.files).toEqual(before);
    expect(activity.reports).toEqual([]);
  });

  it('writes nothing Claude said when the gates shut during its turn: not a proposal, not its log', async () => {
    const { run, claude, vault, before, activity, asked } = setUp({ answers: [true, false] });

    await expect(run()).rejects.toBeInstanceOf(HeldForPullError);

    expect(claude.fake.requests).toHaveLength(1);
    expect(asked).toHaveLength(2);
    expect(vault.files).toEqual(before);
    expect(activity.reports).toEqual([]);
  });

  it('asks the gates of the notes it reads, before Claude and before writing, and writes once they are open', async () => {
    const { run, vault, asked } = setUp({ answers: [true] });

    const entry = await run();

    expect(entry.kind).toBe('run');
    expect(asked).toEqual([[MEETING], [MEETING]]);
    expect(vault.files.has('Inbox/Proposals/Send Mara the file.md')).toBe(true);
    expect(vault.files.has(logPathFor(ASK.id))).toBe(true);
  });

  it('logs what it made, whatever the gates say once it has made it', async () => {
    const { run, vault } = setUp({ answers: [true, true, false] });

    await run();

    expect(vault.files.has('Inbox/Proposals/Send Mara the file.md')).toBe(true);
    expect(vault.files.has(logPathFor(ASK.id))).toBe(true);
  });

  it('logs no failure while the gates are shut, when the failure made nothing', async () => {
    const { run, vault, before, claude } = setUp({
      answers: [true, false],
      rounds: [[{ type: 'text', text: 'Not JSON at all.' }]],
    });

    await expect(run()).rejects.toBeInstanceOf(HeldForPullError);

    expect(claude.fake.requests).toHaveLength(1);
    expect(vault.files).toEqual(before);
  });

  it('logs a failure that made nothing once the gates are open', async () => {
    const { run, vault } = setUp({
      answers: [true],
      rounds: [[{ type: 'text', text: 'Not JSON at all.' }]],
    });

    const entry = await run();

    expect(entry.kind).toBe('failed');
    expect(vault.files.has(logPathFor(ASK.id))).toBe(true);
  });

  it('is gated on opening the vault as on its schedule', async () => {
    const { run, claude } = setUp({ answers: [false] });
    await expect(run({ ...ASK, when: { kind: 'open' } }, 'open')).rejects.toBeInstanceOf(
      HeldForPullError,
    );
    expect(claude.fake.requests).toHaveLength(0);
  });

  it('is not gated when the person runs it by hand', async () => {
    const { run, asked, vault } = setUp({ answers: [false] });

    const entry = await run(ASK, 'hand');

    expect(entry.kind).toBe('run');
    expect(asked).toEqual([]);
    expect(vault.files.has('Inbox/Proposals/Send Mara the file.md')).toBe(true);
  });

  it('never gates a rule with no Claude step', async () => {
    const { run, asked } = setUp({ answers: [false] });

    await run({ ...ASK, action: { kind: 'set', values: { status: 'seen' } } });

    expect(asked).toEqual([]);
  });
});
