/**
 * Adversarial cases for rules a note sets off (P29-01): what the change feed
 * calls an arrival, what a version key forgets, and what the hourly cap
 * counts. Same in-memory vault and real-SQL index as run-on-note-changes.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  digestOf,
  NOTE_RUNS_PER_HOUR,
  noteChangesBetween,
  parseObjectType,
  type AutomationRule,
  type NoteChange,
  type NoteVersion,
  type VaultPath,
} from '@atlas/domain';
import { archiveNotes, unarchiveNotes } from '../archive/archive-notes.ts';
import { recordingActivity } from '../testing/fake-activity.ts';
import { automationVault, jsonNote, TASK_TYPES } from '../testing/automation-vault.ts';
import { runOnNoteChanges } from './run-automation.ts';
import type { VaultGuard } from './vault-guard.ts';

const TODAY = '2026-10-08';
const CLOCK = { today: () => TODAY, localNow: () => `${TODAY}T09:00:00` };
const VAULT = '/vaults/home';
const GUARD: VaultGuard = { vault: VAULT, currentVault: () => VAULT };
const STANDUP = 'Inbox/Meetings/2026-10-06 Standup.md';
const KICKOFF = 'Inbox/Meetings/2026-10-07 Kickoff.md';

const TYPES = [
  ...TASK_TYPES,
  parseObjectType({
    name: 'meeting',
    label: 'Meeting',
    properties: { status: 'text', kind: 'text' },
  }),
];

/** Marks each new meeting as new — and only new ones: it does not listen for changes. */
const MARK: AutomationRule = {
  id: 'Mark',
  path: createVaultPath('.atlas/automations/Mark.md'),
  name: 'Mark new meetings',
  enabled: true,
  when: { kind: 'note', type: 'meeting', on: ['created'] },
  which: 'FROM meeting',
  olderThanDays: null,
  action: { kind: 'set', values: { status: 'new' } },
};

const meeting = (frontmatter: Record<string, unknown>, body = 'Notes.\n') =>
  jsonNote({ type: 'meeting', ...frontmatter }, body);

function setUp(notes: Record<string, string>, dirty: string[] = []) {
  const vault = automationVault({ notes, today: TODAY, types: TYPES, dirty });
  const run = (rule: AutomationRule, changes: readonly NoteChange[]) =>
    runOnNoteChanges({
      ports: vault.ports,
      rule,
      clock: CLOCK,
      guard: GUARD,
      activity: recordingActivity(),
      changes,
    });
  /** The notes as the index would hold them now, outside `.atlas`. */
  const versions = (): Map<string, NoteVersion> =>
    new Map(
      [...vault.files]
        .filter(([path]) => !path.startsWith('.atlas/'))
        .map(([path, text]) => {
          const type = vault.properties(path)['type'];
          return [path, { type: typeof type === 'string' ? type : null, digest: digestOf(text) }];
        }),
    );
  const notePaths = () => [...vault.files.keys()].map((path) => createVaultPath(path));
  return { vault, run, versions, notePaths };
}

describe('runOnNoteChanges, attacked: what counts as a note arriving', () => {
  it('does not treat a meeting put back from the Archive as a new one, and keeps what was typed into it', async () => {
    const { vault, run, versions, notePaths } = setUp({
      [STANDUP]: meeting({ kind: 'standup' }),
    });
    await run(MARK, noteChangesBetween(new Map(), versions()));
    expect(vault.properties(STANDUP)['status']).toBe('new');
    // Mara closes it, then files it away in the Archive, and later brings it back.
    vault.files.set(STANDUP, meeting({ kind: 'standup', status: 'done' }));
    const beforeArchive = versions();
    await archiveNotes({
      ports: vault.ports,
      paths: [createVaultPath(STANDUP)],
      notePaths: notePaths(),
      today: TODAY,
    });
    expect(vault.files.has(STANDUP)).toBe(false);
    await run(MARK, noteChangesBetween(beforeArchive, versions()));
    const archived = [...vault.files.keys()].find((path) => path.startsWith('Archive/'))!;
    const beforeRestore = versions();
    await unarchiveNotes({
      ports: vault.ports,
      paths: [archived as VaultPath],
      notePaths: notePaths(),
    });
    expect(vault.properties(STANDUP)['status']).toBe('done');

    const restored = noteChangesBetween(beforeRestore, versions());
    await run(MARK, restored);

    // A restore is not an arrival: the rule must leave the meeting as Mara left it.
    expect(vault.properties(STANDUP)['status']).toBe('done');
  });

  it('runs for a new meeting made at the path of a deleted one, from the same template bytes', async () => {
    const template = meeting({ kind: 'standup' });
    const { vault, run, versions } = setUp({ [STANDUP]: template });
    await run(MARK, noteChangesBetween(new Map(), versions()));
    expect(vault.properties(STANDUP)['status']).toBe('new');
    // Tobias deletes that meeting; a week later a fresh one is made from the template at the same name.
    const beforeDelete = versions();
    vault.files.delete(STANDUP);
    const afterDelete = versions();
    await run(MARK, noteChangesBetween(beforeDelete, afterDelete));
    vault.files.set(STANDUP, template);

    await run(MARK, noteChangesBetween(afterDelete, versions()));

    // A new meeting arrived; the rule that marks new meetings has to mark it.
    expect(vault.properties(STANDUP)['status']).toBe('new');
  });
});

