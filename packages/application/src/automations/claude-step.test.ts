/**
 * A rule's Claude step (P29-03, ADR-0028), run over a vault held in memory
 * whose index answers with real SQL, with a scripted model in place of
 * Claude. It writes proposals — each citing a block — or one new note, and
 * never edits one; an answer that does not read, a tool the rule does not
 * list, a provider that cannot be used, a stop or a timeout fails the run
 * with nothing written, and says why in the log and in Activity.
 */
import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  digestOf,
  logPathFor,
  parseObjectType,
  parseRunLog,
  readProposal,
  splitFrontmatter,
  type AutomationRule,
  type ClaudeAction,
  type LogEntry,
} from '@atlas/domain';
import { ChatCancelled, ModelProviderError, type ModelEvent } from '../chat/ports.ts';
import { recordingActivity } from '../testing/fake-activity.ts';
import { fakeClaudeStepPorts } from '../testing/fake-claude-step.ts';
import { automationVault, jsonNote, TASK_TYPES } from '../testing/automation-vault.ts';
import type { ScriptedRound } from '../testing/fake-model.ts';
import { runAutomation, runOnNoteChanges } from './run-automation.ts';
import type { VaultGuard } from './vault-guard.ts';

const TODAY = '2026-10-11';
const CLOCK = {
  today: () => TODAY,
  localNow: () => `${TODAY}T09:00:00`,
  now: () => Date.parse(`${TODAY}T09:00:00Z`),
};
const VAULT = '/vaults/home';
const GUARD: VaultGuard = { vault: VAULT, currentVault: () => VAULT };
const STANDUP = 'Meetings/2026-10-01 Standup.md';
const PROMPT = '.atlas/prompts/meeting-actions.md';
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

const NOTES = {
  [STANDUP]: jsonNote(
    { type: 'meeting', kind: 'standup' },
    '**Mara Quill** Can you send me the payroll file by Friday? ^t0003\n',
  ),
  [PROMPT]: '---\nname: x\n---\nFind every action item and propose it as a task.\n',
};

const proposal = (fields: Record<string, unknown> = {}) => ({
  kind: 'task',
  title: 'Send Mara the payroll file',
  properties: { status: 'next' },
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
  status,
}: {
  rounds: readonly ScriptedRound[];
  notes?: Record<string, string>;
  status?: Parameters<typeof fakeClaudeStepPorts>[0] extends infer A
    ? A extends { status?: infer S }
      ? S
      : never
    : never;
}) {
  const claude = fakeClaudeStepPorts({
    rounds,
    model: 'claude-opus-5-5',
    stepMs: 1500,
    ...(status !== undefined && { status }),
  });
  const vault = automationVault({ notes, today: TODAY, types: TYPES, claude });
  const activity = recordingActivity();
  const run = (rule: AutomationRule = RULE) =>
    runAutomation({
      ports: vault.ports,
      rule,
      clock: CLOCK,
      guard: GUARD,
      activity,
      trigger: 'hand',
    });
  const logOf = (rule: AutomationRule = RULE): LogEntry[] =>
    parseRunLog(vault.files.get(logPathFor(rule.id)) ?? '');
  /** What the run wrote besides its log. */
  const written = () => vault.log.filter((line) => !line.includes('.atlas/automations/log/'));
  const messages = () => activity.reports.map((report) => report.message);
  return { claude, vault, activity, run, logOf, written, messages };
}

