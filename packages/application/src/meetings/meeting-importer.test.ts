import { describe, expect, it, vi } from 'vitest';
import { digestOf, type NoteChange } from '@atlas/domain';
import { createNoteChanges } from '../index/note-changes.ts';
import { automationVault, jsonNote } from '../testing/automation-vault.ts';
import { recordingActivity } from '../testing/fake-activity.ts';
import { meetingFile } from '../testing/meeting-files.ts';
import {
  createMeetingImporter,
  importMeetingsOnArrival,
  seenVersions,
} from './meeting-importer.ts';

const VAULT = '/Users/j/Vault';
const BROKEN = 'Inbox/Meetings/2026-10-06 Standup.md';
const BROKEN_TEXT = jsonNote({ type: 'meeting', atlas_import: 'meeting/v1' }, '\nNotes.\n');

function setUp({ open = VAULT }: { open?: string | null } = {}) {
  const vault = automationVault({ notes: { [BROKEN]: BROKEN_TEXT }, today: '2026-10-08' });
  const activity = recordingActivity();
  const onWritten = vi.fn();
  const importer = createMeetingImporter({
    ports: () => vault.ports,
    clock: { today: () => '2026-10-08' },
    activity,
    openVault: () => open,
    onWritten,
  });
  const arrived: NoteChange = {
    kind: 'added',
    path: BROKEN,
    type: 'meeting',
    digest: digestOf(BROKEN_TEXT),
  };
  return { vault, activity, onWritten, importer, arrived };
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

  it('imports one sync at a time, and a version heard twice once', async () => {
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
    const vault = automationVault({
      notes: { [first]: meetingFile(), [second]: meetingFile() },
      today: '2026-10-08',
    });
    const importer = createMeetingImporter({
      ports: () => vault.ports,
      clock: { today: () => '2026-10-08' },
      activity: recordingActivity(),
      openVault: () => VAULT,
      onWritten: () => undefined,
    });
    const added = (path: string): NoteChange => ({
      kind: 'added',
      path,
      type: 'meeting',
      digest: digestOf(meetingFile()),
    });

    await Promise.all([
      importer.hear({ vault: VAULT, changes: [added(first)] }),
      importer.hear({ vault: VAULT, changes: [added(second)] }),
    ]);

    const active = [first, second].filter((path) => vault.files.has(path));
    expect(active).toHaveLength(1);
    expect(vault.properties(active[0] ?? '')['atlas_duplicate_of']).toBeUndefined();
  });

  it('hears every sync the change feed publishes', async () => {
    const { importer, arrived, activity } = setUp();
    const changes = createNoteChanges({ onError: () => undefined });
    const stop = importMeetingsOnArrival({ changes, importer, activity });

    changes.publish({ vault: VAULT, changes: [arrived] });
    await vi.waitFor(() => expect(activity.reports).toHaveLength(1));
    stop();
    changes.publish({ vault: VAULT, changes: [{ ...arrived, digest: 'another' }] });
    await importer.hear({ vault: VAULT, changes: [] });

    expect(activity.reports).toHaveLength(1);
  });

  it('says a run that failed outright in Activity, and goes on with the next', async () => {
    const changes = createNoteChanges({ onError: () => undefined });
    const failing = { hear: vi.fn().mockRejectedValue(new Error('the vault went away')) };
    const activity = recordingActivity();
    importMeetingsOnArrival({ changes, importer: failing, activity });

    changes.publish({ vault: VAULT, changes: [] });
    changes.publish({ vault: VAULT, changes: [] });

    await vi.waitFor(() => expect(activity.reports).toHaveLength(2));
    expect(activity.reports[0]).toEqual({
      level: 'error',
      kind: 'meeting',
      message: 'Meetings that arrived could not be imported. the vault went away',
      subject: null,
    });
  });
});

describe('seenVersions', () => {
  it('says a version is new once', () => {
    const seen = seenVersions();
    expect(seen.firstTime('A.md', 'd1')).toBe(true);
    expect(seen.firstTime('A.md', 'd1')).toBe(false);
    expect(seen.firstTime('A.md', 'd2')).toBe(true);
    expect(seen.firstTime('B.md', 'd1')).toBe(true);
  });

  it('lets go of the oldest once it holds as many as it keeps', () => {
    const seen = seenVersions(2);
    seen.firstTime('A.md', 'd');
    seen.firstTime('B.md', 'd');
    seen.firstTime('C.md', 'd');
    expect(seen.firstTime('C.md', 'd')).toBe(false);
    expect(seen.firstTime('B.md', 'd')).toBe(false);
    expect(seen.firstTime('A.md', 'd')).toBe(true);
  });
});
