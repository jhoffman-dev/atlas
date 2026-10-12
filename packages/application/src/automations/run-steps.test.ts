/**
 * A rule of several steps on a meeting (P29-06): the "After a meeting" rule,
 * over a vault held in memory whose index answers with real SQL, with the
 * meeting import and its linking in front of it and a scripted model in place
 * of Claude. What each step did, what it left alone because it was already
 * done, where a failure stopped the run and what stayed, what the model was
 * asked and how often, and what the log and Activity then say.
 */
import { describe, expect, it } from 'vitest';
import {
  AFTER_A_MEETING_PRESET,
  CLAUDE_ASKS_PER_RUN,
  CLAUDE_NOTE_CHARACTERS,
  createVaultPath,
  logPathFor,
  MEETING_EXTRACTION_PROMPT,
  noteChangesBetween,
  noteRunsHeldUntil,
  parseObjectType,
  parseRunLog,
  TERM_SUGGESTIONS_PROMPT,
  versionsAfter,
  type AutomationRule,
  type LogEntry,
  type NoteChange,
  type NoteVersion,
} from '@atlas/domain';
import { ModelProviderError, type ModelEvent } from '../chat/ports.ts';
import { heldEntries } from '../index/refresh-index.ts';
import { createMeetingLinker, linkBeforeLetIn } from '../meeting-links/link-imported-meetings.ts';
import {
  recorrectMeetingTerms,
  undoMeetingTermCorrections,
} from '../meetings/meeting-corrections.ts';
import { createMeetingImporter } from '../meetings/meeting-importer.ts';
import { acceptProposalNote } from '../proposals/accept-proposal.ts';
import { automationVault, jsonNote, TASK_TYPES } from '../testing/automation-vault.ts';
import { recordingActivity } from '../testing/fake-activity.ts';
import { fakeClaudeStepPorts } from '../testing/fake-claude-step.ts';
import type { ScriptedRound } from '../testing/fake-model.ts';
import { MEETING_HEADER } from '../testing/meeting-files.ts';
import { runAutomation, runOnNoteChanges } from './run-automation.ts';
import { undoLastRun } from './undo-last-run.ts';
import { VaultChangedError, type VaultGuard } from './vault-guard.ts';

const TODAY = '2026-10-08';
const VAULT = '/vaults/home';
const GUARD: VaultGuard = { vault: VAULT, currentVault: () => VAULT };
const ARRIVED = 'Inbox/Meetings/2026-10-06 Standup.md';
const BY_HAND = 'Meetings/2026-10-07 Planning.md';
const TYPES = [
  ...TASK_TYPES,
  parseObjectType({ name: 'meeting', label: 'Meeting', properties: { status: 'text' } }),
];

const RULE: AutomationRule = {
  ...AFTER_A_MEETING_PRESET,
  id: 'After a meeting',
  path: createVaultPath('.atlas/automations/After a meeting.md'),
};

/** Mara Quill is a person; "Lark Spur Pay" is a product the vocabulary already puts right. */
const DIRECTORY = {
  'People/Mara Quill.md': jsonNote({ type: 'person', email: 'mara.quill@example.com' }, ''),
  'Terms/Larkspur Pay.md': jsonNote(
    { type: 'term', kind: 'product', variants: ['Lark Spur Pay'] },
    '',
  ),
  [MEETING_EXTRACTION_PROMPT]: 'Pull out what somebody now has to do.\n',
  [TERM_SUGGESTIONS_PROMPT]: 'Find the spellings that look like misheard names.\n',
};

/** A known attendee, and one the vault has no person for. */
const ATTENDEES = [
  { name: 'Mara Quill', email: 'mara.quill@example.com' },
  { name: 'Ada Venn', email: 'ada.venn@example.com' },
];

/** "Lark Spur Pay" is a mishearing the terms list; "Larkspar Pay" is one they do not, yet. */
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
  '**Ada Venn** [~00:00:09] I will. Larkspar Pay needs its review booked too. ^t0002',
  '',
].join('\n');

const says = (value: unknown): ModelEvent[] => [{ type: 'text', text: JSON.stringify(value) }];
const ITEMS = says({
  items: [
    {
      kind: 'task',
      title: 'Send Mara the file',
      owner: 'Ada Venn',
      source_block: 't0002',
      confidence: 'high',
    },
  ],
});
const TERMS = says({
  terms: [
    {
      heard: 'Larkspar Pay',
      canonical: 'Larkspur Pay',
      kind: 'product',
      source_block: 't0002',
      confidence: 'high',
    },
  ],
});
/** The provider's own failure, as the adapter raises it: the step's failure, not a fault of the run. */
const FELL_OVER = new ModelProviderError('failed', 'The model fell over.');
const NO_ITEMS = says({ items: [] });
const NO_TERMS = says({ terms: [] });

