import { describe, expect, it } from 'vitest';
import { createVaultPath, digestOf, type NoteChange } from '@dfai/domain';
import { automationVault, jsonNote } from '../testing/automation-vault.ts';
import { recordingActivity } from '../testing/fake-activity.ts';
import { MEETING_HEADER, meetingFile } from '../testing/meeting-files.ts';
import {
  catchUpMeetings,
  createUnsettledSaid,
  importArrivedMeetings,
  type MeetingImportRun,
} from './import-arrived-meetings.ts';
import { createMeetingImporter } from './meeting-importer.ts';

const TODAY = '2026-10-08';
const STANDUP = 'Inbox/Meetings/2026-10-06 Standup.md';
const PLANNING = 'Inbox/Meetings/2026-10-06 Planning.md';
const COPY = 'Inbox/Meetings/2026-10-06 Standup (gemini 1a2b3c4d).md';
const CONFLICT = 'Inbox/Meetings/2026-10-06 Standup (conflict from Laptop).md';
const BROKEN = jsonNote({ type: 'meeting', atlas_import: 'meeting/v1' }, '\nNotes.\n');
const PLANNING_TEXT = meetingFile({
  ...MEETING_HEADER,
  title: 'Planning',
  external_id: 'gemini-2',
});

/** A run over a vault, the gate it asks and what that was asked, and what Activity was told. */
function setUp(
  notes: Record<string, string>,
  run: Partial<Pick<MeetingImportRun, 'mayWrite' | 'beforeLetIn' | 'unsettledSaid'>> = {},
) {
  const vault = automationVault({ notes, today: TODAY });
  const activity = recordingActivity();
  const changes = (paths: readonly string[]): NoteChange[] =>
    paths.map((path) => ({
      kind: 'added',
      path,
      type: 'meeting',
      digest: digestOf(vault.files.get(path) ?? ''),
    }));
  const base = { ports: vault.ports, today: TODAY, activity, ...run };
  return {
    vault,
    activity,
    hear: (paths: readonly string[]) => importArrivedMeetings({ ...base, changes: changes(paths) }),
    catchUp: () => catchUpMeetings(base),
  };
}

const stamp = (vault: ReturnType<typeof automationVault>, path: string) =>
  vault.properties(path)['atlas_import_outcome'] ?? null;

describe('the import asks the gates of each file, before each write (ADR-0035 part 4)', () => {
  it('writes into a file the gates allow, and leaves one they shut as it was, unsaid', async () => {
    const shut = new Set([PLANNING]);
    const { vault, activity, hear } = setUp(
      { [STANDUP]: meetingFile(), [PLANNING]: PLANNING_TEXT },
      { mayWrite: async (path) => !shut.has(path) },
    );

    const outcome = await hear([STANDUP, PLANNING]);

    expect(stamp(vault, STANDUP)).toBe('imported');
    expect(vault.files.get(PLANNING)).toBe(PLANNING_TEXT);
    expect(outcome.happenings).toEqual([{ kind: 'arrived', path: STANDUP }]);
    expect(activity.reports).toHaveLength(1);
  });

  it('settles a file it held once the gates allow it, on the next catch-up', async () => {
    let open = false;
    const { vault, catchUp } = setUp({ [STANDUP]: meetingFile() }, { mayWrite: async () => open });
    await catchUp();
    expect(stamp(vault, STANDUP)).toBeNull();
    open = true;
    await catchUp();
    expect(stamp(vault, STANDUP)).toBe('imported');
  });

  it('never marks a file that breaks the contract while the gates are shut', async () => {
    const { vault, activity, hear } = setUp({ [STANDUP]: BROKEN }, { mayWrite: async () => false });
    await hear([STANDUP]);
    expect(vault.files.get(STANDUP)).toBe(BROKEN);
    expect(activity.reports).toEqual([]);
  });

  it('asks again before marking a file that breaks the contract, and leaves it unmarked if they shut meanwhile', async () => {
    const answers = [true, false];
    const { vault, activity, hear } = setUp(
      { [STANDUP]: BROKEN },
      { mayWrite: async () => answers.shift() ?? false },
    );
    await hear([STANDUP]);
    expect(vault.files.get(STANDUP)).toBe(BROKEN);
    expect(activity.reports).toEqual([]);
  });

  it('asks again before the stamp, and leaves the meeting unstamped if they shut meanwhile', async () => {
    // Open as the file is read and before its follow-up; shut by the time of its stamp.
    const answers = [true, true, false];
    let linked = 0;
    const { vault, activity, hear } = setUp(
      { [STANDUP]: meetingFile() },
      {
        mayWrite: async () => answers.shift() ?? false,
        beforeLetIn: async () => void (linked += 1),
      },
    );

    const outcome = await hear([STANDUP]);

    expect(linked).toBe(1);
    expect(stamp(vault, STANDUP)).toBeNull();
    expect(outcome.happenings).toEqual([]);
    expect(activity.reports).toEqual([]);
  });

  it('judges a file by when it was modified as first read, not after the import’s own follow-up wrote it', async () => {
    const asked: { path: string; arrivedAt: number }[] = [];
    const { vault, hear } = setUp(
      { [STANDUP]: meetingFile() },
      {
        mayWrite: async (path, arrivedAt) => {
          asked.push({ path, arrivedAt });
          return true;
        },
        // Linking its people writes into the meeting before the stamp.
        beforeLetIn: async (path) => {
          const { text, modified } = await vault.ports.fs.readTextFile(path);
          await vault.ports.fs.writeTextFile({ path, contents: text, expectedModified: modified });
        },
      },
    );
    const { modified } = await vault.ports.fs.readTextFile(createVaultPath(STANDUP));

    await hear([STANDUP]);

    expect(stamp(vault, STANDUP)).toBe('imported');
    expect(asked.length).toBeGreaterThanOrEqual(2);
    expect(new Set(asked.map((each) => each.arrivedAt))).toEqual(new Set([modified]));
  });

  it('archives no copy of a meeting while the copy’s gates are shut', async () => {
    const { vault, hear } = setUp(
      {
        [STANDUP]: meetingFile(),
        [COPY]: meetingFile({ ...MEETING_HEADER, provider: 'gemini' }),
      },
      { mayWrite: async (path) => path !== COPY },
    );

    await hear([STANDUP, COPY]);

    expect(stamp(vault, STANDUP)).toBe('imported');
    expect(vault.files.has(COPY)).toBe(true);
    expect(stamp(vault, COPY)).toBeNull();
  });
});