describe('a Claude step that answers as its rule asks', () => {
  it('writes each proposal it describes as an open proposal note citing its block', async () => {
    const { vault, run, written } = setUp({
      rounds: [
        says({ proposals: [proposal(), proposal({ kind: 'decision', title: 'Pay on Friday' })] }),
      ],
    });

    const entry = await run();

    expect(written()).toEqual([
      'create Inbox/Proposals/Send Mara the payroll file.md',
      'create Inbox/Proposals/Pay on Friday.md',
    ]);
    const path = createVaultPath('Inbox/Proposals/Send Mara the payroll file.md');
    const properties = vault.properties(path);
    expect(readProposal({ path, properties })).toEqual({
      ok: true,
      proposal: {
        path,
        kind: 'task',
        state: 'open',
        confidence: 'high',
        source: '[[2026-10-01 Standup#^t0003]]',
        madeBy: 'Meeting actions · 2026-10-11 09:00:00',
        payload: {
          title: 'Send Mara the payroll file',
          folder: null,
          properties: { status: 'next' },
          body: '',
          linkFrom: null,
        },
      },
    });
    expect(splitFrontmatter(vault.files.get(path)!).body).toBe('Mara asked for it on the call.\n');
    expect(entry).toMatchObject({
      kind: 'run',
      done: [
        { kind: 'proposed', path },
        { kind: 'proposed', path: 'Inbox/Proposals/Pay on Friday.md' },
      ],
      claude: { model: 'claude-opus-5-5', ms: expect.any(Number) },
    });
  });

  it('logs and says in Activity the model, how long it took, and the proposals made', async () => {
    const { run, logOf, messages } = setUp({ rounds: [says({ proposals: [proposal()] })] });

    const entry = await run();

    expect(logOf()).toEqual([entry]);
    expect(entry).toMatchObject({ claude: { model: 'claude-opus-5-5', ms: 1500 } });
    expect(messages()).toEqual([
      'Meeting actions: Ran by hand (2026-10-01 Standup). Made 1 proposal. Asked claude-opus-5-5, 1.5 s.',
    ]);
  });

  it('asks the model the rule’s prompt about the notes, with only the rule’s tools', async () => {
    const { claude, run } = setUp({ rounds: [says({ proposals: [] })] });

    await run();

    const [request] = claude.fake.requests;
    expect(request?.model).toBe('claude-opus-5-5');
    expect(request?.system).toContain('Find every action item and propose it as a task.');
    expect(request?.system).toContain('{ "proposals": [ … ] }');
    expect(request?.tools.map((tool) => tool.name)).toEqual(['atlas_read_note']);
    // The notes ride in the system prompt, where both providers keep a tag as written.
    expect(request?.system).toContain(`<vault_data note="${STANDUP}">`);
    const question = request?.messages[0];
    expect(question?.role === 'user' && question.text).not.toContain('vault_data');
  });

  it('runs the rule’s tools for the model, then reads its last word', async () => {
    const { claude, run, written } = setUp({
      rounds: [
        [
          {
            type: 'tool_call',
            call: { id: 'c1', name: 'atlas_read_note', input: { path: STANDUP } },
          },
        ],
        says({ proposals: [proposal()] }),
      ],
    });

    const entry = await run();

    expect(claude.calls.names).toEqual(['atlas_read_note']);
    expect(entry).toMatchObject({ kind: 'run', done: [{ kind: 'proposed' }] });
    expect(written()).toHaveLength(1);
  });

  it('numbers a proposal past a note already there, never writing over it', async () => {
    const taken = 'Inbox/Proposals/Send Mara the payroll file.md';
    const { vault, run } = setUp({
      // Two proposals of one name: told apart by kind, since the same one twice is made once.
      rounds: [says({ proposals: [proposal(), proposal({ kind: 'follow-up' })] })],
      notes: { ...NOTES, [taken]: 'Mine.\n' },
    });

    await run();

    expect(vault.files.get(taken)).toBe('Mine.\n');
    expect(vault.files.has('Inbox/Proposals/Send Mara the payroll file 2.md')).toBe(true);
    expect(vault.files.has('Inbox/Proposals/Send Mara the payroll file 3.md')).toBe(true);
  });

  it('makes the same proposal once, however often the answer repeats it', async () => {
    const { written, run } = setUp({
      rounds: [
        says({
          proposals: [proposal(), proposal(), proposal({ title: ' send mara  the payroll FILE' })],
        }),
      ],
    });

    const entry = await run();

    expect(entry).toMatchObject({ kind: 'run', done: [{ kind: 'proposed' }] });
    expect(written()).toHaveLength(1);
  });

  it('logs a run that proposed nothing, and writes nothing', async () => {
    const { run, written, messages } = setUp({ rounds: [says('```json\n{"proposals": []}\n```')] });

    expect(await run()).toMatchObject({ kind: 'run', done: [] });
    expect(written()).toEqual([]);
    expect(messages()).toEqual([
      'Meeting actions: Ran by hand (2026-10-01 Standup). Claude proposed nothing. Asked claude-opus-5-5, 1.5 s.',
    ]);
  });

  it('makes one new note in the rule’s folder, numbered past a name taken', async () => {
    const rule: AutomationRule = {
      ...RULE,
      action: { ...ASK, output: { kind: 'note', folder: createVaultPath('Briefs') } },
    };
    const { vault, run } = setUp({
      rounds: [
        says({ note: { title: 'Morning brief', body: '# Today\n', properties: { day: 3 } } }),
      ],
      notes: { ...NOTES, 'Briefs/Morning brief.md': 'Yesterday’s.\n' },
    });

    const entry = await run(rule);

    expect(vault.files.get('Briefs/Morning brief.md')).toBe('Yesterday’s.\n');
    expect(vault.files.get('Briefs/Morning brief 2.md')).toBe(jsonNote({ day: 3 }, '# Today\n'));
    expect(entry).toMatchObject({ done: [{ kind: 'created', path: 'Briefs/Morning brief 2.md' }] });
  });

  it('makes the folder its note goes in when there is none yet', async () => {
    const rule: AutomationRule = {
      ...RULE,
      action: { ...ASK, output: { kind: 'note', folder: createVaultPath('Briefs/Daily') } },
    };
    const { vault, run } = setUp({ rounds: [says({ note: { title: 'Brief', body: 'Hi.\n' } })] });

    await run(rule);

    expect(vault.files.get('Briefs/Daily/Brief.md')).toBe('Hi.\n');
    // The host refuses a note in a folder that is not there: the folder is made first.
    const briefs = await vault.ports.fs.listDirectory(createVaultPath('Briefs'));
    expect(briefs).toEqual([expect.objectContaining({ kind: 'directory', path: 'Briefs/Daily' })]);
  });
});