async function setUp(rounds: readonly ScriptedRound[] = [ITEMS, TERMS]) {
  let now = 0;
  const clock = {
    today: () => TODAY,
    // Each run starts a second after the last, so entries are told apart by when they ran.
    localNow: () => `${TODAY}T09:00:${String(now++).padStart(2, '0')}`,
  };
  const claude = fakeClaudeStepPorts({ rounds, model: 'claude-opus-5-5', today: TODAY });
  const vault = automationVault({ notes: { ...DIRECTORY }, today: TODAY, types: TYPES, claude });
  vault.ports.fs.trashEntry = async ({ path }) => void vault.files.delete(path);
  const activity = recordingActivity();
  const wiring = {
    ports: () => vault.ports,
    clock,
    activity,
    openVault: () => VAULT,
    onWritten: () => undefined,
  };
  const linker = createMeetingLinker({ ...wiring, selfName: () => null });
  const importer = createMeetingImporter({
    ...wiring,
    active: () => true,
    beforeLetIn: linkBeforeLetIn(linker),
  });

  let held = new Map<string, NoteVersion>(await heldEntries(vault.ports.index));
  const sync = async (): Promise<NoteChange[]> => {
    const changes = noteChangesBetween(held, await heldEntries(vault.ports.index));
    held = versionsAfter(held, changes);
    return changes;
  };
  const run = { ports: vault.ports, rule: RULE, clock, guard: GUARD, activity };

  /** A meeting file lands where meeting files land, the import lets it in, and the rule hears every sync. */
  const arrive = async (path = ARRIVED, body = BODY, header: Record<string, unknown> = {}) => {
    const contents = jsonNote({ ...MEETING_HEADER, attendees: ATTENDEES, ...header }, body);
    await vault.ports.fs.createNote({ path: createVaultPath(path), contents });
    await importer.hear({ vault: VAULT, changes: await sync() });
    return runOnNoteChanges({ ...run, changes: await sync() });
  };
  /** A meeting somebody wrote by hand, outside the import: no stamp, no record of anything. */
  const byHand = (path = BY_HAND, body = BODY, more: Record<string, unknown> = {}) => {
    const header = { type: 'meeting', title: 'Planning', date: '2026-10-07', ...more };
    return vault.ports.fs.createNote({
      path: createVaultPath(path),
      contents: jsonNote({ ...header, attendees: ATTENDEES }, body),
    });
  };
  const runNow = () => runAutomation({ ...run, trigger: 'hand' });
  const proposals = () =>
    [...vault.files.keys()].filter((at) => at.startsWith('Inbox/Proposals/')).sort();
  const log = () => parseRunLog(vault.files.get(logPathFor(RULE.id)) ?? '');
  const body = (path: string) => vault.files.get(path)?.replace(/^---\n[\s\S]*?\n---\n/, '');
  return {
    vault,
    run,
    activity,
    arrive,
    byHand,
    runNow,
    proposals,
    log,
    body,
    asked: () => claude.fake.requests,
  };
}

const outcomes = (entry: LogEntry | null) =>
  entry !== null && 'steps' in entry ? entry.steps?.records.map((record) => record.outcome) : null;
const said = (entry: LogEntry | null) =>
  entry !== null && 'steps' in entry ? (entry.steps?.records.map((record) => record.said) ?? []) : [];

