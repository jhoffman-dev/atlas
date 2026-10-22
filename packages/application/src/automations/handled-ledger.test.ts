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
} from '@dfai/domain';
import type { ModelEvent } from '../chat/ports.ts';
import { automationVault, jsonNote, TASK_TYPES } from '../testing/automation-vault.ts';
import { recordingActivity } from '../testing/fake-activity.ts';
import { fakeClaudeStepPorts } from '../testing/fake-claude-step.ts';
import { readRuleLog } from './automation-log.ts';
import { recordNewsLetGo, runOnMissedArrivals, runOnNoteChanges } from './run-automation.ts';
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
      rounds: [
        says('Send the file (A)', 'Tasks/Weekly A'),
        says('Send the file (B)', 'Tasks/Weekly B'),
      ],
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
  const letGoOnce = (
    vault: ReturnType<typeof automationVault>,
    activity: ReturnType<typeof recordingActivity>,
  ) =>
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

describe('a rule’s handled ledger, damaged', () => {
  const task = (title: string) => jsonNote({ type: 'task' }, `${title} ^t0001\n`);

  it('is rebuilt on the next run, and Activity says so once', async () => {
    const claude = fakeClaudeStepPorts({
      rounds: [says('Send the file', 'Tasks/Weekly A'), says('Send the file', 'Tasks/Weekly B')],
      model: 'claude-opus-5-5',
      today: TODAY,
    });
    const vault = automationVault({
      notes: {
        'Tasks/Weekly A.md': TEMPLATE,
        'Tasks/Weekly B.md': task('Other words'),
        [PROMPT]: 'Find actions.\n',
      },
      today: TODAY,
      types: TYPES,
      claude,
    });
    const activity = recordingActivity();
    const hear = (path: string, text: string) =>
      runOnNoteChanges({
        ports: vault.ports,
        rule: RULE,
        clock: CLOCK,
        guard: GUARD,
        activity,
        changes: [{ kind: 'added', path, type: 'task', digest: digestOf(text) }],
      });
    await hear('Tasks/Weekly A.md', TEMPLATE);
    const logPath = logPathFor(RULE.id);
    const lost = (vault.files.get(logPath) ?? '').replace(/^- records `\d+`$/m, '- records `9`');
    vault.files.set(logPath, lost);

    await hear('Tasks/Weekly B.md', task('Other words'));
    await hear('Tasks/Weekly B.md', task('Other words'));

    const said = activity.reports.filter((report) => report.message.includes('was damaged'));
    expect(said).toHaveLength(1);
    expect(said[0]).toMatchObject({ level: 'warning', kind: 'automation' });
    const { ledger } = await readRuleLog(vault.ports.fs, RULE);
    expect(ledger?.damaged).toBe(false);
    expect(ledger?.vouchesFrom).toBe(CLOCK.now());
  });
});

describe('catching up on open', () => {
  it('reads the index’s notes once', async () => {
    const vault = automationVault({
      notes: { '.atlas/automations/Task actions.md': 'The rule.\n' },
      today: TODAY,
      types: TYPES,
    });
    let reads = 0;
    const manifest = vault.ports.index.manifest.bind(vault.ports.index);
    vault.ports.index.manifest = () => {
      reads += 1;
      return manifest();
    };

    await runOnMissedArrivals({
      ports: vault.ports,
      rule: RULE,
      clock: CLOCK,
      guard: GUARD,
      activity: recordingActivity(),
    });

    expect(reads).toBe(1);
  });
});
