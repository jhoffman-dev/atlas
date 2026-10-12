/**
 * Adversarial pass over the stacked post-processing (#92, P28-06, P29-04,
 * P29-03): what a rule's Claude step does about a meeting it has already
 * answered, once the meeting is filed or renamed, or the model words its
 * citation another way. Over the fake vault whose index answers with real SQL
 * and a scripted model, as `claude-step.meetings.test.ts` is.
 *
 * Every test here fails on p29-03: each names the invariant it breaks.
 */
import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  logPathFor,
  newLogText,
  NOTE_RUNS_PER_HOUR,
  noteChangesBetween,
  parseRunLog,
  parseObjectType,
  versionsAfter,
  type AutomationRule,
  type LogEntry,
  type NoteChange,
  type NoteVersion,
} from '@atlas/domain';
import type { ModelEvent } from '../chat/ports.ts';
import { heldEntries } from '../index/refresh-index.ts';
import { createMeetingLinker, linkBeforeLetIn } from '../meeting-links/link-imported-meetings.ts';
import { createMeetingImporter } from '../meetings/meeting-importer.ts';
import { automationVault, jsonNote, TASK_TYPES } from '../testing/automation-vault.ts';
import { recordingActivity } from '../testing/fake-activity.ts';
import { fakeClaudeStepPorts } from '../testing/fake-claude-step.ts';
import type { ScriptedRound } from '../testing/fake-model.ts';
import { MEETING_HEADER } from '../testing/meeting-files.ts';
import { correctMeetingTerms } from '../meetings/meeting-corrections.ts';
import { NoteRunsCappedError } from './note-runs.ts';
import { runAutomation, runOnMissedArrivals, runOnNoteChanges } from './run-automation.ts';
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

const RULE_FILE = '.atlas/automations/Meeting actions.md';
const DIRECTORY = {
  'People/Mara Quill.md': jsonNote({ type: 'person' }, ''),
  [PROMPT]: 'Find every action item and propose it as a task.\n',
  // The rule's own file: when it was last saved is what "since" means to its catch-up.
  [RULE_FILE]: 'The rule, as its file holds it.\n',
};

const BODY = [
  '',
  '## Summary',
  '',
  'Go-live moves a week. ^s1',
  '',
  '## Transcript',
  '',
  '**Mara Quill** [~00:00:00] Send me the payroll file by Friday. ^t0001',
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

/** The one action item of the meeting, cited as the model chose to write the link. */
const sendTheFile = (source: string): ModelEvent[] => [
  {
    type: 'text',
    text: JSON.stringify({
      proposals: [
        {
          kind: 'task',
          title: 'Send Mara the file',
          source,
          confidence: 'high',
          why: 'Mara asked for it.',
        },
      ],
    }),
  },
];
const BY_TITLE = sendTheFile('[[2026-10-06 Standup#^t0001]]');

async function setUp(
  rounds: readonly ScriptedRound[],
  {
    notes = {},
    ageDays = {},
  }: { notes?: Record<string, string>; ageDays?: Record<string, number> } = {},
) {
  const claude = fakeClaudeStepPorts({ rounds, model: 'claude-opus-5-5', today: TODAY });
  const vault = automationVault({
    notes: { ...DIRECTORY, ...notes },
    today: TODAY,
    ageDays,
    types: TYPES,
    claude,
  });
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
    beforeLetIn: linkBeforeLetIn(linker),
  });

  // The feed, as `syncIndex` keeps it: measured from what was held, which each sync's changes move on.
  let held = new Map<string, NoteVersion>(await heldEntries(vault.ports.index));
  const sync = async (): Promise<NoteChange[]> => {
    const changes = noteChangesBetween(held, await heldEntries(vault.ports.index));
    held = versionsAfter(held, changes);
    return changes;
  };
  const feeds: NoteChange[][] = [];
  const write = vault.ports.fs.writeTextFile;
  vault.ports.fs.writeTextFile = async (args) => {
    const modified = await write(args);
    if (args.path.startsWith('Inbox/Meetings/')) feeds.push(await sync());
    return modified;
  };

  /** The meeting lands and the import lets it in; what the feed said of it waits in `feeds`. */
  const arrive = async () => {
    const contents = jsonNote({ ...MEETING_HEADER }, BODY);
    await vault.ports.fs.createNote({ path: createVaultPath(MEETING), contents });
    const landed = await sync();
    feeds.push(landed);
    await importer.hear({ vault: VAULT, changes: landed });
  };
  /** The meeting lands, the import lets it in, and the rule hears every feed of it: asked once. */
  const arriveAndAsk = async () => {
    await arrive();
    await hearFeeds();
  };
  /** Atlas is quit and opened again: what was heard and not yet run on is gone, and the feed starts from the index. */
  const relaunch = async () => {
    feeds.splice(0);
    held = new Map<string, NoteVersion>(await heldEntries(vault.ports.index));
    await hearFeeds();
  };
  const catchUp = (rule: AutomationRule = ON_CREATED) =>
    runOnMissedArrivals({ ports: vault.ports, rule, clock: CLOCK, guard: GUARD, activity });
  const logged = () => parseRunLog(vault.files.get(logPathFor(ON_CREATED.id)) ?? '');
  /** Hands the rule every feed heard so far, then the feed its own writes and the test's moves made. */
  const hearFeeds = async () => {
    feeds.push(await sync());
    for (const changes of feeds.splice(0)) {
      await runOnNoteChanges({
        ports: vault.ports,
        rule: ON_CREATED,
        clock: CLOCK,
        guard: GUARD,
        activity,
        changes,
      });
    }
  };
  /** The meeting is moved, as filing it from the Inbox moves it, and the rule hears of the move. */
  const moveTo = async (to: string) => {
    await vault.ports.fs.createFolder({ path: createVaultPath('Meetings') });
    await vault.ports.fs.moveEntry({ from: createVaultPath(MEETING), to: createVaultPath(to) });
    await hearFeeds();
  };
  const runByHand = () =>
    runAutomation({
      ports: vault.ports,
      rule: ON_CREATED,
      clock: CLOCK,
      guard: GUARD,
      activity,
      trigger: 'hand',
    });
  const proposals = () =>
    [...vault.files.keys()].filter((at) => at.startsWith('Inbox/Proposals/')).sort();
  const asked = () => claude.fake.requests;
  return {
    vault,
    arrive,
    arriveAndAsk,
    relaunch,
    catchUp,
    logged,
    moveTo,
    runByHand,
    proposals,
    asked,
  };
}