describe('the "After a meeting" rule on a meeting the import let in', () => {
  it('finds it corrected and linked already, writes nothing to it, and asks Claude twice', async () => {
    const { vault, arrive, asked, proposals } = await setUp();
    const writes: string[] = [];
    const write = vault.ports.fs.writeTextFile;
    vault.ports.fs.writeTextFile = (args) => {
      writes.push(args.path);
      return write(args);
    };

    const entry = await arrive();

    // The import corrected and linked it; the rule's two steps say so and do not write the meeting.
    expect(outcomes(entry)).toEqual(['already', 'already', 'done', 'done']);
    expect(said(entry)).toEqual([
      'Already corrected when it arrived (2 misheard spellings); not corrected again.',
      'Already linked when it arrived; not linked again.',
      'Asked Claude 1 time: made 1 proposal.',
      'Asked Claude 1 time: suggested 1 term.',
    ]);
    const meetingWrites = writes.filter((path) => path === ARRIVED);
    // Two by the import (links, then the stamp with the corrections), none by the rule.
    expect(meetingWrites).toHaveLength(2);
    expect(asked()).toHaveLength(2);
    expect(vault.properties(ARRIVED)).toMatchObject({
      atlas_import_outcome: 'imported',
      people: ['[[Mara Quill]]'],
      atlas_links: [{ key: 'people', added: ['[[Mara Quill]]'] }],
    });
    expect(proposals()).toEqual([
      'Inbox/Proposals/Ada Venn — Standup.md',
      'Inbox/Proposals/Larkspur Pay.md',
      'Inbox/Proposals/Send Mara the file.md',
    ]);
  });

  it('logs one entry for the meeting: its steps, what Claude was asked, and no change of its own to undo', async () => {
    const { arrive, log } = await setUp();
    await arrive();

    const [entry] = log().filter((each) => each.kind === 'run');

    expect(entry).toMatchObject({
      kind: 'run',
      trigger: 'note',
      steps: {
        note: ARRIVED,
        records: [
          { step: 'correct-terms', outcome: 'already' },
          { step: 'link-meeting', outcome: 'already' },
          { step: 'claude meeting-items', outcome: 'done' },
          { step: 'claude term-suggestions', outcome: 'done' },
        ],
      },
      // Neither a correction nor a link is logged: this run made none.
      done: [
        { kind: 'proposed', path: 'Inbox/Proposals/Send Mara the file.md' },
        { kind: 'proposed', path: 'Inbox/Proposals/Larkspur Pay.md' },
      ],
      claude: { model: 'claude-opus-5-5', asks: 2 },
    });
    expect(entry?.kind === 'run' && entry.versions?.map((version) => version.path)).toEqual([
      ARRIVED,
    ]);
  });

  it('says the run in Activity as one line that opens to its steps', async () => {
    const { arrive, activity } = await setUp();
    await arrive();

    const lines = activity.reports.filter((report) => report.kind === 'automation');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'info',
      subject: { kind: 'note', path: ARRIVED },
      details: [
        '1. Already corrected when it arrived (2 misheard spellings); not corrected again.',
        '2. Already linked when it arrived; not linked again.',
        '3. Asked Claude 1 time: made 1 proposal.',
        '4. Asked Claude 1 time: suggested 1 term.',
      ],
    });
    expect(lines[0]?.message).toMatch(
      /^After a meeting · 2026-10-06 Standup: ran its 4 steps\. Asked claude-opus-5-5, /,
    );
  });

  it('shows each Claude step the meeting corrected, and the term step what the terms already list', async () => {
    const { arrive, asked } = await setUp();
    await arrive();

    const [extraction, terms] = asked().map((request) => request.system);

    expect(extraction).toContain('Send me the Larkspur Pay file by Friday. ^t0001');
    expect(extraction).toContain('Pull out what somebody now has to do.');
    expect(terms).toContain('Find the spellings that look like misheard names.');
    expect(terms).toContain('Larkspur Pay ← Lark Spur Pay');
    expect(terms).toContain('Larkspar Pay needs its review booked too. ^t0002');
  });

  it('is not run again on the meeting, by hand or when the same news is heard twice', async () => {
    const { arrive, runNow, asked, log } = await setUp();
    await arrive();

    const again = await runNow();

    expect(again).toMatchObject({ kind: 'run', done: [] });
    expect(again !== null && 'steps' in again ? again.steps : undefined).toBeUndefined();
    expect(asked()).toHaveLength(2);
    expect(log().filter((each) => each.kind === 'run' && each.steps !== undefined)).toHaveLength(1);
  });
});

