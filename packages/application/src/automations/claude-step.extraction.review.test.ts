/**
 * Review fixes to meeting extraction (P29-05, #18, PR #102): what a run does
 * about a meeting with nothing to cite, one the import did not let in, a
 * Meeting type without the relations, a prompt too large to hand over, and
 * the deadline and cap that count a whole run. Same in-memory vault and
 * fixture meetings as `claude-step.extraction.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  logPathFor,
  MEETING_EXTRACTION_PROMPT,
  builtInPromptAt,
  parseObjectType,
  splitFrontmatter,
  type AutomationRule,
} from '@atlas/domain';
import type { ModelEvent } from '../chat/ports.ts';
import { listProposals } from '../proposals/list-proposals.ts';
import { automationVault, jsonNote } from '../testing/automation-vault.ts';
import { recordingActivity } from '../testing/fake-activity.ts';
import { fakeClaudeStepPorts } from '../testing/fake-claude-step.ts';
import type { ScriptedRound } from '../testing/fake-model.ts';
import { runAutomation } from './run-automation.ts';
import type { VaultGuard } from './vault-guard.ts';

const TODAY = '2026-10-11';
const CLOCK = {
  today: () => TODAY,
  localNow: () => `${TODAY}T09:00:00`,
  now: () => Date.parse(`${TODAY}T09:00:00Z`),
};
const VAULT = '/vaults/home';
const GUARD: VaultGuard = { vault: VAULT, currentVault: () => VAULT };

/** A fixture meeting as the import leaves it, with its frontmatter as this vault's reader takes it. */
function fixtureMeeting(name: string, header: Record<string, unknown>): string {
  const text = readFileSync(
    new URL(`../../../domain/src/meetings/fixtures/valid/${name}`, import.meta.url),
    'utf8',
  );
  return jsonNote(
    { type: 'meeting', atlas_import: 'meeting/v1', atlas_import_outcome: 'imported', ...header },
    splitFrontmatter(text).body,
  );
}

const SYNC = 'Meetings/Platform weekly sync.md';
const CALL = 'Meetings/Vendor contract call.md';
const GEMINI = fixtureMeeting('gemini-platform-sync.md', {
  title: 'Platform weekly sync',
  date: '2026-09-29',
  start: '10:00',
  provider: 'gemini',
  external_id: 'gemini-7f3a9c21',
  attendees: [
    { name: 'Mara Quill', email: 'mara.quill@example.com' },
    { name: 'Tobias Fenn', email: 'tobias.fenn@example.com' },
    { name: 'platform-team', email: 'platform-team@example.com', group: true },
  ],
});
const GRANOLA = fixtureMeeting('granola-vendor-call.md', {
  title: 'Vendor contract call',
  date: '2026-10-01',
  start: '14:14',
  provider: 'granola',
  external_id: 'granola-0b52e8d4',
  transcript_clock: 'wall',
  attendees: [{ name: 'Lena Hart', email: 'lena.hart@example.org' }],
});

const relation = (target: string) => ({ kind: 'relation', target, many: true });
const TYPE_FILES = {
  meeting: { provider: 'text', tasks: relation('task'), decisions: relation('decision') },
  task: {
    status: { kind: 'select', options: ['inbox', 'next-action', 'waiting', 'archive'] },
    waiting_on: { kind: 'relation', target: 'person' },
    due: 'date',
  },
  decision: { meeting: { kind: 'relation', target: 'meeting' } },
  person: {},
  term: {},
};
const TYPES = Object.entries(TYPE_FILES).map(([name, properties]) =>
  parseObjectType({ name, label: name, properties }),
);

/** Mara owns the vault; Tobias has a Person note; Lena has none. */
const NOTES = {
  [SYNC]: GEMINI,
  [CALL]: GRANOLA,
  'People/Mara Quill.md': jsonNote({ type: 'person', email: 'mara.quill@example.com' }, ''),
  'People/Tobias Fenn.md': jsonNote({ type: 'person', email: 'tobias.fenn@example.com' }, ''),
  'Terms/Larkspur Pay.md': jsonNote({ type: 'term', kind: 'product', variants: ['Lark Spur'] }, ''),
  [MEETING_EXTRACTION_PROMPT]: builtInPromptAt(MEETING_EXTRACTION_PROMPT)!.contents,
  ...Object.fromEntries(
    Object.entries(TYPE_FILES).map(([name, properties]) => [
      `.atlas/types/${name}.md`,
      jsonNote({ name, properties }, ''),
    ]),
  ),
};

const rule = (which: string): AutomationRule => ({
  id: 'Meeting extraction',
  path: createVaultPath('.atlas/automations/Meeting extraction.md'),
  name: 'Meeting extraction',
  enabled: true,
  when: { kind: 'manual' },
  which,
  olderThanDays: null,
  action: {
    kind: 'claude',
    prompt: MEETING_EXTRACTION_PROMPT,
    tools: [],
    output: { kind: 'proposals', schema: 'meeting-items' },
  },
});
const SYNC_ONLY = rule('FROM meeting WHERE provider = gemini');
const BOTH = rule('FROM meeting');

const item = (fields: Record<string, unknown>) => ({ confidence: 'high', owner: '', ...fields });
const says = (...items: unknown[]): ModelEvent[] => [
  { type: 'text', text: JSON.stringify({ items }) },
];