describe('a Claude step and a meeting it has already answered', () => {
  it('is not asked again about the same words once the meeting is filed out of the Inbox', async () => {
    const { vault, arriveAndAsk, moveTo, runByHand, asked } = await setUp([BY_TITLE, BY_TITLE]);
    await arriveAndAsk();
    expect(asked()).toHaveLength(1);
    const answered = vault.files.get(MEETING);

    // Filing moves the file and changes no byte of it.
    await moveTo('Meetings/2026-10-06 Standup.md');
    expect(vault.files.get('Meetings/2026-10-06 Standup.md')).toBe(answered);
    await runByHand();

    // ADR-0028: "a model is not asked twice for the same words".
    expect(asked()).toHaveLength(1);
  });

  it('proposes nothing twice when the meeting was renamed as it was filed, and the rule is run by hand', async () => {
    const renamed = sendTheFile('[[Standup with Mara#^t0001]]');
    const { arriveAndAsk, moveTo, runByHand, proposals } = await setUp([BY_TITLE, renamed]);
    await arriveAndAsk();
    expect(proposals()).toEqual(['Inbox/Proposals/Send Mara the file.md']);

    await moveTo('Meetings/Standup with Mara.md');
    await runByHand();

    // The same task from the same turn of the same meeting: one proposal, whatever the file is called now.
    expect(proposals()).toEqual(['Inbox/Proposals/Send Mara the file.md']);
  });

  it('proposes nothing twice when its log is lost and the model cites the same block by the note’s path', async () => {
    const byPath = sendTheFile('[[Inbox/Meetings/2026-10-06 Standup#^t0001]]');
    const { vault, arriveAndAsk, runByHand, proposals, asked } = await setUp([BY_TITLE, byPath]);
    await arriveAndAsk();
    expect(proposals()).toEqual(['Inbox/Proposals/Send Mara the file.md']);
    vault.files.delete(logPathFor(ON_CREATED.id));

    await runByHand();

    // Asked again, since nothing says it was; both links name one block, so it is one proposal.
    expect(asked()).toHaveLength(2);
    expect(proposals()).toEqual(['Inbox/Proposals/Send Mara the file.md']);
  });
});