describe('a step that fails', () => {
  it('stops the steps after it, leaves the corrections and links, and says which step and why', async () => {
    const { vault, arrive, asked, proposals, body } = await setUp([FELL_OVER]);

    const entry = await arrive();

    expect(outcomes(entry)).toEqual(['already', 'already', 'failed', 'skipped']);
    expect(entry).toMatchObject({ kind: 'failed', trigger: 'note' });
    expect(entry?.kind === 'failed' && entry.problem).toBe(
      'Step 3 of 4 stopped it. Ask Claude (meeting-extraction) for meeting-items failed: The model fell over. What the steps before it did stays.',
    );
    expect(said(entry)[3]).toBe(
      'Ask Claude (term-suggestions) for term-suggestions: not run, because an earlier step failed.',
    );
    // Extraction was asked once; the term step never was.
    expect(asked()).toHaveLength(1);
    // What the import did stays: the words corrected, the people linked, the person proposed.
    expect(body(ARRIVED)).toContain('Send me the Larkspur Pay file by Friday.');
    expect(vault.properties(ARRIVED)['people']).toEqual(['[[Mara Quill]]']);
    expect(proposals()).toEqual(['Inbox/Proposals/Ada Venn — Standup.md']);
  });

  it('is an error in Activity, with the steps before it and the one not run under it', async () => {
    const { arrive, activity } = await setUp([says({ nonsense: true })]);
    await arrive();

    const [line] = activity.reports.filter((report) => report.kind === 'automation');

    expect(line?.level).toBe('error');
    expect(line?.message).toContain('After a meeting · 2026-10-06 Standup: stopped at step 3 of 4.');
    expect(line?.message).toContain('Claude’s answer is not what the rule asks for.');
    expect(line?.details).toHaveLength(4);
    expect(line?.details?.[3]).toContain('not run, because an earlier step failed');
  });

  it('leaves the meeting unhandled, so a run by hand takes it again and finds the first steps done', async () => {
    const { arrive, runNow, asked, proposals } = await setUp([
      FELL_OVER,
      ITEMS,
      TERMS,
    ]);
    await arrive();

    const retried = await runNow();

    expect(outcomes(retried)).toEqual(['already', 'already', 'done', 'done']);
    expect(asked()).toHaveLength(3);
    expect(proposals()).toContain('Inbox/Proposals/Send Mara the file.md');
    expect(proposals()).toContain('Inbox/Proposals/Larkspur Pay.md');
  });

  it('keeps what the failed run asked on the hour’s count', async () => {
    const { arrive, log } = await setUp([FELL_OVER]);
    await arrive();

    const [failed] = log().filter((each) => each.kind === 'failed');

    expect(failed).toMatchObject({ kind: 'failed', claude: { asks: 1 } });
  });

  it('fails the term step alone when only its answer does not read, keeping what extraction made', async () => {
    const { arrive, proposals, log } = await setUp([ITEMS, says({ terms: 'none' })]);

    const entry = await arrive();

    expect(outcomes(entry)).toEqual(['already', 'already', 'done', 'failed']);
    expect(proposals()).toContain('Inbox/Proposals/Send Mara the file.md');
    const [failed] = log().filter((each) => each.kind === 'failed');
    expect(failed).toMatchObject({
      done: [{ kind: 'proposed', path: 'Inbox/Proposals/Send Mara the file.md' }],
      claude: { asks: 2 },
    });
  });
});

describe('a meeting that reached the vault another way', () => {
  it('is corrected and linked by the rule’s own steps, each recorded on the meeting', async () => {
    const { vault, byHand, runNow, body, proposals } = await setUp();
    await byHand();

    const entry = await runNow();

    expect(outcomes(entry)).toEqual(['done', 'done', 'done', 'done']);
    expect(said(entry).slice(0, 2)).toEqual([
      'Corrected 2 misheard spellings.',
      'Linked Mara Quill; proposed 1 in the Inbox.',
    ]);
    expect(body(BY_HAND)).toContain('Send me the Larkspur Pay file by Friday.');
    expect(vault.properties(BY_HAND)).toMatchObject({
      people: ['[[Mara Quill]]'],
      atlas_links: [{ key: 'people', added: ['[[Mara Quill]]'] }],
      atlas_link_proposals: ['Inbox/Proposals/Ada Venn — Planning.md'],
    });
    expect(vault.properties(BY_HAND)['atlas_corrections']).toHaveLength(1);
    expect(proposals()).toHaveLength(3);
    expect(entry).toMatchObject({
      done: [
        { kind: 'corrected', path: BY_HAND, count: 2 },
        { kind: 'linked', path: BY_HAND, count: 2 },
        { kind: 'proposed', path: 'Inbox/Proposals/Ada Venn — Planning.md' },
        { kind: 'proposed' },
        { kind: 'proposed' },
      ],
    });
  });

  it('asks Claude about the meeting as its own steps left it', async () => {
    const { byHand, runNow, asked } = await setUp();
    await byHand();
    await runNow();

    const [extraction] = asked().map((request) => request.system);

    expect(extraction).toContain('Send me the Larkspur Pay file by Friday. ^t0001');
    expect(extraction).toContain('"people":["[[Mara Quill]]"]');
  });

  it('is handled as its steps left it: a second run does nothing and asks nothing', async () => {
    const { byHand, runNow, asked, body } = await setUp();
    await byHand();
    await runNow();
    const after = body(BY_HAND);

    const again = await runNow();

    expect(again).toMatchObject({ kind: 'run', done: [] });
    expect(asked()).toHaveLength(2);
    expect(body(BY_HAND)).toBe(after);
  });

  it('keeps the corrections and the links when extraction then fails', async () => {
    const { vault, byHand, runNow, body, log } = await setUp([FELL_OVER]);
    await byHand();

    const entry = await runNow();

    expect(outcomes(entry)).toEqual(['done', 'done', 'failed', 'skipped']);
    expect(body(BY_HAND)).toContain('Send me the Larkspur Pay file by Friday.');
    expect(vault.properties(BY_HAND)['people']).toEqual(['[[Mara Quill]]']);
    const [failed] = log().filter((each) => each.kind === 'failed');
    expect(failed).toMatchObject({
      done: [
        { kind: 'corrected', path: BY_HAND, count: 2 },
        { kind: 'linked', path: BY_HAND, count: 2 },
        { kind: 'proposed' },
      ],
    });
  });

  it('fails its first step on a meeting being typed in, runs no other, and writes nothing', async () => {
    const { vault, byHand, runNow, asked } = await setUp();
    await byHand();
    const before = vault.files.get(BY_HAND);
    vault.unsaved.add(BY_HAND);

    const entry = await runNow();

    expect(outcomes(entry)).toEqual(['failed', 'skipped', 'skipped', 'skipped']);
    expect(vault.files.get(BY_HAND)).toBe(before);
    expect(asked()).toHaveLength(0);
  });

  it('fails the link step when the meeting cannot take its record, rather than run on unlinked', async () => {
    const clean = BODY.replaceAll('Lark Spur Pay', 'Larkspur Pay');
    const { vault, byHand, runNow, asked } = await setUp();
    await byHand(BY_HAND, clean);
    vault.unsaved.add(BY_HAND);

    const entry = await runNow();

    // Nothing to correct, so the first step read it and passed; linking could not write it.
    expect(outcomes(entry)).toEqual(['nothing', 'failed', 'skipped', 'skipped']);
    expect(said(entry)[1]).toContain('could not be linked');
    expect(said(entry)[1]).toContain('unsaved typing');
    expect(vault.properties(BY_HAND)['atlas_links']).toBeUndefined();
    expect(asked()).toHaveLength(0);
  });
});

