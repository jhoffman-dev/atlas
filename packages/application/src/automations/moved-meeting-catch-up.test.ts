/**
 * A meeting a `created` rule ran on, then moved — the #214 tidy takes let-in
 * meetings from `Inbox/Meetings` to their month, rewriting a link in one when
 * a note it links moved too. The catch-up when DFAI opens must not take it
 * for an arrival the rule missed: a `set` rule run again writes its value over
 * what the person changed since (found by adv-222).
 *
 * Over the fake vault whose index answers with real SQL, with the feed measured
 * from what the index held, as `syncIndex` keeps it.
 */
import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  logPathFor,
  noteChangesBetween,
  parseObjectType,
  parseRunLog,
  versionsAfter,
  type AutomationRule,
  type NoteChange,
  type NoteVersion,
} from '@atlas/domain';
import { heldEntries } from '../index/refresh-index.ts';
import { automationVault, jsonNote, TASK_TYPES } from '../testing/automation-vault.ts';
import { recordingActivity } from '../testing/fake-activity.ts';
import { MEETING_BODY, MEETING_HEADER } from '../testing/meeting-files.ts';
import { runOnMissedArrivals, runOnNoteChanges } from './run-automation.ts';
import type { VaultGuard } from './vault-guard.ts';

const TODAY = '2026-10-08';
const CLOCK = {
  today: () => TODAY,
  localNow: () => `${TODAY}T09:00:00`,
  now: () => Date.parse(`${TODAY}T09:00:00Z`),
};
const VAULT = '/vaults/home';
const GUARD: VaultGuard = { vault: VAULT, currentVault: () => VAULT };
const TYPES = [
  ...TASK_TYPES,
  parseObjectType({ name: 'meeting', label: 'Meeting', properties: { status: 'text' } }),
];
const OLD = '2026-10-06 Standup.md';
const IN_INBOX = `Inbox/Meetings/${OLD}`;
const IN_MONTH = `Meetings/2026/10/${OLD}`;
const RULE_FILE = '.atlas/automations/Mark meetings.md';

const MARK_ON_ARRIVAL: AutomationRule = {
  id: 'Mark meetings',
  path: createVaultPath(RULE_FILE),
  name: 'Mark meetings',
  enabled: true,
  when: { kind: 'note', type: 'meeting', on: ['created'] },
  which: 'FROM meeting',
  olderThanDays: null,
  action: { kind: 'set', values: { status: 'new' } },
};

async function setUp() {
  const vault = automationVault({
    notes: {
      // Saved the day before: every arrival since is the rule's to run on.
      [RULE_FILE]: 'The rule, as its file holds it.\n',
      [IN_INBOX]: jsonNote({ ...MEETING_HEADER }, `${MEETING_BODY}\nWith [[Acme]].\n`),
      'Acme.md': jsonNote({ type: 'company' }, ''),
    },
    today: TODAY,
    ageDays: { [RULE_FILE]: 1 },
    types: TYPES,
  });
  const activity = recordingActivity();
  let held = new Map<string, NoteVersion>(await heldEntries(vault.ports.index));
  /** What the feed says has happened since it last looked. */
  const sync = async (): Promise<NoteChange[]> => {
    const changes = noteChangesBetween(held, await heldEntries(vault.ports.index));
    held = versionsAfter(held, changes);
    return changes;
  };
  const hear = async () =>
    runOnNoteChanges({
      ports: vault.ports,
      rule: MARK_ON_ARRIVAL,
      clock: CLOCK,
      guard: GUARD,
      activity,
      changes: await sync(),
    });
  const write = (path: string, text: string) =>
    vault.ports.fs.writeTextFile({
      path: createVaultPath(path),
      contents: text,
      expectedModified: null,
    });
  const edit = (path: string, change: (text: string) => string) =>
    write(path, change(vault.files.get(path) ?? ''));
  /** The import lets the meeting in, the rule runs on its arrival, and the person changes what it set. */
  const arriveAndEdit = async () => {
    await edit(IN_INBOX, (text) =>
      text.replace('"type":"meeting"', '"type":"meeting","atlas_import_outcome":"imported"'),
    );
    await hear();
    expect(vault.properties(IN_INBOX)['status']).toBe('new');
    await hear();
    await edit(IN_INBOX, (text) => text.replace('"status":"new"', '"status":"done"'));
    await hear();
  };
  /** The tidy moves the meeting into its month and rewrites its link to a note that moved too. */
  const tidy = async () => {
    for (const folder of ['Meetings', 'Meetings/2026', 'Meetings/2026/10', 'Companies']) {
      await vault.ports.fs.createFolder({ path: createVaultPath(folder) });
    }
    await vault.ports.fs.moveEntry({
      from: createVaultPath(IN_INBOX),
      to: createVaultPath(IN_MONTH),
    });
    await vault.ports.fs.moveEntry({
      from: createVaultPath('Acme.md'),
      to: createVaultPath('Companies/Acme.md'),
    });
    await edit(IN_MONTH, (text) => text.replace('[[Acme]]', '[[Companies/Acme]]'));
  };
  const catchUp = () =>
    runOnMissedArrivals({
      ports: vault.ports,
      rule: MARK_ON_ARRIVAL,
      clock: CLOCK,
      guard: GUARD,
      activity,
    });
  return { vault, hear, arriveAndEdit, tidy, catchUp };
}

describe('a meeting the rule ran on, moved by the tidy', () => {
  it('is not run on again when DFAI opens: what the person set stays', async () => {
    const { vault, hear, arriveAndEdit, tidy, catchUp } = await setUp();
    await arriveAndEdit();
    await tidy();
    await hear();

    expect(await catchUp()).toBeNull();
    expect(vault.properties(IN_MONTH)['status']).toBe('done');
  });

  it('is known to the rule’s log where it is now', async () => {
    const { vault, hear, arriveAndEdit, tidy } = await setUp();
    await arriveAndEdit();
    await tidy();
    await hear();

    const entries = parseRunLog(vault.files.get(logPathFor(MARK_ON_ARRIVAL.id)) ?? '');
    expect(entries.at(-1)).toMatchObject({
      kind: 'run',
      went: [IN_INBOX],
      moved: [{ from: IN_INBOX, path: IN_MONTH }],
    });
  });

  it('is not run on again when the rule never heard of the move', async () => {
    const { vault, arriveAndEdit, tidy, catchUp } = await setUp();
    await arriveAndEdit();
    // Quit before the feed's news of the tidy reached the rule.
    await tidy();

    expect(await catchUp()).toBeNull();
    expect(vault.properties(IN_MONTH)['status']).toBe('done');
  });

  it('still catches up on a meeting that arrived while the rule was not listening', async () => {
    const { vault, catchUp } = await setUp();
    await vault.ports.fs.writeTextFile({
      path: createVaultPath(IN_INBOX),
      contents: (vault.files.get(IN_INBOX) ?? '').replace(
        '"type":"meeting"',
        '"type":"meeting","atlas_import_outcome":"imported"',
      ),
      expectedModified: null,
    });

    expect(await catchUp()).not.toBeNull();
    expect(vault.properties(IN_INBOX)['status']).toBe('new');
  });
});