describe('a file the import cannot settle is said once a session (#174)', () => {
  it('says a conflict copy once over many catch-ups, and again only once it changes', async () => {
    const said = createUnsettledSaid();
    const { vault, activity, catchUp } = setUp({ [CONFLICT]: BROKEN }, { unsettledSaid: said });

    for (let look = 0; look < 4; look += 1) {
      const outcome = await catchUp();
      // Still met every time: only what Activity is told is once.
      expect(outcome.happenings).toEqual([{ kind: 'conflict', path: CONFLICT }]);
    }
    expect(activity.reports).toHaveLength(1);

    vault.files.set(CONFLICT, `${BROKEN}More.\n`);
    await catchUp();
    expect(activity.reports).toHaveLength(2);
  });

  it('says a file it cannot read once, by what stopped it', async () => {
    const said = createUnsettledSaid();
    const { vault, activity, hear } = setUp({ [STANDUP]: meetingFile() }, { unsettledSaid: said });
    vault.ports.fs.readTextFile = async () => {
      throw new Error('Permission denied');
    };

    await hear([STANDUP]);
    await hear([STANDUP]);

    expect(activity.reports).toHaveLength(1);
    expect(activity.reports[0]?.message).toContain('Permission denied');
  });

  it('says every file it settles, every time: only what stays unsettled is said once', async () => {
    const said = createUnsettledSaid();
    const { vault, activity, hear } = setUp({ [STANDUP]: BROKEN }, { unsettledSaid: said });
    await hear([STANDUP]);
    vault.files.set(STANDUP, meetingFile({ ...MEETING_HEADER, atlas_import_outcome: 'error' }));
    await hear([STANDUP]);
    expect(activity.reports.map((report) => report.level)).toEqual(['warning', 'info']);
  });

  it('is kept by the importer for the window, across its runs', async () => {
    const vault = automationVault({ notes: { [CONFLICT]: BROKEN }, today: TODAY });
    const activity = recordingActivity();
    const importer = createMeetingImporter({
      ports: () => vault.ports,
      clock: { today: () => TODAY },
      activity,
      openVault: () => '/Users/j/Vault',
      active: () => true,
      onWritten: () => undefined,
    });
    for (let look = 0; look < 3; look += 1) await importer.catchUp('/Users/j/Vault');
    expect(activity.reports).toHaveLength(1);
  });
});
