/**
 * Adversarial pass over a rule's Claude step (P29-03, #16), run as the app
 * runs it: a vault held in memory, a scripted model answering as a note has
 * persuaded it to, and a disk that fails part-way. Each test names one
 * invariant and fails while it does not hold.
 */
import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  digestOf,
  logPathFor,
  MAX_LOG_BYTES,
  parseObjectType,
  parseRunLog,
  vaultPathName,
  type AutomationRule,
  type ClaudeAction,
  type LogEntry,
  type NoteChange,
} from '@atlas/domain';
import type { ModelEvent } from '../chat/ports.ts';
import { recordingActivity } from '../testing/fake-activity.ts';
import { fakeClaudeStepPorts } from '../testing/fake-claude-step.ts';
import { automationVault, jsonNote, TASK_TYPES } from '../testing/automation-vault.ts';
import type { ScriptedRound } from '../testing/fake-model.ts';
import { VaultAccessError } from '../vault/ports.ts';
import { runAutomation, runOnNoteChanges, type AutomationPorts } from './run-automation.ts';
import type { VaultGuard } from './vault-guard.ts';

const TODAY = '2026-10-11';
const CLOCK = { today: () => TODAY, localNow: () => `${TODAY}T09:00:00` };
const VAULT = '/vaults/home';
const GUARD: VaultGuard = { vault: VAULT, currentVault: () => VAULT };
const STANDUP = 'Meetings/2026-10-01 Standup.md';
const PROMPT = '.atlas/prompts/meeting-actions.md';
const PROPOSALS = 'Inbox/Proposals/';
const TYPES = [
  ...TASK_TYPES,
  parseObjectType({ name: 'meeting', label: 'Meeting', properties: { kind: 'text' } }),
];

const ASK: ClaudeAction = {
  kind: 'claude',
  prompt: createVaultPath(PROMPT),
  tools: ['atlas_read_note'],
  output: { kind: 'proposals', schema: 'proposals' },
};
const RULE: AutomationRule = {
  id: 'Meeting actions',
  path: createVaultPath('.atlas/automations/Meeting actions.md'),
  name: 'Meeting actions',
  enabled: true,
  when: { kind: 'manual' },
  which: 'FROM meeting',
  olderThanDays: null,
  action: ASK,
};
const ON_MEETING: AutomationRule = {
  ...RULE,
  when: { kind: 'note', type: 'meeting', on: ['created'] },
};

const NOTES = {
  [STANDUP]: jsonNote(
    { type: 'meeting', kind: 'standup' },
    '**Mara Quill** Can you send me the payroll file by Friday? ^t0003\n',
  ),
  [PROMPT]: 'Find every action item and propose it as a task.\n',
};
const STANDUP_ADDED: NoteChange = {
  kind: 'added',
  path: createVaultPath(STANDUP),
  type: 'meeting',
  digest: digestOf(NOTES[STANDUP]),
};