describe('a Claude step that fails writes nothing, and says why', () => {
  async function failsWith(
    setup: Parameters<typeof setUp>[0],
    problem: string | RegExp,
  ): Promise<ReturnType<typeof setUp>> {
    const step = setUp(setup);
    const entry = await step.run();
    expect(entry).toMatchObject({ kind: 'failed', trigger: 'hand', problem });
    expect(step.written()).toEqual([]);
    expect(step.logOf()).toEqual([entry]);
    expect(step.activity.reports).toHaveLength(1);
    expect(step.activity.reports[0]).toMatchObject({ level: 'error' });
    return step;
  }

  it('fails on malformed JSON', async () => {
    const { messages } = await failsWith(
      { rounds: [says('{"proposals": [')] },
      'Claude’s answer is not what the rule asks for. It is not JSON.',
    );
    expect(messages()[0]).toMatch(/and could not\. Claude’s answer .* Asked claude-opus-5-5/);
  });

  it('fails the whole answer for one item that cites no block, writing none of the others', async () => {
    await failsWith(
      {
        rounds: [
          says({ proposals: [proposal(), proposal({ source: '[[2026-10-01 Standup#^t0099]]' })] }),
        ],
      },
      'Claude’s answer is not what the rule asks for. Item 2: 2026-10-01 Standup has no block ^t0099.',
    );
  });

  it('fails when the model calls a tool the rule does not list, before running it', async () => {
    const { claude } = await failsWith(
      {
        rounds: [
          [{ type: 'tool_call', call: { id: 'c1', name: 'atlas_search', input: { q: 'x' } } }],
          says({ proposals: [proposal()] }),
        ],
      },
      'Claude called atlas_search, which this rule does not let it use.',
    );
    expect(claude.calls.names).toEqual([]);
    expect(claude.fake.requests).toHaveLength(1);
  });

  it('fails when the model calls a chat tool that would propose an edit', async () => {
    await failsWith(
      {
        rounds: [
          [
            {
              type: 'tool_call',
              call: { id: 'c1', name: 'propose_edit', input: { path: STANDUP } },
            },
          ],
        ],
      },
      'Claude called propose_edit, which this rule does not let it use.',
    );
  });

  it('fails with the chat’s fix-it message when Claude Code is not installed', async () => {
    const { claude, messages } = await failsWith(
      {
        rounds: [],
        status: {
          ready: false,
          problem: 'not_installed',
          message: 'Claude Code is not installed on this Mac, or not where DFAI looks for it.',
          fix: 'curl -fsSL https://claude.ai/install.sh | bash',
        },
      },
      'Claude Code is not installed on this Mac, or not where DFAI looks for it. Fix: curl -fsSL https://claude.ai/install.sh | bash',
    );
    expect(claude.fake.requests).toEqual([]);
    expect(messages()[0]).toContain('Fix: curl -fsSL https://claude.ai/install.sh | bash.');
  });

  it('fails with the fix-it message when Claude Code is logged out', async () => {
    await failsWith(
      {
        rounds: [],
        status: {
          ready: false,
          problem: 'not_logged_in',
          message: 'Claude Code is installed but not logged in.',
          fix: 'claude auth login',
        },
      },
      'Claude Code is installed but not logged in. Fix: claude auth login',
    );
  });

  it('fails with the provider’s words when it fails part-way', async () => {
    await failsWith(
      {
        rounds: [
          new ModelProviderError('not_logged_in', 'Claude Code is installed but not logged in.'),
        ],
      },
      'Claude Code is installed but not logged in.',
    );
  });

  it('takes this machine’s paths out of the provider’s words', async () => {
    await failsWith(
      {
        rounds: [
          new ModelProviderError(
            'failed',
            'Claude Code could not answer: no /Users/mara/.claude/x',
          ),
        ],
      },
      'Claude Code could not answer: no <path>',
    );
  });

  it('fails when the time limit passes before the model answers', async () => {
    const holder: { claude?: ReturnType<typeof fakeClaudeStepPorts> } = {};
    const waits = (signal: AbortSignal): AsyncIterable<ModelEvent> => ({
      async *[Symbol.asyncIterator]() {
        holder.claude!.deadlines[0]!.abort();
        if (signal.aborted) throw new ChatCancelled();
        yield* [];
      },
    });
    const step = setUp({ rounds: [waits] });
    holder.claude = step.claude;
    const entry = await step.run();
    expect(entry).toMatchObject({
      kind: 'failed',
      problem: 'Claude did not finish within 10 minutes.',
    });
    expect(step.written()).toEqual([]);
  });

  it('fails when the run is stopped from outside before the model answers', async () => {
    await failsWith(
      { rounds: [new ChatCancelled()] },
      'Claude’s run was stopped before it answered.',
    );
  });

  it('fails when its prompt is not there, or is empty, without asking the model', async () => {
    const withoutPrompt = Object.fromEntries(
      Object.entries(NOTES).filter(([path]) => path !== PROMPT),
    );
    const { claude } = await failsWith(
      { rounds: [], notes: withoutPrompt },
      `Its prompt ${PROMPT} could not be read.`,
    );
    expect(claude.fake.requests).toEqual([]);
    await failsWith(
      { rounds: [], notes: { ...NOTES, [PROMPT]: '---\na: 1\n---\n \n' } },
      `Its prompt ${PROMPT} is empty.`,
    );
  });

  it('fails a rule whose schema is no longer registered, without asking the model', async () => {
    const rule: AutomationRule = {
      ...RULE,
      action: { ...ASK, output: { kind: 'proposals', schema: 'retired-items' } },
    };
    const step = setUp({ rounds: [] });
    expect(await step.run(rule)).toMatchObject({
      kind: 'failed',
      problem: 'There is no output called retired-items.',
    });
    expect(step.claude.fake.requests).toEqual([]);
  });

  it('fails a note answer that does not describe a note', async () => {
    const rule: AutomationRule = {
      ...RULE,
      action: { ...ASK, output: { kind: 'note', folder: createVaultPath('Briefs') } },
    };
    const step = setUp({ rounds: [says({ proposals: [] })] });
    expect(await step.run(rule)).toMatchObject({
      kind: 'failed',
      problem: 'Claude’s answer is not what the rule asks for. It is not { "note": { … } }.',
    });
    expect(step.written()).toEqual([]);
  });
});

