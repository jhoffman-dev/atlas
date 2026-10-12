/**
 * A rule's Claude step on "a meeting is created" (P29-03), with the meeting
 * import and its links in front of it (#92, P28-06, P29-04): over a vault
 * held in memory whose index answers with real SQL, a scripted model in
 * place of Claude, and the feed measured after every write to the meeting.
 * What the model is asked, how often, and what it is shown of a long
 * transcript is what is asserted.
 */
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_NOTE_CHARACTERS,
  createVaultPath,
  logPathFor,
  noteChangesBetween,
  parseObjectType,
  parseRunLog,
  versionsAfter,
  type AutomationRule,
  type NoteChange,
  type NoteVersion,
  type VaultPath,
} from '@atlas/domain';
import type { ModelEvent } from '../chat/ports.ts';
import { heldEntries } from '../index/refresh-index.ts';
import { createMeetingLinker } from '../meeting-links/link-imported-meetings.ts';
import { createMeetingImporter } from '../meetings/meeting-importer.ts';
import { automationVault, jsonNote, TASK_TYPES } from '../testing/automation-vault.ts';
import { recordingActivity } from '../testing/fake-activity.ts';
import { fakeClaudeStepPorts } from '../testing/fake-claude-step.ts';
import type { ScriptedRound } from '../testing/fake-model.ts';
import { MEETING_HEADER } from '../testing/meeting-files.ts';
import { runAutomation, runOnNoteChanges } from './run-automation.ts';
import type { VaultGuard } from './vault-guard.ts';

const TODAY = '2026-10-08';
const CLOCK = { today: () => TODAY, localNow: () => `${TODAY}T09:00:00` };
const VAULT = '/vaults/home';
const GUARD: VaultGuard = { vault: VAULT, currentVault: () => VAULT };
const MEETING = 'Inbox/Meetings/2026-10-06 Standup.md';
const PROMPT = '.atlas/prompts/meeting-actions.md';
const TYPES = [
  ...TASK_TYPES,
  parseObjectType({ name: 'meeting', label: 'Meeting', properties: { status: 'text' } }),
];

/** Mara Quill is a person; "Lark Spur Pay" is a product the vocabulary puts right. */
const DIRECTORY = {
  'People/Mara Quill.md': jsonNote({ type: 'person' }, ''),
  'Terms/Larkspur Pay.md': jsonNote(
    { type: 'term', kind: 'product', variants: ['Lark Spur Pay'] },
    '',
  ),
  [PROMPT]: 'Find every action item and propose it as a task.\n',
};

const BODY = [
  '',
  '## Summary',
  '',
  'Lark Spur Pay go-live moves a week. ^s1',
  '',
  '## Transcript',
  '',
  '**Mara Quill** [~00:00:00] Send me the Lark Spur Pay file by Friday. ^t0001',
  '',
  '**Mara Quill** [~00:00:09] And book the go-live review. ^t0002',
  '',
].join('\n');

const ON_CREATED: AutomationRule = {
  id: 'Meeting actions',
  path: createVaultPath('.atlas/automations/Meeting actions.md'),
  name: 'Meeting actions',
  enabled: true,
  when: { kind: 'note', type: 'meeting', on: ['created'] },
  which: 'FROM meeting',
  olderThanDays: null,
  action: {
    kind: 'claude',
    prompt: createVaultPath(PROMPT),
    tools: [],
    output: { kind: 'proposals', schema: 'proposals' },
  },
};
const ON_CHANGED: AutomationRule = {
  ...ON_CREATED,
  id: 'Meeting edits',
  path: createVaultPath('.atlas/automations/Meeting edits.md'),
  name: 'Meeting edits',
  when: { kind: 'note', type: 'meeting', on: ['changed'] },
};

const task = (title: string, turn: string) => ({
  kind: 'task',
  title,
  source: `[[2026-10-06 Standup#^${turn}]]`,
  confidence: 'high',
  why: 'Mara asked for it.',
});
const says = (value: unknown): ModelEvent[] => [{ type: 'text', text: JSON.stringify(value) }];
const TWO = says({
  proposals: [task('Send Mara the file', 't0001'), task('Book the go-live review', 't0002')],
});

