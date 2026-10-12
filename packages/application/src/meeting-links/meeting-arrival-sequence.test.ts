/**
 * One meeting through all three of the import's own steps (#92, P28-06,
 * P29-04), over a vault held in memory whose index answers with real SQL:
 * linked, then corrected and stamped `imported` in one write, with nothing
 * written after. The feed is measured after every write to the meeting — the
 * worst case, a sync between each — and handed to rules a note sets off, so
 * what a rule can ever hear of the arrival is what is asserted.
 */
import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  digestOf,
  logPathFor,
  noteChangesBetween,
  parseObjectType,
  parseRunLog,
  splitFrontmatter,
  versionsAfter,
  type AutomationRule,
  type NoteChange,
  type NoteVersion,
} from '@atlas/domain';
import { runOnNoteChanges } from '../automations/run-automation.ts';
import type { VaultGuard } from '../automations/vault-guard.ts';
import { heldEntries } from '../index/refresh-index.ts';
import { undoMeetingTermCorrections } from '../meetings/meeting-corrections.ts';
import { createMeetingImporter } from '../meetings/meeting-importer.ts';
import { automationVault, jsonNote, TASK_TYPES } from '../testing/automation-vault.ts';
import { recordingActivity } from '../testing/fake-activity.ts';
import { MEETING_HEADER } from '../testing/meeting-files.ts';
import { createMeetingLinker, linkBeforeLetIn } from './link-imported-meetings.ts';

const TODAY = '2026-10-08';
const CLOCK = { today: () => TODAY, localNow: () => `${TODAY}T09:00:00` };
const VAULT = '/vaults/home';
const GUARD: VaultGuard = { vault: VAULT, currentVault: () => VAULT };
const MEETING = 'Inbox/Meetings/2026-10-06 Standup.md';

const TYPES = [
  ...TASK_TYPES,
  parseObjectType({ name: 'meeting', label: 'Meeting', properties: { status: 'text' } }),
];

/**
 * Mara Quill is known by an alias only her Person note holds; Tobias Fenn
 * speaks under a misheard name only a Term puts right; Ines Abara is no one
 * the vault knows.
 */
const DIRECTORY = {
  'People/Mara Quill.md': jsonNote({ type: 'person', aliases: ['Mara Q'] }, ''),
  'People/Tobias Fenn.md': jsonNote({ type: 'person' }, ''),
  'Terms/Larkspur Pay.md': jsonNote(
    { type: 'term', kind: 'product', variants: ['Lark Spur Pay'] },
    '',
  ),
  'Terms/Tobias Fenn.md': jsonNote({ type: 'term', kind: 'person', variants: ['Tobias Fen'] }, ''),
};

const ARRIVING_BODY = [
  '',
  '## Summary',
  '',
  'Mara Q says Lark Spur Pay go-live moves a week. ^s1',
  '',
  '## Transcript',
  '',
  '**Tobias Fen** [~00:00:00] Morning. Lark Spur Pay is late. ^t0001',
  '',
].join('\n');

const CORRECTED_BODY = ARRIVING_BODY.replaceAll('Lark Spur Pay', 'Larkspur Pay').replace(
  'Tobias Fen**',
  'Tobias Fenn**',
);

const ARRIVING = jsonNote(
  {
    ...MEETING_HEADER,
    attendees: [{ name: 'Mara Q' }, { name: 'Ines Abara', email: 'ines.abara@example.net' }],
  },
  ARRIVING_BODY,
);

/** Marks each meeting as it arrives. */
const ON_CREATED: AutomationRule = {
  id: 'Mark',
  path: createVaultPath('.atlas/automations/Mark.md'),
  name: 'Mark new meetings',
  enabled: true,
  when: { kind: 'note', type: 'meeting', on: ['created'] },
  which: 'FROM meeting',
  olderThanDays: null,
  action: { kind: 'set', values: { status: 'new' } },
};

/** Would mark a meeting each time it is edited. */
const ON_CHANGED: AutomationRule = {
  ...ON_CREATED,
  id: 'Edited',
  path: createVaultPath('.atlas/automations/Edited.md'),
  name: 'Mark edited meetings',
  when: { kind: 'note', type: 'meeting', on: ['changed'] },
  action: { kind: 'set', values: { status: 'edited' } },
};

async function setUp() {
  const vault = automationVault({ notes: { ...DIRECTORY }, today: TODAY, types: TYPES });
  const activity = recordingActivity();
  const linker = createMeetingLinker({
    ports: () => vault.ports,
    clock: CLOCK,
    activity,
    openVault: () => VAULT,
    selfName: () => null,
    onWritten: () => undefined,
  });
  const importer = createMeetingImporter({
    ports: () => vault.ports,
    clock: CLOCK,
    activity,
    openVault: () => VAULT,
    active: () => true,
    onWritten: () => undefined,
    beforeLetIn: linkBeforeLetIn(linker),
  });

  // The feed, as `syncIndex` keeps it: measured from what was held, which each sync's changes move on.
  let held = new Map<string, NoteVersion>(await heldEntries(vault.ports.index));
  const sync = async (): Promise<NoteChange[]> => {
    const changes = noteChangesBetween(held, await heldEntries(vault.ports.index));
    held = versionsAfter(held, changes);
    return changes;
  };

  /** Each text written to the meeting, and what a sync right after it reported. */
  const writes: { text: string; changes: NoteChange[] }[] = [];
  const write = vault.ports.fs.writeTextFile;
  vault.ports.fs.writeTextFile = async (args) => {
    const modified = await write(args);
    if (args.path === MEETING) writes.push({ text: args.contents, changes: await sync() });
    return modified;
  };

  await vault.ports.fs.createNote({ path: createVaultPath(MEETING), contents: ARRIVING });
  const landed = await sync();
  await importer.hear({ vault: VAULT, changes: landed });

  const run = (rule: AutomationRule, changes: readonly NoteChange[]) =>
    runOnNoteChanges({ ports: vault.ports, rule, clock: CLOCK, guard: GUARD, activity, changes });
  const body = () => splitFrontmatter(vault.files.get(MEETING) ?? '').body;
  const proposals = () => [...vault.files.keys()].filter((at) => at.startsWith('Inbox/Proposals/'));
  return { vault, activity, landed, writes, run, sync, body, proposals };
}