const proposal = (fields: Record<string, unknown> = {}) => ({
  kind: 'task',
  title: 'Send Mara the payroll file',
  source: '[[2026-10-01 Standup#^t0003]]',
  confidence: 'high',
  why: 'Mara asked for it on the call.',
  ...fields,
});
const says = (value: unknown): ModelEvent[] => [
  { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
];

function setUp({
  rounds,
  notes = NOTES,
  failCreate = () => false,
}: {
  rounds: readonly ScriptedRound[];
  notes?: Record<string, string>;
  /** Whether the disk refuses this create: the nth note made, counted from 1. */
  failCreate?: (nth: number) => boolean;
}) {
  const claude = fakeClaudeStepPorts({ rounds, model: 'claude-test' });
  const vault = automationVault({ notes, today: TODAY, types: TYPES, claude });
  const activity = recordingActivity();
  let creates = 0;
  const ports: AutomationPorts = {
    ...vault.ports,
    fs: {
      ...vault.ports.fs,
      createNote: async (create) => {
        creates += 1;
        if (failCreate(creates)) throw new VaultAccessError('the disk is full');
        return vault.ports.fs.createNote(create);
      },
    },
  };
  const run = (rule: AutomationRule, trigger: 'hand' | 'schedule' = 'hand') =>
    runAutomation({ ports, rule, clock: CLOCK, guard: GUARD, activity, trigger });
  const hear = (rule: AutomationRule, changes: readonly NoteChange[]) =>
    runOnNoteChanges({ ports, rule, clock: CLOCK, guard: GUARD, activity, changes });
  const logText = (rule: AutomationRule = RULE) => vault.files.get(logPathFor(rule.id)) ?? '';
  const logOf = (rule: AutomationRule = RULE): LogEntry[] => parseRunLog(logText(rule));
  const proposalsOnDisk = () => [...vault.files.keys()].filter((at) => at.startsWith(PROPOSALS));
  const asked = () => claude.fake.requests.length;
  return { vault, run, hear, logText, logOf, proposalsOnDisk, asked };
}

describe('a Claude step whose disk fails part-way through its proposals', () => {
  const THREE = says({
    proposals: [
      proposal(),
      proposal({ title: 'Pay on Friday' }),
      proposal({ title: 'Call Tobias' }),
    ],
  });

  it('leaves no proposal in the Inbox that its log does not name', async () => {
    const { run, logOf, proposalsOnDisk } = setUp({
      rounds: [THREE],
      failCreate: (nth) => nth === 2,
    });

    await run(RULE).catch(() => undefined);

    const logged = logOf().flatMap((entry) =>
      'done' in entry
        ? entry.done.flatMap((made) => (made.kind === 'proposed' ? [made.path] : []))
        : [],
    );
    expect(logged).toEqual(proposalsOnDisk());
  });

  it('does not propose the same thing twice when the note is heard again', async () => {
    const { hear, proposalsOnDisk } = setUp({
      rounds: [THREE, THREE],
      failCreate: (nth) => nth === 2,
    });

    await hear(ON_MEETING, [STANDUP_ADDED]).catch(() => undefined);
    // The next sync hears the same version again: nothing recorded it as handled.
    await hear(ON_MEETING, [STANDUP_ADDED]);

    const sends = proposalsOnDisk().filter((at) => at.includes('Send Mara the payroll file'));
    expect(sends).toHaveLength(1);
  });
});

describe('a Claude step on a schedule', () => {
  it('does not ask again about a note version it was already answered on', async () => {
    const once = says({ proposals: [proposal()] });
    const { run, asked, proposalsOnDisk } = setUp({ rounds: [once, once] });

    await run(RULE, 'schedule');
    await run(RULE, 'schedule');

    expect({ asked: asked(), proposals: proposalsOnDisk().length }).toEqual({
      asked: 1,
      proposals: 1,
    });
  });
});

describe('what a hostile answer can make a Claude step write', () => {
  it('names a proposal’s file within what a disk takes, however long the title', async () => {
    const { run, proposalsOnDisk } = setUp({
      rounds: [says({ proposals: [proposal({ title: 'Payroll '.repeat(60) })] })],
    });

    const entry = await run(RULE);

    // Refusing the answer is as good as cutting the name: what must not happen is a name the disk refuses.
    const names = proposalsOnDisk().map((at) => vaultPathName(createVaultPath(at)));
    const bytes = names.map((name) => new TextEncoder().encode(name).length);
    expect(entry?.kind === 'failed' || bytes.every((size) => size <= 255)).toBe(true);
  });

  it('keeps its rule’s log within the size a log may be, whatever the model called', async () => {
    const hostileTool = `atlas_${'x'.repeat(MAX_LOG_BYTES * 2)}`;
    const { run, logText } = setUp({
      rounds: [[{ type: 'tool_call', call: { id: 'c1', name: hostileTool, input: {} } }]],
    });

    const entry = await run(RULE);

    expect(entry).toMatchObject({ kind: 'failed' });
    expect(logText().length).toBeLessThanOrEqual(MAX_LOG_BYTES);
  });
});

describe('a Claude step handed an action its rule’s file could not have said', () => {
  it('writes no note into .atlas, though the action names it as its folder', async () => {
    const rule: AutomationRule = {
      ...RULE,
      action: { ...ASK, output: { kind: 'note', folder: '.atlas/automations' } },
    };
    const planted = `---\n${JSON.stringify({ atlas: 'automation', do: 'archive' })}\n---\n`;
    const { vault, run } = setUp({
      rounds: [says({ note: { title: 'Planted rule', body: planted } })],
    });

    await run(rule).catch(() => undefined);

    expect(vault.files.has('.atlas/automations/Planted rule.md')).toBe(false);
  });

  it('reads no note outside .atlas/prompts as its prompt', async () => {
    const rule: AutomationRule = { ...RULE, action: { ...ASK, prompt: STANDUP } };
    const { run, asked } = setUp({ rounds: [says({ proposals: [] })] });

    await run(rule).catch(() => undefined);

    expect(asked()).toBe(0);
  });
});