async function setUp(rounds: readonly ScriptedRound[] = [TWO]) {
  const claude = fakeClaudeStepPorts({ rounds, model: 'claude-opus-5-5', today: TODAY });
  const vault = automationVault({ notes: { ...DIRECTORY }, today: TODAY, types: TYPES, claude });
  const activity = recordingActivity();
  const wiring = {
    ports: () => vault.ports,
    clock: CLOCK,
    activity,
    openVault: () => VAULT,
    onWritten: () => undefined,
  };
  const linker = createMeetingLinker({ ...wiring, selfName: () => null });
  const importer = createMeetingImporter({
    ...wiring,
    active: () => true,
    beforeLetIn: async (vaultKey: string, path: VaultPath) => void (await linker(vaultKey, [path])),
  });

  // The feed, as `syncIndex` keeps it: measured from what was held, which each sync's changes move on.
  let held = new Map<string, NoteVersion>(await heldEntries(vault.ports.index));
  const sync = async (): Promise<NoteChange[]> => {
    const changes = noteChangesBetween(held, await heldEntries(vault.ports.index));
    held = versionsAfter(held, changes);
    return changes;
  };
  /** Every feed a rule could hear, in order: a sync after each write to a meeting file. */
  const feeds: NoteChange[][] = [];
  const write = vault.ports.fs.writeTextFile;
  vault.ports.fs.writeTextFile = async (args) => {
    const modified = await write(args);
    if (args.path.startsWith('Inbox/Meetings/')) feeds.push(await sync());
    return modified;
  };

  /** A meeting file lands, as a pull lands it, and the import hears of it. */
  const arrive = async (path: string, header: Record<string, unknown> = {}, body = BODY) => {
    const contents = jsonNote({ ...MEETING_HEADER, ...header }, body);
    await vault.ports.fs.createNote({ path: createVaultPath(path), contents });
    const landed = await sync();
    feeds.push(landed);
    await importer.hear({ vault: VAULT, changes: landed });
  };
  /** Hands every feed heard so far to the rule, then whatever its own writes made of the vault. */
  const hear = async (rule: AutomationRule) => {
    const entries = [];
    for (const changes of feeds.splice(0)) {
      entries.push(
        await runOnNoteChanges({
          ports: vault.ports,
          rule,
          clock: CLOCK,
          guard: GUARD,
          activity,
          changes,
        }),
      );
    }
    feeds.push(await sync());
    return entries;
  };
  const proposals = () =>
    [...vault.files.keys()].filter((at) => at.startsWith('Inbox/Proposals/')).sort();
  const logOf = (rule: AutomationRule) => parseRunLog(vault.files.get(logPathFor(rule.id)) ?? '');
  const asked = () => claude.fake.requests;
  return { vault, arrive, hear, proposals, logOf, asked };
}

describe('a Claude step on a meeting that arrives', () => {
  it('is asked once, about the meeting as the import left it: stamped, corrected and linked', async () => {
    const { arrive, hear, proposals, asked } = await setUp();
    await arrive(MEETING);

    const entries = await hear(ON_CREATED);

    // Landed, then linked: not yet a note to a rule. Stamped with its corrections: its arrival.
    expect(entries.map((entry) => entry?.kind ?? null)).toEqual([null, null, 'run']);
    expect(asked()).toHaveLength(1);
    const told = asked()[0]!.system;
    expect(told).toContain('"atlas_import_outcome":"imported"');
    expect(told).toContain('"people":["[[Mara Quill]]"]');
    expect(told).toContain('Send me the Larkspur Pay file by Friday. ^t0001');
    expect(told).not.toContain('Lark Spur Pay file');
    expect(proposals()).toEqual([
      'Inbox/Proposals/Book the go-live review.md',
      'Inbox/Proposals/Send Mara the file.md',
    ]);
  });

  it('is not set off by the proposals it made, nor asked again when the same feed is heard twice', async () => {
    const { arrive, hear, proposals, asked, logOf } = await setUp();
    await arrive(MEETING);
    const [, , ran] = await hear(ON_CREATED);
    expect(ran).toMatchObject({ kind: 'run', done: [{ kind: 'proposed' }, { kind: 'proposed' }] });

    // What the next sync reports is its own two proposals, and nothing of the meeting.
    const after = await hear(ON_CREATED);

    expect(after).toEqual([null]);
    expect(asked()).toHaveLength(1);
    expect(proposals()).toHaveLength(2);
    expect(logOf(ON_CREATED)).toHaveLength(1);
  });

  it('does not set off a rule on meetings that change: every write of the arrival is the import’s', async () => {
    const { arrive, hear, asked, proposals } = await setUp();
    await arrive(MEETING);

    expect(await hear(ON_CHANGED)).toEqual([null, null, null]);
    expect(asked()).toEqual([]);
    expect(proposals()).toEqual([]);
  });

  it('asks nothing when the same meeting is delivered again: the copy is never a meeting to a rule', async () => {
    const { vault, arrive, hear, asked, proposals } = await setUp();
    await arrive(MEETING);
    await hear(ON_CREATED);

    await arrive('Inbox/Meetings/2026-10-06 Standup again.md');
    const again = await hear(ON_CREATED);

    expect(again.every((entry) => entry === null)).toBe(true);
    expect(again.length).toBeGreaterThan(0);
    expect(asked()).toHaveLength(1);
    expect(proposals()).toHaveLength(2);
    // The copy was judged a duplicate by the import: that is why the rule never heard it.
    const copies = [...vault.files.entries()].filter(([, text]) => text.includes('"duplicate"'));
    expect(copies).toHaveLength(1);
  });

  it('proposes nothing twice when its log is lost and it is run by hand over the same meeting', async () => {
    const { vault, arrive, hear, asked, proposals } = await setUp([TWO, TWO]);
    await arrive(MEETING);
    await hear(ON_CREATED);
    vault.files.delete(logPathFor(ON_CREATED.id));

    await runAutomation({
      ports: vault.ports,
      rule: ON_CREATED,
      clock: CLOCK,
      guard: GUARD,
      activity: recordingActivity(),
      trigger: 'hand',
    });

    // Asked again, since nothing says it was — and the writer every proposal goes through made none again.
    expect(asked()).toHaveLength(2);
    expect(proposals()).toHaveLength(2);
  });
});