describe('a meeting arriving: linked, corrected and stamped as one sequence', () => {
  it('writes the links, then the corrections with the stamp, and nothing after', async () => {
    const { vault, writes, body, proposals } = await setUp();

    expect(writes).toHaveLength(2);
    const [linked, stamped] = writes.map(({ text }) =>
      vault.ports.markdown.frontmatterProperties(splitFrontmatter(text).frontmatter),
    );
    expect(linked).toMatchObject({ people: ['[[Mara Quill]]', '[[Tobias Fenn]]'] });
    expect(linked).not.toHaveProperty('atlas_import_outcome');
    expect(linked).not.toHaveProperty('atlas_corrections');
    expect(splitFrontmatter(writes[0]!.text).body).toBe(ARRIVING_BODY);
    expect(stamped).toMatchObject({
      atlas_import_outcome: 'imported',
      people: ['[[Mara Quill]]', '[[Tobias Fenn]]'],
      atlas_corrections: [
        { from: 'Lark Spur Pay', to: 'Larkspur Pay', count: 2 },
        { from: 'Tobias Fen', to: 'Tobias Fenn', count: 1 },
      ],
    });
    expect(vault.files.get(MEETING)).toBe(writes[1]!.text);
    expect(body()).toBe(CORRECTED_BODY);
    expect(proposals()).toHaveLength(1);
    expect(vault.properties(proposals()[0]!)).toMatchObject({ type: 'proposal' });
    expect(vault.files.get(proposals()[0]!)).toContain('ines.abara@example.net');
  });

  it('matches an attendee by a person’s alias, which the vocabulary no longer holds', async () => {
    const { vault, body } = await setUp();

    expect(vault.properties(MEETING)['people']).toContain('[[Mara Quill]]');
    // The alias links her and corrects nothing: the summary still says "Mara Q".
    expect(body()).toContain('Mara Q says');
  });

  it('links a speaker by the name their label is corrected to', async () => {
    const { vault, writes } = await setUp();

    // No one is called "Tobias Fen": the label was still misheard on disk when the links were written.
    expect(writes[0]!.text).toContain('**Tobias Fen** ');
    expect(vault.properties(MEETING)['people']).toContain('[[Tobias Fenn]]');
  });

  it('sets a `created` rule off once, on the version that is corrected and linked, and no `changed` rule', async () => {
    const { vault, landed, writes, run } = await setUp();
    const feed = [landed, ...writes.map(({ changes }) => changes)];
    const stampedDigest = digestOf(writes[1]!.text);

    const created = [];
    for (const changes of feed) created.push(await run(ON_CREATED, changes));
    const edited = [];
    for (const changes of feed) edited.push(await run(ON_CHANGED, changes));

    // Unstamped when it landed and when it was linked: not yet a note to a rule.
    expect(created.slice(0, 2)).toEqual([null, null]);
    expect(created[2]).toMatchObject({ kind: 'run', trigger: 'note' });
    expect(created[2]?.kind === 'run' && created[2].versions?.[0]).toEqual({
      path: MEETING,
      digest: stampedDigest,
      wrote: false,
    });
    expect(parseRunLog(vault.files.get(logPathFor(ON_CREATED.id)) ?? '')).toHaveLength(1);
    expect(edited).toEqual([null, null, null]);
    expect(vault.properties(MEETING)['status']).toBe('new');
  });

  it('undoes the corrections after linking wrote the frontmatter, and keeps the links', async () => {
    const { vault, body } = await setUp();

    await undoMeetingTermCorrections({ ports: vault.ports, path: createVaultPath(MEETING) });

    expect(body()).toBe(ARRIVING_BODY);
    expect(vault.properties(MEETING)).toMatchObject({
      atlas_import_outcome: 'imported',
      atlas_corrections: 'undone',
      people: ['[[Mara Quill]]', '[[Tobias Fenn]]'],
    });
  });

  it('says the links and the arrival in Activity, in the order they happened', async () => {
    const { activity } = await setUp();

    expect(activity.reports.map((report) => report.message)).toEqual([
      '2026-10-06 Standup: linked Mara Quill, Tobias Fenn; proposed 1 in the Inbox.',
      '2026-10-06 Standup: arrived in the Inbox. 3 misheard spellings corrected; Undo corrections on the meeting puts them back.',
    ]);
  });
});