describe('undoing the rule’s last run', () => {
  it('puts the meeting’s words back, takes its links and link proposals away, and names the proposals it leaves', async () => {
    const { vault, run, byHand, runNow, body, proposals } = await setUp();
    await byHand();
    await runNow();

    const undone = await undoLastRun(run);

    expect(body(BY_HAND)).toBe(BODY);
    expect(vault.properties(BY_HAND)).toMatchObject({
      atlas_corrections: 'undone',
      atlas_links: 'undone',
    });
    expect(vault.properties(BY_HAND)['people']).toBeUndefined();
    expect(undone).toMatchObject({
      kind: 'undo',
      done: [
        { kind: 'uncorrected', path: BY_HAND, count: 2 },
        { kind: 'unlinked', path: BY_HAND, count: 2 },
      ],
    });
    // The link proposal went with the links; what Claude proposed is the person's to answer.
    expect(proposals()).toEqual([
      'Inbox/Proposals/Larkspur Pay.md',
      'Inbox/Proposals/Send Mara the file.md',
    ]);
    expect(undone?.kind === 'undo' && undone.left).toEqual([
      {
        path: 'Inbox/Proposals/Send Mara the file.md',
        reason:
          'What a Claude step made is answered in the Inbox, or kept or deleted by you; undo leaves it.',
      },
      {
        path: 'Inbox/Proposals/Larkspur Pay.md',
        reason:
          'What a Claude step made is answered in the Inbox, or kept or deleted by you; undo leaves it.',
      },
    ]);
  });

  it('undoes a run that failed part-way: what its first steps did is as undoable', async () => {
    const { vault, run, byHand, runNow, body } = await setUp([FELL_OVER]);
    await byHand();
    await runNow();

    const undone = await undoLastRun(run);

    expect(undone).toMatchObject({ kind: 'undo', done: [{ kind: 'uncorrected' }, { kind: 'unlinked' }] });
    expect(body(BY_HAND)).toBe(BODY);
    expect(vault.properties(BY_HAND)['people']).toBeUndefined();
  });

  it('has nothing to undo for a meeting the import corrected and linked: that run changed nothing', async () => {
    const { run, arrive, body } = await setUp();
    await arrive();
    const before = body(ARRIVED);

    expect(await undoLastRun(run)).toBeNull();
    expect(body(ARRIVED)).toBe(before);
  });

  it('undoes once: a second undo finds nothing', async () => {
    const { run, byHand, runNow } = await setUp();
    await byHand();
    await runNow();
    await undoLastRun(run);

    expect(await undoLastRun(run)).toBeNull();
  });

  it('leaves the words, saying why, when they were edited since, and still takes the links back', async () => {
    const { vault, run, byHand, runNow } = await setUp();
    await byHand();
    await runNow();
    const edited = vault.files.get(BY_HAND)!.replace('I will.', 'I will, today.');
    await vault.ports.fs.writeTextFile({
      path: createVaultPath(BY_HAND),
      contents: edited,
      expectedModified: null,
    });

    const undone = await undoLastRun(run);

    expect(vault.files.get(BY_HAND)).toContain('I will, today.');
    expect(vault.files.get(BY_HAND)).toContain('Send me the Larkspur Pay file');
    expect(vault.properties(BY_HAND)['people']).toBeUndefined();
    expect(undone).toMatchObject({ done: [{ kind: 'unlinked', path: BY_HAND }] });
    expect(undone?.kind === 'undo' && undone.left).toContainEqual({
      path: BY_HAND,
      reason: 'The meeting changed since its words were corrected, so they were left as they are.',
    });
  });
});

