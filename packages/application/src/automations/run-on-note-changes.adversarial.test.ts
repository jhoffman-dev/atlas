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