describe('runOnNoteChanges, attacked: the hourly cap', () => {
  it('does not spend the cap on runs that changed nothing, so a meeting being typed in does not lock out a new one', async () => {
    const listening: AutomationRule = {
      ...MARK,
      when: { kind: 'note', type: 'meeting', on: ['created', 'changed'] },
    };
    const { vault, run, versions } = setUp(
      { [STANDUP]: meeting({ kind: 'standup' }), [KICKOFF]: meeting({ kind: 'kickoff' }) },
      [STANDUP],
    );
    // Mara takes notes live in the standup: each autosave is a new version, heard while she still types.
    for (let save = 0; save < NOTE_RUNS_PER_HOUR; save += 1) {
      const before = versions();
      vault.files.set(STANDUP, meeting({ kind: 'standup' }, `Notes, take ${save}.\n`));
      const entry = await run(listening, noteChangesBetween(before, versions()));
      expect(entry?.kind === 'run' && entry.done).toEqual([]);
    }
    expect(vault.properties(STANDUP)['status']).toBeUndefined();

    // A kickoff meeting arrives by sync in the same hour.
    const kickoff: NoteChange = {
      kind: 'added',
      path: KICKOFF,
      type: 'meeting',
      digest: digestOf(vault.files.get(KICKOFF)!),
    };
    await run(listening, [kickoff]);

    expect(vault.properties(KICKOFF)['status']).toBe('new');
  });
});

describe('runOnNoteChanges, attacked again (round 2): a path a handled note left', () => {
  it('runs for a new meeting made, from the same template bytes, at the path a handled one was archived from', async () => {
    const template = meeting({ kind: 'standup' });
    const { vault, run, versions, notePaths } = setUp({ [STANDUP]: template });
    await run(MARK, noteChangesBetween(new Map(), versions()));
    expect(vault.properties(STANDUP)['status']).toBe('new');
    // Mara files the standup in the Archive by hand; the next one is made from the template at the same name.
    const beforeArchive = versions();
    await archiveNotes({
      ports: vault.ports,
      paths: [createVaultPath(STANDUP)],
      notePaths: notePaths(),
      today: TODAY,
    });
    expect(vault.files.has(STANDUP)).toBe(false);
    const afterArchive = versions();
    await run(MARK, noteChangesBetween(beforeArchive, afterArchive));
    vault.files.set(STANDUP, template);

    await run(MARK, noteChangesBetween(afterArchive, versions()));

    // A new meeting arrived; the rule that marks new meetings has to mark it.
    expect(vault.properties(STANDUP)['status']).toBe('new');
  });

  it('runs for a new meeting made, from the same template bytes, at the path a handled one was renamed from', async () => {
    const template = meeting({ kind: 'standup' });
    const { vault, run, versions } = setUp({ [STANDUP]: template });
    await run(MARK, noteChangesBetween(new Map(), versions()));
    expect(vault.properties(STANDUP)['status']).toBe('new');
    // Tobias renames it to say who it was with; the next one is made from the template at the old name.
    const renamed = 'Inbox/Meetings/2026-10-06 Standup with Mara Quill.md';
    const beforeRename = versions();
    await vault.ports.fs.moveEntry({
      from: createVaultPath(STANDUP),
      to: createVaultPath(renamed),
    });
    const afterRename = versions();
    await run(MARK, noteChangesBetween(beforeRename, afterRename));
    vault.files.set(STANDUP, template);

    await run(MARK, noteChangesBetween(afterRename, versions()));

    expect(vault.properties(STANDUP)['status']).toBe('new');
  });

  it('runs for a new meeting pulled in at a path whose handled meeting the same pull archived', async () => {
    const { vault, run, versions, notePaths } = setUp({ [STANDUP]: meeting({ kind: 'standup' }) });
    await run(MARK, noteChangesBetween(new Map(), versions()));
    expect(vault.properties(STANDUP)['status']).toBe('new');
    // On the other Mac, Mara archives the standup and makes the next one at the same name; one pull brings both.
    const beforePull = versions();
    await archiveNotes({
      ports: vault.ports,
      paths: [createVaultPath(STANDUP)],
      notePaths: notePaths(),
      today: TODAY,
    });
    vault.files.set(STANDUP, meeting({ kind: 'standup' }, 'The next standup.\n'));
    const pulled = noteChangesBetween(beforePull, versions());
    expect(
      pulled.map(({ kind, path }) => [kind, path.startsWith('Archive/') ? 'Archive' : path]),
    ).toEqual(
      expect.arrayContaining([
        ['changed', STANDUP],
        ['added', 'Archive'],
      ]),
    );
    expect(pulled).toHaveLength(2);

    await run(MARK, pulled);

    // The meeting now at that path is new: a rule that marks new meetings has to mark it.
    expect(vault.properties(STANDUP)['status']).toBe('new');
  });
});