const FROM_SYNC = says(
  item({
    kind: 'task',
    title: 'Write the rollout note',
    owner: 'Mara Quill',
    source_block: 't0003',
    due: '2026-10-02',
  }),
  item({ kind: 'task', title: 'Flag the new cache', owner: 'Tobias Fenn', source_block: 't0002' }),
  item({ kind: 'decision', title: 'Ship the cache behind a flag', source_block: 't0003' }),
  item({
    kind: 'follow-up',
    title: 'Check Friday still works',
    source_block: 't0004',
    confidence: 'medium',
  }),
);
function setUp(rounds: readonly ScriptedRound[], notes: Record<string, string> = NOTES) {
  const claude = fakeClaudeStepPorts({
    rounds,
    model: 'claude-opus-5-5',
    today: TODAY,
    selfName: 'Mara Quill',
  });
  const vault = automationVault({ notes: { ...notes }, today: TODAY, types: TYPES, claude });
  const activity = recordingActivity();
  const run = (which: AutomationRule) =>
    runAutomation({
      ports: vault.ports,
      rule: which,
      clock: CLOCK,
      guard: GUARD,
      activity,
      trigger: 'hand',
    });
  const proposals = async () => {
    const { open } = await listProposals({ fs: vault.ports.fs, markdown: vault.ports.markdown });
    return new Map(
      open.map((listed) => [
        listed.proposal.payload && 'title' in listed.proposal.payload
          ? listed.proposal.payload.title
          : '',
        listed,
      ]),
    );
  };
  const properties = (path: string) =>
    vault.ports.markdown.frontmatterProperties(
      splitFrontmatter(vault.files.get(path) ?? '').frontmatter,
    );
  const log = () => vault.files.get(logPathFor(BOTH.id)) ?? '';
  return {
    vault,
    claude,
    activity,
    run,
    proposals,
    properties,
    log,
    asked: () => claude.fake.requests,
  };
}

describe('a meeting with no transcript turn', () => {
  it('is not asked about, and the log says why', async () => {
    const bare = jsonNote(
      {
        type: 'meeting',
        atlas_import: 'meeting/v1',
        atlas_import_outcome: 'imported',
        provider: 'gemini',
        external_id: 'x1',
        title: 'Platform weekly sync',
        date: '2026-09-29',
      },
      '## Summary\n\nNothing was said.\n',
    );
    const { run, asked, log } = setUp([says()], { ...NOTES, [SYNC]: bare });

    const entry = await run(SYNC_ONLY);

    expect(asked()).toHaveLength(0);
    expect(entry).toMatchObject({ kind: 'run', left: [{ path: SYNC }] });
    expect(log()).toContain('no transcript turn');
    expect(entry.kind === 'run' && entry.claude?.asks).toBeUndefined();
  });
});

describe('a meeting the import did not let in', () => {
  it('is read, and its proposals are made without joining it, saying so', async () => {
    const byHand = fixtureMeeting('gemini-platform-sync.md', {
      title: 'Platform weekly sync',
      date: '2026-09-29',
      provider: 'gemini',
      external_id: 'gemini-7f3a9c21',
      atlas_import_outcome: undefined,
      attendees: [{ name: 'Mara Quill', email: 'mara.quill@example.com' }],
    });
    // Filed before DFAI imported: in `Meetings`, an unstamped contract file would be an arrival
    // still waiting for the import, not in play at all (#214).
    const others = Object.fromEntries(Object.entries(NOTES).filter(([path]) => path !== SYNC));
    const filedBefore = 'Projects/Platform/Platform weekly sync.md';
    const { run, proposals, properties } = setUp([FROM_SYNC], {
      ...others,
      [filedBefore]: byHand,
    });

    const entry = await run(SYNC_ONLY);

    expect(entry.kind).toBe('run');
    const made = (await proposals()).get('Write the rollout note')!;
    expect(properties(made.proposal.path)['payload']).not.toHaveProperty('link_from');
    expect(made.reason).toContain('not imported');
  });
});

describe('a Meeting type without the relations', () => {
  it('is warned of once in the run, and the proposals are still made', async () => {
    const files = {
      ...NOTES,
      '.atlas/types/meeting.md': jsonNote(
        { name: 'meeting', properties: { provider: 'text' } },
        '',
      ),
    };
    const { run, log, activity } = setUp([FROM_SYNC], files);

    const entry = await run(SYNC_ONLY);

    expect(entry).toMatchObject({
      kind: 'run',
      claude: { warnings: [expect.stringContaining('“tasks” or “decisions”')] },
    });
    expect(log().match(/- warned:/g)).toHaveLength(1);
    expect(activity.reports.at(-1)?.message).toContain('Meeting type has no');
  });
});

describe('a prompt too large to hand over', () => {
  it('fails before Claude is asked and costs nothing against the hourly cap', async () => {
    const huge = `# Meeting extraction\n\n${'Pull out every commitment. '.repeat(2_000)}`;
    const { run, asked } = setUp([says()], { ...NOTES, [MEETING_EXTRACTION_PROMPT]: huge });

    const entry = await run(SYNC_ONLY);

    expect(asked()).toHaveLength(0);
    expect(entry).toMatchObject({
      kind: 'failed',
      problem: expect.stringContaining('at most 20000'),
    });
    expect(entry.kind === 'failed' && entry.claude?.asks).toBeUndefined();
  });
});

describe('the time a run may take', () => {
  it('is one deadline for every ask of it, not one for each', async () => {
    let body = splitFrontmatter(GEMINI).body;
    for (let id = 5; id < 105; id += 1) {
      body += `\n**Tobias Fenn** [~00:10:00] Turn ${id}. ${'word '.repeat(75)}^t${String(id).padStart(4, '0')}\n`;
    }
    const long = `${GEMINI.slice(0, GEMINI.length - splitFrontmatter(GEMINI).body.length)}${body}`;
    const { run, asked, claude } = setUp([says(), says(), says()], { ...NOTES, [SYNC]: long });

    await run(SYNC_ONLY);

    expect(asked().length).toBeGreaterThan(1);
    expect(claude.deadlines).toHaveLength(1);
  });
});