describe('what a run of the rule may ask', () => {
  const plain = (title: string) =>
    [
      '',
      '## Transcript',
      '',
      `**Mara Quill** [~00:00:00] ${title} is on for Friday. ^t0001`,
      '',
    ].join('\n');

  it('shares one run’s asks between its meetings, and stops before a meeting it cannot finish', async () => {
    const rounds = Array.from({ length: CLAUDE_ASKS_PER_RUN }, (_, at) =>
      at % 2 === 0 ? NO_ITEMS : NO_TERMS,
    );
    const { byHand, runNow, asked, log, activity } = await setUp(rounds);
    for (let at = 1; at <= 6; at += 1) await byHand(`Meetings/Planning ${at}.md`, plain(`Topic ${at}`));

    const last = await runNow();

    // Two asks a meeting, ten a run: five meetings, and the sixth is not started.
    expect(asked()).toHaveLength(CLAUDE_ASKS_PER_RUN);
    const entries = log().filter((each) => each.kind === 'run' && each.steps !== undefined);
    expect(entries.map((each) => each.kind === 'run' && each.steps?.note)).toEqual([
      'Meetings/Planning 1.md',
      'Meetings/Planning 2.md',
      'Meetings/Planning 3.md',
      'Meetings/Planning 4.md',
      'Meetings/Planning 5.md',
    ]);
    expect(entries.map((each) => each.kind === 'run' && each.capped)).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(last).toMatchObject({ kind: 'run', capped: true });
    // One Activity line a meeting, the last of them the one the caller reports.
    expect(activity.reports.filter((report) => report.kind === 'automation')).toHaveLength(5);
  });

  it('takes the meeting it stopped before on the next run by hand', async () => {
    const rounds = Array.from({ length: CLAUDE_ASKS_PER_RUN + 2 }, (_, at) =>
      at % 2 === 0 ? NO_ITEMS : NO_TERMS,
    );
    const { byHand, runNow, asked } = await setUp(rounds);
    for (let at = 1; at <= 6; at += 1) await byHand(`Meetings/Planning ${at}.md`, plain(`Topic ${at}`));
    await runNow();

    const next = await runNow();

    expect(next !== null && 'steps' in next && next.steps?.note).toBe('Meetings/Planning 6.md');
    expect(asked()).toHaveLength(CLAUDE_ASKS_PER_RUN + 2);
  });

  it('counts every ask of both steps toward the hour’s cap', async () => {
    const rounds = Array.from({ length: 20 }, (_, at) => (at % 2 === 0 ? NO_ITEMS : NO_TERMS));
    const { byHand, runNow, log } = await setUp(rounds);
    for (let at = 1; at <= 10; at += 1) await byHand(`Meetings/Planning ${at}.md`, plain(`Topic ${at}`));
    await runNow();
    expect(noteRunsHeldUntil(log(), `${TODAY}T09:30:00`)).toBeNull();

    await runNow();

    // Twenty asks in the hour: the rule is held until the first of them is an hour old.
    expect(noteRunsHeldUntil(log(), `${TODAY}T09:30:00`)).not.toBeNull();
  });

  it('leaves the term step an ask of a long meeting, and reads at most two parts of it', async () => {
    const turn = (at: number) =>
      `**Mara Quill** [~00:00:00] ${'word '.repeat(700)}turn ${at}. ^t${String(at).padStart(4, '0')}`;
    const turns = Array.from({ length: 80 }, (_, at) => turn(at + 1));
    const long = ['', '## Transcript', '', turns.join('\n\n'), ''].join('\n');
    expect(long.length).toBeGreaterThan(CLAUDE_NOTE_CHARACTERS * CLAUDE_ASKS_PER_RUN);
    const rounds = Array.from({ length: CLAUDE_ASKS_PER_RUN }, (_, at) =>
      at < CLAUDE_ASKS_PER_RUN - 1 ? NO_ITEMS : NO_TERMS,
    );
    const { byHand, runNow, asked } = await setUp(rounds);
    await byHand(BY_HAND, long);

    const entry = await runNow();

    // Extraction may not take the run's last ask: the term step after it is owed one.
    expect(said(entry)[2]).toMatch(/^Asked Claude 9 times: /);
    expect(said(entry)[3]).toMatch(/^Asked Claude 1 time: suggested no terms \(read in part\)\.$/);
    expect(asked()).toHaveLength(CLAUDE_ASKS_PER_RUN);
  });

  it('reads two parts of a long meeting for terms when the run has the asks', async () => {
    const turn = (at: number) =>
      `**Mara Quill** [~00:00:00] ${'word '.repeat(700)}turn ${at}. ^t${String(at).padStart(4, '0')}`;
    const turns = Array.from({ length: 20 }, (_, at) => turn(at + 1));
    const long = ['', '## Transcript', '', turns.join('\n\n'), ''].join('\n');
    const { byHand, runNow } = await setUp([
      NO_ITEMS,
      NO_ITEMS,
      NO_ITEMS,
      NO_ITEMS,
      NO_TERMS,
      NO_TERMS,
    ]);
    await byHand(BY_HAND, long);

    const entry = await runNow();

    expect(said(entry)[2]).toMatch(/^Asked Claude 4 times: /);
    expect(said(entry)[3]).toMatch(/^Asked Claude 2 times: suggested no terms \(read in part\)\.$/);
  });
});