describe('a Claude step on a meeting longer than it is shown', () => {
  const longTurn = `**Mara Quill** [~00:20:00] Payroll ${'runs long '.repeat(900)}^t0998`;
  const LONG_BODY = [
    BODY,
    ...Array.from(
      { length: 200 },
      (_, at) =>
        `**Mara Quill** [~00:10:00] We ship the release on Friday, all of it. ^t${String(at + 100).padStart(4, '0')}\n`,
    ),
    `${longTurn}\n`,
    '**Mara Quill** [~00:30:00] And the last word. ^t0999\n',
  ].join('\n');

  it('shows whole turns only, and says in its log how much of the meeting it read', async () => {
    const { arrive, hear, asked, logOf, vault } = await setUp();
    await arrive(MEETING, {}, LONG_BODY);

    await hear(ON_CREATED);

    const told = asked()[0]!.system;
    expect(vault.files.get(MEETING)!.length).toBeGreaterThan(CLAUDE_NOTE_CHARACTERS);
    expect(told).toContain('^t0001');
    expect(told).not.toContain('runs long');
    expect(told).not.toContain('^t0999');
    expect(told).toMatch(/all of it\. \^t\d{4}\n… \(cut\)/);
    const [entry] = logOf(ON_CREATED);
    expect(entry).toMatchObject({
      kind: 'run',
      claude: { cut: [{ path: MEETING, of: vault.files.get(MEETING)!.length }] },
    });
    expect(vault.files.get(logPathFor(ON_CREATED.id))).toContain(
      '1 note was too long to read whole: Claude saw only the start.',
    );
  });

  it('refuses an answer citing a turn past the cut, writing nothing, and still says the note was cut', async () => {
    const answer = says({
      proposals: [task('Send Mara the file', 't0001'), task('Last', 't0999')],
    });
    const { arrive, hear, proposals, logOf } = await setUp([answer]);
    await arrive(MEETING, {}, LONG_BODY);

    await hear(ON_CREATED);

    expect(proposals()).toEqual([]);
    const [entry] = logOf(ON_CREATED);
    expect(entry).toMatchObject({ kind: 'failed', claude: { cut: [{ path: MEETING }] } });
    expect(entry?.kind === 'failed' && entry.problem).toContain('has no block ^t0999');
  });

  it('says nothing of a cut for a meeting it read whole', async () => {
    const { arrive, hear, logOf } = await setUp();
    await arrive(MEETING);
    await hear(ON_CREATED);

    const [entry] = logOf(ON_CREATED);
    expect(entry?.kind === 'run' && entry.claude).toEqual({ model: 'claude-opus-5-5', ms: 250 });
  });
});