describe('runOnNoteChanges, attacked again (round 2): a deletion heard by a run whose query fails', () => {
  it('still ends the history of a handled meeting deleted in the same sync as one its broken query could not take', async () => {
    const template = meeting({ kind: 'standup' });
    const { vault, run, versions } = setUp({ [STANDUP]: template });
    await run(MARK, noteChangesBetween(new Map(), versions()));
    expect(vault.properties(STANDUP)['status']).toBe('new');
    // The rule's query is broken by a hand edit; in the same sync the standup is deleted and a kickoff arrives.
    const broken: AutomationRule = { ...MARK, which: 'FROM meeting WHERE' };
    const before = versions();
    vault.files.delete(STANDUP);
    await vault.ports.fs.createNote({
      path: createVaultPath(KICKOFF),
      contents: meeting({ kind: 'kickoff' }),
    });
    const sync = noteChangesBetween(before, versions());
    expect(await run(broken, sync)).toMatchObject({ kind: 'failed' });
    // Fixed; later a fresh standup is made from the template at the deleted one's name.
    const afterDelete = versions();
    vault.files.set(STANDUP, template);

    await run(MARK, noteChangesBetween(afterDelete, versions()));

    expect(vault.properties(STANDUP)['status']).toBe('new');
  });
});

describe('runOnNoteChanges, attacked again (round 2): a note an archive relinks', () => {
  it('still hears what the user typed into a note its archive then rewrote links in', async () => {
    const fileDone: AutomationRule = {
      ...MARK,
      id: 'FileDone',
      path: createVaultPath('.atlas/automations/FileDone.md'),
      name: 'File meetings that are done',
      when: { kind: 'note', type: 'meeting', on: ['created', 'changed'] },
      which: 'FROM meeting WHERE status = done',
      action: { kind: 'archive' },
    };
    const link = 'Follows [[Inbox/Meetings/2026-10-06 Standup]].\n';
    const { vault, run, versions } = setUp({
      [STANDUP]: meeting({ kind: 'standup', status: 'done' }),
      [KICKOFF]: meeting({ kind: 'kickoff' }, link),
    });
    const before = versions();
    // Mara closes the kickoff too; it is saved, but the index has not looked again yet when the rule runs.
    vault.files.set(KICKOFF, meeting({ kind: 'kickoff', status: 'done' }, link));
    const standupDone: NoteChange = {
      kind: 'changed',
      path: STANDUP,
      type: 'meeting',
      digest: digestOf(vault.files.get(STANDUP)!),
    };
    await run(fileDone, [standupDone]);
    expect(vault.files.has(STANDUP)).toBe(false);
    expect(vault.files.get(KICKOFF)).not.toContain('[[Inbox/Meetings/2026-10-06 Standup]]');

    // The index looks again: the kickoff changed — by Mara, and by the rule's relink.
    await run(fileDone, noteChangesBetween(before, versions()));

    // Mara's change set the kickoff done; the rule that files done meetings has to file it.
    expect(vault.files.has(KICKOFF)).toBe(false);
  });
});