describe('a Claude step a note sets off', () => {
  const ON_MEETING: AutomationRule = {
    ...RULE,
    when: { kind: 'note', type: 'meeting', on: ['created'] },
  };

  it('handles the version it was asked about, so the same note never asks again', async () => {
    const step = setUp({ rounds: [says({ proposals: [proposal()] })] });
    const changes = [
      { kind: 'added' as const, path: STANDUP, type: 'meeting', digest: digestOf(NOTES[STANDUP]!) },
    ];
    const ask = () =>
      runOnNoteChanges({
        ports: step.vault.ports,
        rule: ON_MEETING,
        clock: CLOCK,
        guard: GUARD,
        activity: step.activity,
        changes,
      });

    const first = await ask();
    expect(first).toMatchObject({
      kind: 'run',
      versions: [{ path: STANDUP, digest: changes[0]!.digest, wrote: false }],
    });
    expect(await ask()).toBeNull();
    expect(step.claude.fake.requests).toHaveLength(1);
  });

  it('handles no version when it failed, so a run by hand asks again', async () => {
    const step = setUp({ rounds: [says('nope'), says({ proposals: [proposal()] })] });
    const changes = [
      { kind: 'added' as const, path: STANDUP, type: 'meeting', digest: digestOf(NOTES[STANDUP]!) },
    ];
    const failed = await runOnNoteChanges({
      ports: step.vault.ports,
      rule: ON_MEETING,
      clock: CLOCK,
      guard: GUARD,
      activity: step.activity,
      changes,
    });
    expect(failed).toMatchObject({ kind: 'failed' });

    const again = await step.run(ON_MEETING);
    expect(again).toMatchObject({ kind: 'run', done: [{ kind: 'proposed' }] });
  });
});