describe('a meeting let in just before Atlas was quit, its rule not yet run', () => {
  it('is caught up with when Atlas opens: the rule asks once about it, and not again the time after', async () => {
    const { arrive, relaunch, catchUp, proposals, asked } = await setUp([BY_TITLE, BY_TITLE]);
    await arrive();
    // Quit between the stamp and the run: on opening, the feed has nothing to say of a meeting already in.
    await relaunch();
    expect(asked()).toHaveLength(0);

    const entry = await catchUp();

    expect(asked()).toHaveLength(1);
    expect(entry).toMatchObject({ kind: 'run', trigger: 'note' });
    expect(proposals()).toEqual(['Inbox/Proposals/Send Mara the file.md']);

    await relaunch();
    expect(await catchUp()).toBeNull();
    expect(asked()).toHaveLength(1);
  });

  it('leaves a meeting the rule already ran on, and one let in before the rule was last saved', async () => {
    const before = 'Inbox/Meetings/2026-10-01 Before the rule.md';
    const header = {
      ...MEETING_HEADER,
      external_id: 'gemini-before',
      atlas_import_outcome: 'imported',
    };
    const { arriveAndAsk, relaunch, catchUp, asked } = await setUp([BY_TITLE, BY_TITLE], {
      notes: { [before]: jsonNote(header, BODY) },
      ageDays: { [before]: 3 },
    });
    await arriveAndAsk();
    expect(asked()).toHaveLength(1);

    await relaunch();

    expect(await catchUp()).toBeNull();
    expect(asked()).toHaveLength(1);
  });

  it('is held by the hour’s cap as news is: nothing is asked, and the caller is told until when', async () => {
    const { vault, arrive, relaunch, catchUp, asked } = await setUp([BY_TITLE]);
    await arrive();
    await relaunch();
    // As many runs that asked Claude this hour as a rule may have.
    const asking = Array.from({ length: NOTE_RUNS_PER_HOUR }, (_, at): LogEntry => ({
      kind: 'run',
      at: `${TODAY}T08:${String(10 + at).padStart(2, '0')}:00`,
      trigger: 'note',
      done: [],
      left: [],
      capped: false,
      claude: { model: 'claude-opus-5-5', ms: 10, asks: 1 },
    }));
    vault.files.set(logPathFor(ON_CREATED.id), newLogText(ON_CREATED.name, asking));

    await expect(catchUp()).rejects.toBeInstanceOf(NoteRunsCappedError);
    expect(asked()).toHaveLength(0);
  });

  it('is nothing to a rule that is off, or that runs only when a meeting is changed', async () => {
    const { arrive, relaunch, catchUp, asked } = await setUp([BY_TITLE]);
    await arrive();
    await relaunch();

    expect(await catchUp({ ...ON_CREATED, enabled: false })).toBeNull();
    const onChanged: AutomationRule = {
      ...ON_CREATED,
      when: { kind: 'note', type: 'meeting', on: ['changed'] },
    };
    expect(await catchUp(onChanged)).toBeNull();
    expect(asked()).toHaveLength(0);
  });
});

describe('a Claude step asked again, whose proposals were all made before', () => {
  it('logs that there was nothing new and how many were already made', async () => {
    const { vault, arriveAndAsk, runByHand, logged } = await setUp([BY_TITLE, BY_TITLE]);
    await arriveAndAsk();
    vault.files.delete(logPathFor(ON_CREATED.id));

    const entry = await runByHand();

    expect(entry).toMatchObject({ kind: 'run', done: [], claude: { alreadyMade: 1 } });
    expect(vault.files.get(logPathFor(ON_CREATED.id))).toContain(
      'Nothing new to propose (1 already made).',
    );
    expect(logged().at(-1)).toMatchObject({ claude: { alreadyMade: 1 } });
  });
});

describe('correcting the words of a meeting whose type is a list', () => {
  it('takes it for the meeting linking takes it for', async () => {
    const path = 'Meetings/2026-10-06 Standup.md';
    const { vault } = await setUp([], {
      notes: {
        'Terms/Larkspur Pay.md': jsonNote(
          { type: 'term', kind: 'product', variants: ['Lark Spur Pay'] },
          '',
        ),
        [path]: jsonNote(
          { ...MEETING_HEADER, type: ['Meeting'] },
          BODY.replace('Go-live', 'Lark Spur Pay go-live'),
        ),
      },
    });

    const corrected = await correctMeetingTerms({
      ports: vault.ports,
      path: createVaultPath(path),
    });

    expect(corrected.written).toBe(true);
    expect(vault.files.get(path)).toContain('Larkspur Pay go-live');
  });
});