describe('accepting a suggested term', () => {
  const SUGGESTED = createVaultPath('Inbox/Proposals/Larkspur Pay.md');
  const SECOND = 'Inbox/Meetings/2026-10-08 Review.md';
  const SECOND_BODY = [
    '',
    '## Transcript',
    '',
    '**Mara Quill** [~00:00:00] Is Larkspar Pay signed off? ^t0001',
    '',
  ].join('\n');
  const second = { title: 'Review', date: '2026-10-08', external_id: 'gemini-second' };

  it('adds the heard spelling to the term the vault has, and rewrites no meeting', async () => {
    const { vault, arrive, body } = await setUp();
    await arrive();
    const meeting = vault.files.get(ARRIVED);

    await acceptProposalNote({ ports: vault.ports, path: SUGGESTED, today: TODAY });

    expect(vault.properties('Terms/Larkspur Pay.md')['variants']).toEqual([
      'Lark Spur Pay',
      'Larkspar Pay',
    ]);
    expect(vault.files.get(ARRIVED)).toBe(meeting);
    expect(body(ARRIVED)).toContain('Larkspar Pay needs its review booked too.');
    expect([...vault.files.keys()].filter((at) => at.startsWith('Terms/'))).toEqual([
      'Terms/Larkspur Pay.md',
    ]);
  });

  it('corrects the next meeting that arrives with that mishearing', async () => {
    const { vault, arrive, body } = await setUp([ITEMS, TERMS, NO_ITEMS, NO_TERMS]);
    await arrive();
    await acceptProposalNote({ ports: vault.ports, path: SUGGESTED, today: TODAY });

    const entry = await arrive(SECOND, SECOND_BODY, second);

    expect(body(SECOND)).toContain('Is Larkspur Pay signed off?');
    expect(said(entry)[0]).toBe(
      'Already corrected when it arrived (1 misheard spelling); not corrected again.',
    );
  });

  it('leaves the next meeting as it was heard while the suggestion is only waiting, and suggests it once', async () => {
    const sameAgain = says({
      terms: [
        {
          heard: 'Larkspar Pay',
          canonical: 'Larkspur Pay',
          kind: 'product',
          source_block: 't0001',
          confidence: 'high',
        },
      ],
    });
    const { arrive, body, proposals } = await setUp([ITEMS, TERMS, NO_ITEMS, sameAgain]);
    await arrive();
    const waiting = proposals();

    const entry = await arrive(SECOND, SECOND_BODY, second);

    // Nothing is rewritten without an accepted proposal; the same suggestion is not made twice.
    expect(body(SECOND)).toContain('Is Larkspar Pay signed off?');
    expect(proposals()).toEqual(waiting);
    expect(said(entry)[3]).toBe('Asked Claude 1 time: nothing new (1 already made).');
  });

  it('corrects the first meeting only when the person asks: Correct again, undone by Undo corrections', async () => {
    const { vault, arrive, body } = await setUp();
    await arrive();
    await acceptProposalNote({ ports: vault.ports, path: SUGGESTED, today: TODAY });
    expect(body(ARRIVED)).toContain('Larkspar Pay needs');

    const again = await recorrectMeetingTerms({ ports: vault.ports, path: createVaultPath(ARRIVED) });

    expect(again).toEqual({ count: 3 });
    expect(body(ARRIVED)).toContain('Larkspur Pay needs its review booked too.');
    await undoMeetingTermCorrections({ ports: vault.ports, path: createVaultPath(ARRIVED) });
    expect(body(ARRIVED)).toBe(BODY);
  });

  it('makes the term when the vault has none of that name', async () => {
    const made = says({
      terms: [
        {
          heard: 'Mara Quil',
          canonical: 'Mara Quill',
          kind: 'person',
          source_block: 't0001',
          confidence: 'high',
        },
      ],
    });
    const heard = BODY.replace('**Mara Quill** [~00:00:00]', '**Mara Quil** [~00:00:00]');
    const { vault, arrive } = await setUp([NO_ITEMS, made]);
    await arrive(ARRIVED, heard);

    await acceptProposalNote({
      ports: vault.ports,
      path: createVaultPath('Inbox/Proposals/Mara Quill.md'),
      today: TODAY,
    });

    expect(vault.properties('Terms/Mara Quill.md')).toEqual({
      type: 'term',
      kind: 'person',
      variants: ['Mara Quil'],
    });
    // The person's own note is left as it is: a term corrects, a person links.
    expect(vault.properties('People/Mara Quill.md')).toEqual({
      type: 'person',
      email: 'mara.quill@example.com',
    });
  });

  it('refuses a spelling that has since become someone’s name, writing nothing', async () => {
    const { vault, arrive } = await setUp();
    await arrive();
    await vault.ports.fs.createNote({
      path: createVaultPath('Companies/Larkspar Pay.md'),
      contents: jsonNote({ type: 'company' }, ''),
    });
    const term = vault.files.get('Terms/Larkspur Pay.md');

    await expect(
      acceptProposalNote({ ports: vault.ports, path: SUGGESTED, today: TODAY }),
    ).rejects.toThrow('“Larkspar Pay” is the right spelling of something else. Nothing was written.');

    expect(vault.files.get('Terms/Larkspur Pay.md')).toBe(term);
    expect(vault.files.has(SUGGESTED)).toBe(true);
  });

  it('refuses a proposal whose spelling the term already lists', async () => {
    const { vault, arrive } = await setUp();
    await arrive();
    await vault.ports.fs.writeTextFile({
      path: createVaultPath('Terms/Larkspur Pay.md'),
      contents: jsonNote(
        { type: 'term', kind: 'product', variants: ['Lark Spur Pay', 'Larkspar Pay'] },
        '',
      ),
      expectedModified: null,
    });

    await expect(
      acceptProposalNote({ ports: vault.ports, path: SUGGESTED, today: TODAY }),
    ).rejects.toThrow(/it lists every misheard spelling this proposes/);
  });
});

