/**
 * What a rule remembers of the notes it handled (ADR-0028, "The handled
 * ledger"), through the use-cases that write and read its log: news let go
 * folds into one entry and evicts nothing, and a Claude step asked about one
 * note is still asked about another that happens to hold the same bytes.
 */
import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  digestOf,
  logPathFor,
  MAX_LOG_ENTRIES,
  parseObjectType,
  parseRunLog,
  type AutomationRule,
} from '@atlas/domain';
import type { ModelEvent } from '../chat/ports.ts';
import { automationVault, jsonNote, TASK_TYPES } from '../testing/automation-vault.ts';
import { recordingActivity } from '../testing/fake-activity.ts';
import { fakeClaudeStepPorts } from '../testing/fake-claude-step.ts';
import { readRuleLog } from './automation-log.ts';
import { recordNewsLetGo, runOnNoteChanges } from './run-automation.ts';
import type { VaultGuard } from './vault-guard.ts';

const TODAY = '2026-10-11';
const CLOCK = {
  today: () => TODAY,
  localNow: () => `${TODAY}T09:00:00`,
  now: () => Date.parse(`${TODAY}T09:00:00Z`),
};
const VAULT = '/vaults/home';
const GUARD: VaultGuard = { vault: VAULT, currentVault: () => VAULT };
const PROMPT = '.atlas/prompts/actions.md';
const TYPES = [
  ...TASK_TYPES,
  parseObjectType({ name: 'task', label: 'Task', properties: { status: 'text' } }),
];
const RULE: AutomationRule = {
  id: 'Task actions',
  path: createVaultPath('.atlas/automations/Task actions.md'),
  name: 'Task actions',
  enabled: true,
  when: { kind: 'note', type: 'task', on: ['created'] },
  which: 'FROM task',
  olderThanDays: null,
  action: {
    kind: 'claude',
    prompt: createVaultPath(PROMPT),
    tools: [],
    output: { kind: 'proposals', schema: 'proposals' },
  },
};

const TEMPLATE = jsonNote({ type: 'task' }, 'Send Mara the payroll file by Friday. ^t0001\n');
const says = (title: string, note: string): ModelEvent[] => [
  {
    type: 'text',
    text: JSON.stringify({
      proposals: [
        {
          kind: 'task',
          title,
          source: `[[${note}#^t0001]]`,
          confidence: 'high',
          why: 'Mara asked for it.',
        },
      ],
    }),
  },
];

describe('two notes that hold the same bytes', () => {
  it('asks Claude about both: one answered is not the other', async () => {
    const claude = fakeClaudeStepPorts({
      rounds: [says('Send the file (A)', 'Tasks/Weekly A'), says('Send the file (B)', 'Tasks/Weekly B')],
      model: 'claude-opus-5-5',
      today: TODAY,
    });
    const vault = automationVault({
      notes: {
        'Tasks/Weekly A.md': TEMPLATE,
        'Tasks/Weekly B.md': TEMPLATE,
        [PROMPT]: 'Find every action item and propose it as a task.\n',
      },
      today: TODAY,
      types: TYPES,
      claude,
    });
    const activity = recordingActivity();
    const hear = (path: string) =>
      runOnNoteChanges({
        ports: vault.ports,
        rule: RULE,
        clock: CLOCK,
        guard: GUARD,
        activity,
        changes: [{ kind: 'added', path, type: 'task', digest: digestOf(TEMPLATE) }],
      });

    await hear('Tasks/Weekly A.md');
    await hear('Tasks/Weekly B.md');

    expect(claude.fake.requests).toHaveLength(2);
  });
});

describe('news a rule let go', () => {
  const letGoOnce = (vault: ReturnType<typeof automationVault>, activity: ReturnType<typeof recordingActivity>) =>
    recordNewsLetGo({
      ports: vault.ports,
      rule: RULE,
      clock: CLOCK,
      guard: GUARD,
      activity,
      count: 2,
    });

  it('is one entry however often it is said, and costs the log nothing it handled', async () => {
    const vault = automationVault({ notes: {}, today: TODAY, types: TYPES });
    const activity = recordingActivity();
    for (let at = 0; at < 60; at += 1) await letGoOnce(vault, activity);

    const { entries } = await readRuleLog(vault.ports.fs, RULE);
    expect(entries).toEqual([{ kind: 'letGo', at: `${TODAY}T09:00:00`, count: 120 }]);
    expect(entries.length).toBeLessThan(MAX_LOG_ENTRIES);
    expect(parseRunLog(vault.files.get(logPathFor(RULE.id)) ?? '')).toEqual(entries);
  });
});
