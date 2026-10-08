import { describe, expect, it, vi } from 'vitest';
import { digestOf, type NoteChange } from '@atlas/domain';
import { createNoteChanges } from '../index/note-changes.ts';
import { automationVault, jsonNote } from '../testing/automation-vault.ts';
import { recordingActivity } from '../testing/fake-activity.ts';
import { meetingFile } from '../testing/meeting-files.ts';
import { createMeetingImporter, importMeetingsOnArrival } from './meeting-importer.ts';

const VAULT = '/Users/j/Vault';
const BROKEN = 'Inbox/Meetings/2026-10-06 Standup.md';
const BROKEN_TEXT = jsonNote({ type: 'meeting', atlas_import: 'meeting/v1' }, '\nNotes.\n');

function setUp({
  open = VAULT,
  active = true,
  notes = { [BROKEN]: BROKEN_TEXT } as Record<string, string>,
}: { open?: string | null; active?: boolean; notes?: Record<string, string> } = {}) {
  const vault = automationVault({ notes, today: '2026-10-08' });
  const activity = recordingActivity();
  const onWritten = vi.fn();
  const state = { active };
  const importer = createMeetingImporter({
    ports: () => vault.ports,
    clock: { today: () => '2026-10-08' },
    activity,
    openVault: () => open,
    active: () => state.active,
    onWritten,
  });
  const arrived: NoteChange = {
    kind: 'added',
    path: BROKEN,
    type: 'meeting',
    digest: digestOf(BROKEN_TEXT),
  };
  return { vault, activity, onWritten, importer, arrived, state };
}

describe('createMeetingImporter', () => {
  it('imports what it hears and says when it wrote, so the vault is read again', async () => {
    const { vault, importer, arrived, onWritten } = setUp();

    const outcome = await importer.hear({ vault: VAULT, changes: [arrived] });

    expect(outcome?.happenings.map((happening) => happening.kind)).toEqual(['invalid']);
    expect(vault.properties(BROKEN)['atlas_import_error']).toContain('title is required');
    expect(onWritten).toHaveBeenCalledTimes(1);
  });

  it('drops news of a vault that is no longer open', async () => {
    const { vault, importer, arrived, activity, onWritten } = setUp({ open: '/Users/j/Other' });

    expect(await importer.hear({ vault: VAULT, changes: [arrived] })).toBeNull();
    expect(vault.files.get(BROKEN)).toBe(BROKEN_TEXT);
    expect(activity.reports).toEqual([]);
    expect(onWritten).not.toHaveBeenCalled();
  });

  it('writes nothing on a Mac that does not run the automations, and catches up once it does', async () => {
    const { vault, importer, arrived, activity, state } = setUp({ active: false });

    expect(await importer.hear({ vault: VAULT, changes: [arrived] })).toBeNull();
    expect(await importer.catchUp(VAULT)).toBeNull();
    expect(vault.files.get(BROKEN)).toBe(BROKEN_TEXT);
    expect(activity.reports).toEqual([]);

    state.active = true;
    const outcome = await importer.catchUp(VAULT);

    expect(outcome?.happenings.map((happening) => happening.kind)).toEqual(['invalid']);
    expect(vault.properties(BROKEN)['atlas_import_outcome']).toBe('error');
  });

  it('imports one sync at a time, and a change heard twice once', async () => {
    const { importer, arrived, activity } = setUp();

    const [first, second] = await Promise.all([
      importer.hear({ vault: VAULT, changes: [arrived] }),
      importer.hear({ vault: VAULT, changes: [arrived] }),
    ]);

    expect(first?.happenings).toHaveLength(1);
    expect(second?.happenings).toEqual([]);
    expect(activity.reports).toHaveLength(1);
  });

  it('decides one sync after another, so two copies heard at once are never both archived', async () => {
    const first = 'Inbox/Meetings/Standup.md';
    const second = 'Inbox/Meetings/Standup (gemini 1a2b3c4d).md';
    const { vault, importer } = setUp({
      notes: { [first]: meetingFile(), [second]: meetingFile() },
    });
    const added = (path: string): NoteChange => ({
      kind: 'added',
      path,
      type: 'meeting',
      digest: digestOf(meetingFile()),
    });

    await Promise.all([
      importer.hear({ vault: VAULT, changes: [added(second)] }),
      importer.hear({ vault: VAULT, changes: [added(first)] }),
    ]);

    expect([first, second].filter((path) => vault.files.has(path))).toEqual([first]);
    expect(vault.properties(first)['atlas_import_outcome']).toBe('imported');
  });

  it('says a run that failed outright in Activity, and goes on with the next', async () => {
    const { vault, importer, activity, arrived } = setUp();
    const listDirectory = vault.ports.fs.listDirectory;
    vault.ports.fs.listDirectory = async () => {
      throw new Error('the vault went away');
    };

    expect(await importer.catchUp(VAULT)).toBeNull();
    vault.ports.fs.listDirectory = listDirectory;
    const next = await importer.hear({ vault: VAULT, changes: [arrived] });

    expect(activity.reports[0]).toEqual({
      level: 'error',
      kind: 'meeting',
      message: 'Meetings that arrived could not be imported. the vault went away',
      subject: null,
    });
    expect(next?.happenings.map((happening) => happening.kind)).toEqual(['invalid']);
  });

  it('hears every sync the change feed publishes, until stopped', async () => {
    const other = 'Inbox/Meetings/Other.md';
    const { importer, arrived, activity } = setUp({
      notes: { [BROKEN]: BROKEN_TEXT, [other]: BROKEN_TEXT },
    });
    const changes = createNoteChanges({ onError: () => undefined });
    const stop = importMeetingsOnArrival({ changes, importer });

    changes.publish({ vault: VAULT, changes: [arrived] });
    await vi.waitFor(() => expect(activity.reports).toHaveLength(1));
    stop();
    changes.publish({ vault: VAULT, changes: [{ ...arrived, path: other }] });
    await importer.hear({ vault: VAULT, changes: [] });

    expect(activity.reports).toHaveLength(1);
  });
});