describe('a run cut off', () => {
  it('logs what it did for the meeting it was on, then stops, when another vault opens', async () => {
    const { vault, run, byHand, log, asked } = await setUp();
    await byHand('Meetings/Planning 1.md');
    await byHand('Meetings/Planning 2.md');
    let open = VAULT;
    const guard: VaultGuard = { vault: VAULT, currentVault: () => open };
    // The first meeting's corrections land; then the person opens another vault.
    const write = vault.ports.fs.writeTextFile;
    vault.ports.fs.writeTextFile = async (args) => {
      const modified = await write(args);
      if (args.path === 'Meetings/Planning 1.md') open = '/vaults/other';
      return modified;
    };

    await expect(runAutomation({ ...run, guard, trigger: 'hand' })).rejects.toThrow(
      VaultChangedError,
    );

    const entries = log().filter((each) => each.kind === 'failed');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      done: [{ kind: 'corrected', path: 'Meetings/Planning 1.md', count: 2 }],
      steps: { note: 'Meetings/Planning 1.md' },
    });
    expect(asked()).toHaveLength(0);
    expect(vault.files.get('Meetings/Planning 2.md')).toContain('Lark Spur Pay file');
  });
});

describe('a fault that is not the model’s answer', () => {
  it('is on record as the step’s failure, with what was asked, and is then raised', async () => {
    const { arrive, log, asked } = await setUp([new Error('the socket closed')]);

    await expect(arrive()).rejects.toThrow('the socket closed');

    const [failed] = log().filter((each) => each.kind === 'failed');
    expect(failed).toMatchObject({ kind: 'failed', claude: { asks: 1 } });
    expect(outcomes(failed ?? null)).toEqual(['already', 'already', 'failed', 'skipped']);
    expect(asked()).toHaveLength(1);
  });
});

describe('a rule of deterministic steps alone', () => {
  const TIDY: AutomationRule = {
    ...RULE,
    id: 'Tidy a meeting',
    name: 'Tidy a meeting',
    path: createVaultPath('.atlas/automations/Tidy a meeting.md'),
    action: { kind: 'steps', steps: [{ kind: 'correct-terms' }, { kind: 'link-meeting' }] },
  };

  it('corrects and links without asking Claude at all', async () => {
    const { vault, run, byHand, asked } = await setUp();
    await byHand();

    const entry = await runAutomation({ ...run, rule: TIDY, trigger: 'hand' });

    expect(outcomes(entry)).toEqual(['done', 'done']);
    expect(entry !== null && 'claude' in entry ? entry.claude : undefined).toBeUndefined();
    expect(asked()).toHaveLength(0);
    expect(vault.properties(BY_HAND)['people']).toEqual(['[[Mara Quill]]']);
  });
});
