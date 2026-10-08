import { describe, expect, it } from 'vitest';
import { createVaultPath, digestOf, type NoteChange } from '@atlas/domain';
import type { IndexEntry } from '../index/ports.ts';
import { unarchiveNotes } from '../archive/archive-notes.ts';
import { automationVault } from '../testing/automation-vault.ts';
import { recordingActivity } from '../testing/fake-activity.ts';
import {
  MEETING_BODY,
  MEETING_HEADER,
  meetingFile,
  meetingHeaderWithout,
} from '../testing/meeting-files.ts';
import { importArrivedMeetings } from './import-arrived-meetings.ts';
import { seenVersions } from './meeting-importer.ts';

const TODAY = '2026-10-08';
const STANDUP = 'Inbox/Meetings/2026-10-06 Standup.md';
const RESENT = 'Inbox/Meetings/2026-10-06 Standup (gemini 1a2b3c4d).md';

const HEADER = MEETING_HEADER;
const BODY = MEETING_BODY;
const meeting = meetingFile;
const WITHOUT_ID = meetingHeaderWithout('external_id');

/**
 * A vault, the run over it, and what Activity was told. Each run follows a
 * sync, so the index answers as the files were when the run began — and not
 * as the run itself goes on to write them, as the real index would not.
 */
function setUp(notes: Record<string, string>, { dirty = [] as string[] } = {}) {
  const vault = automationVault({ notes, today: TODAY, dirty });
  let indexed = vault;
  const reindex = () => {
    indexed = automationVault({ notes: Object.fromEntries(vault.files), today: TODAY });
  };
  const ports = {
    ...vault.ports,
    index: {
      ...vault.ports.index,
      query: (sql: string, parameters: readonly (string | number | null)[]) =>
        indexed.ports.index.query(sql, parameters),
      manifest: async (): Promise<IndexEntry[]> =>
        [...indexed.files.keys()].map((path) => ({
          path,
          modified: 0,
          size: 0,
          type: null,
          digest: digestOf(indexed.files.get(path) ?? ''),
        })),
    },
  };
  const activity = recordingActivity();
  const seen = seenVersions();
  /** A run after the sync that reported `changes`; `stale` when no sync came between it and the last. */
  const run = (changes: readonly NoteChange[], { stale = false } = {}) => {
    if (!stale) reindex();
    return importArrivedMeetings({ ports, changes, today: TODAY, activity, seen });
  };
  /** The change the feed reports for a note as it is now. */
  const as = (kind: NoteChange['kind'], path: string): NoteChange => ({
    kind,
    path,
    type: 'meeting',
    digest: digestOf(vault.files.get(path) ?? ''),
  });
  return { vault, ports, activity, run, as };
}

describe('importArrivedMeetings', () => {
  it('leaves a valid meeting exactly as it came, and says it arrived', async () => {
    const text = meeting();
    const { vault, activity, run, as } = setUp({ [STANDUP]: text });

    const outcome = await run([as('added', STANDUP)]);

    expect(vault.files.get(STANDUP)).toBe(text);
    expect(vault.log.filter((line) => !line.startsWith('reload'))).toEqual([]);
    expect(outcome).toEqual({ happenings: [{ kind: 'arrived', path: STANDUP }], wrote: false });
    expect(activity.reports).toEqual([
      {
        level: 'info',
        kind: 'meeting',
        message: '2026-10-06 Standup: arrived in the Inbox.',
        subject: { kind: 'note', path: STANDUP },
      },
    ]);
  });

  it('marks a second copy as a duplicate of the first and archives it', async () => {
    const { vault, activity, run, as } = setUp({ [STANDUP]: meeting(), [RESENT]: meeting() });

    const outcome = await run([as('added', RESENT)]);

    const archived = `Archive/${RESENT}`;
    expect(vault.files.has(RESENT)).toBe(false);
    expect(vault.properties(archived)).toMatchObject({
      atlas_duplicate_of: '[[2026-10-06 Standup]]',
      archived: TODAY,
      archivedFrom: RESENT,
    });
    expect(vault.files.get(STANDUP)).toBe(meeting());
    expect(outcome.wrote).toBe(true);
    expect(activity.reports.map((report) => [report.level, report.message])).toEqual([
      [
        'info',
        '2026-10-06 Standup (gemini 1a2b3c4d): a second copy of 2026-10-06 Standup, so it was archived.',
      ],
    ]);
    expect(activity.reports[0]?.subject).toEqual({ kind: 'note', path: archived });
  });

  it('lets an unarchived duplicate stay, marked, and looks at it no more', async () => {
    const { vault, ports, activity, run, as } = setUp({
      [STANDUP]: meeting(),
      [RESENT]: meeting(),
    });
    await run([as('added', RESENT)]);
    const archived = createVaultPath(`Archive/${RESENT}`);

    const back = await unarchiveNotes({
      ports,
      paths: [archived],
      notePaths: [...vault.files.keys()].map(createVaultPath),
    });
    expect(back.moves.map(({ move }) => move.to)).toEqual([RESENT]);
    const reports = activity.reports.length;
    await run([as('removed', archived), as('added', RESENT)]);

    expect(vault.files.has(RESENT)).toBe(true);
    expect(vault.properties(RESENT)['atlas_duplicate_of']).toBe('[[2026-10-06 Standup]]');
    expect(activity.reports).toHaveLength(reports);
  });

  it('marks a file that breaks the contract where it landed, naming the problem', async () => {
    const { vault, activity, run, as } = setUp({ [STANDUP]: meeting(WITHOUT_ID) });

    const outcome = await run([as('added', STANDUP)]);

    expect(vault.files.has(STANDUP)).toBe(true);
    expect(vault.properties(STANDUP)['atlas_import_error']).toBe('external_id is required');
    expect(vault.files.get(STANDUP)).toContain(BODY);
    expect(outcome.wrote).toBe(true);
    expect(activity.reports).toEqual([
      {
        level: 'warning',
        kind: 'meeting',
        message: '2026-10-06 Standup: could not be imported. external_id is required',
        subject: { kind: 'note', path: STANDUP },
      },
    ]);
  });

  it('says nothing more when the mark it wrote comes back as a change', async () => {
    const { vault, activity, run, as } = setUp({ [STANDUP]: meeting(WITHOUT_ID) });
    await run([as('added', STANDUP)]);
    const marked = vault.files.get(STANDUP);

    const outcome = await run([as('changed', STANDUP)]);

    expect(outcome.happenings).toEqual([]);
    expect(vault.files.get(STANDUP)).toBe(marked);
    expect(activity.reports).toHaveLength(1);
  });

  it('takes the error out once the file is fixed, and imports it', async () => {
    const { vault, activity, run, as } = setUp({ [STANDUP]: meeting(WITHOUT_ID) });
    await run([as('added', STANDUP)]);
    vault.files.set(STANDUP, meeting({ ...HEADER, atlas_import_error: 'external_id is required' }));

    const outcome = await run([as('changed', STANDUP)]);

    expect(Object.hasOwn(vault.properties(STANDUP), 'atlas_import_error')).toBe(false);
    expect(outcome.happenings).toEqual([{ kind: 'fixed', path: STANDUP }]);
    expect(activity.reports.at(-1)?.message).toBe(
      '2026-10-06 Standup: now follows the import contract, so its import error was taken out.',
    );
  });

  it('rewrites the error when a fix leaves another problem', async () => {
    const { vault, run, as } = setUp({ [STANDUP]: meeting(WITHOUT_ID) });
    await run([as('added', STANDUP)]);
    vault.files.set(
      STANDUP,
      meeting({ ...HEADER, start: '9.30', atlas_import_error: 'external_id is required' }),
    );

    await run([as('changed', STANDUP)]);

    expect(vault.properties(STANDUP)['atlas_import_error']).toBe(
      'start must be a 24-hour time like 14:05, quoted',
    );
  });

  it('leaves an edit to a meeting that imported alone', async () => {
    const { vault, activity, run, as } = setUp({ [STANDUP]: meeting(WITHOUT_ID) });
    vault.files.set(STANDUP, meeting(WITHOUT_ID).replace('moves a week', 'moves two weeks'));

    const outcome = await run([as('changed', STANDUP)]);

    expect(outcome.happenings).toEqual([]);
    expect(Object.hasOwn(vault.properties(STANDUP), 'atlas_import_error')).toBe(false);
    expect(activity.reports).toEqual([]);
  });

  it('says nothing of an edit to a meeting that imported and still reads', async () => {
    const { vault, activity, run, as } = setUp({ [STANDUP]: meeting() });
    await run([as('added', STANDUP)]);
    const edited = meeting().replace('moves a week', 'moves a week; Mara Quill agreed');
    vault.files.set(STANDUP, edited);

    const outcome = await run([as('changed', STANDUP)]);

    expect(outcome).toEqual({ happenings: [], wrote: false });
    expect(vault.files.get(STANDUP)).toBe(edited);
    expect(activity.reports).toHaveLength(1);
  });

  it('takes ids that differ only in the spaces around them as one meeting', async () => {
    const spaced = meeting({ ...HEADER, external_id: '  gemini-7f3a9c21 ' });
    const { vault, run, as } = setUp({ [STANDUP]: meeting(), [RESENT]: spaced });

    await run([as('added', RESENT)]);

    expect(vault.files.has(`Archive/${RESENT}`)).toBe(true);
  });

  it('does nothing twice for the same version, heard twice', async () => {
    const { vault, activity, run, as } = setUp({ [STANDUP]: meeting(), [RESENT]: meeting() });
    const news = [as('added', STANDUP), as('added', RESENT)];

    await run(news);
    const after = new Map(vault.files);
    const second = await run(news);

    expect(second.happenings).toEqual([]);
    expect(vault.files).toEqual(after);
    expect(activity.reports).toHaveLength(2);
  });

  it('keeps the same copy of two arriving together, whichever is reported first', async () => {
    for (const order of [
      [STANDUP, RESENT],
      [RESENT, STANDUP],
    ]) {
      const { vault, run, as } = setUp({ [STANDUP]: meeting(), [RESENT]: meeting() });

      await run(order.map((path) => as('added', path)));

      expect(vault.files.get(STANDUP)).toBe(meeting());
      expect(vault.files.has(RESENT)).toBe(false);
      expect(vault.properties(`Archive/${RESENT}`)['atlas_duplicate_of']).toBe(
        '[[2026-10-06 Standup]]',
      );
    }
  });

  it('archives a copy already there when the original arrives at the path written first', async () => {
    const { vault, activity, run, as } = setUp({ [STANDUP]: meeting(), [RESENT]: meeting() });

    const outcome = await run([as('added', STANDUP)]);

    expect(outcome.happenings.map((happening) => happening.kind)).toEqual(['arrived', 'duplicate']);
    expect(vault.files.has(`Archive/${RESENT}`)).toBe(true);
    expect(activity.reports[1]?.message).toContain('a second copy of 2026-10-06 Standup');
  });

  it('archives a copy typed in when it arrived, once it is saved', async () => {
    const { vault, activity, run, as } = setUp(
      { [STANDUP]: meeting(), [RESENT]: meeting() },
      { dirty: [RESENT] },
    );
    await run([as('added', RESENT)]);
    expect(vault.files.has(RESENT)).toBe(true);
    expect(activity.reports[0]?.level).toBe('error');

    vault.unsaved.delete(RESENT);
    vault.files.set(RESENT, meeting().replace('moves a week', 'moves a week, again'));
    await run([as('changed', RESENT)]);

    expect(vault.files.has(`Archive/${RESENT}`)).toBe(true);
  });

  it('leaves an edited meeting brought back from the Archive alone, even when it no longer reads', async () => {
    const restored = meeting(WITHOUT_ID);
    const { vault, activity, run, as } = setUp({ [STANDUP]: restored });
    const removed: NoteChange = {
      kind: 'removed',
      path: `Archive/${STANDUP}`,
      type: 'meeting',
      digest: 'stamped',
    };

    await run([removed, as('added', STANDUP)]);
    await run([as('changed', STANDUP)]);

    expect(vault.files.get(STANDUP)).toBe(restored);
    expect(activity.reports).toEqual([]);
  });

  it('marks a broken body once, its line counted with the mark in place', async () => {
    const broken = meeting().replace(' ^t0002', '');
    const { vault, activity, run, as } = setUp({ [STANDUP]: broken });

    await run([as('added', STANDUP)]);
    const marked = vault.files.get(STANDUP) ?? '';
    await run([as('changed', STANDUP)]);

    const error = String(vault.properties(STANDUP)['atlas_import_error']);
    const line = Number(/Line (\d+)/.exec(error)?.[1]);
    expect(marked.split('\n')[line - 1]).toContain('**Tobias Fenn**');
    expect(vault.files.get(STANDUP)).toBe(marked);
    expect(activity.reports).toHaveLength(1);
  });

  it('makes the first of two copies arriving together the original, and archives the second', async () => {
    const { vault, run, as } = setUp({ [STANDUP]: meeting(), [RESENT]: meeting() });

    const outcome = await run([as('added', STANDUP), as('added', RESENT)]);

    expect(outcome.happenings.map((happening) => happening.kind)).toEqual(['arrived', 'duplicate']);
    expect(vault.files.has(STANDUP)).toBe(true);
    expect(vault.files.has(`Archive/${RESENT}`)).toBe(true);
  });

  it('never takes a copy that breaks the contract as the original', async () => {
    const broken = { ...HEADER, start: 'soon' };
    const { vault, run, as } = setUp({ [STANDUP]: meeting(broken), [RESENT]: meeting() });

    const outcome = await run([as('added', STANDUP), as('added', RESENT)]);

    expect(outcome.happenings.map((happening) => happening.kind)).toEqual(['invalid', 'arrived']);
    expect(vault.files.has(RESENT)).toBe(true);
  });

  it('never takes a copy being typed in, and so not marked as broken, as the original', async () => {
    const broken = { ...HEADER, start: 'soon' };
    const { vault, run, as } = setUp(
      { [STANDUP]: meeting(broken), [RESENT]: meeting() },
      { dirty: [STANDUP] },
    );

    const outcome = await run([as('added', STANDUP), as('added', RESENT)]);

    expect(outcome.happenings.map((happening) => happening.kind)).toEqual(['invalid', 'arrived']);
    expect(vault.files.has(RESENT)).toBe(true);
  });

  it('never takes a meeting marked as failing import as the original', async () => {
    const marked = meeting({ ...HEADER, start: 'soon', atlas_import_error: 'start must be…' });
    const { vault, run, as } = setUp({ [STANDUP]: marked, [RESENT]: meeting() });

    const outcome = await run([as('added', RESENT)]);

    expect(outcome.happenings).toEqual([{ kind: 'arrived', path: RESENT }]);
    expect(vault.files.has(RESENT)).toBe(true);
  });

  it('reads what a holder says now, not what the index last read', async () => {
    const { vault, run, as } = setUp({ [STANDUP]: meeting(), [RESENT]: meeting() });
    await run([]);
    vault.files.set(STANDUP, meeting({ ...HEADER, external_id: 'gemini-another' }));

    const outcome = await run([as('added', RESENT)], { stale: true });

    expect(outcome.happenings).toEqual([{ kind: 'arrived', path: RESENT }]);
  });

  it('never archives both copies when the index is behind what the last run did', async () => {
    const { vault, run, as } = setUp({ [STANDUP]: meeting(), [RESENT]: meeting() });
    const [first, second] = [as('added', STANDUP), as('added', RESENT)];

    await run([first]);
    await run([second], { stale: true });

    const active = [STANDUP, RESENT].filter((path) => vault.files.has(path));
    expect(active).toHaveLength(1);
    expect(vault.properties(active[0] ?? '')['atlas_duplicate_of']).toBeUndefined();
  });

  it('counts an original fixed earlier in the same sync', async () => {
    const marked = meeting({ ...HEADER, atlas_import_error: 'external_id is required' });
    const { vault, run, as } = setUp({ [STANDUP]: marked, [RESENT]: meeting() });

    const outcome = await run([as('changed', STANDUP), as('added', RESENT)]);

    expect(outcome.happenings.map((happening) => happening.kind)).toEqual(['fixed', 'duplicate']);
    expect(vault.files.has(`Archive/${RESENT}`)).toBe(true);
  });

  it('judges a file that changed since its sync by what it says now, and once', async () => {
    const { vault, activity, run, as } = setUp({ [STANDUP]: meeting() });
    const reported = as('added', STANDUP);
    vault.files.set(STANDUP, meeting(WITHOUT_ID));

    await run([reported]);
    await run([as('changed', STANDUP)]);

    expect(vault.properties(STANDUP)['atlas_import_error']).toBe('external_id is required');
    expect(activity.reports.map((report) => report.level)).toEqual(['warning']);
  });

  it('ignores notes added elsewhere, and a meeting moved into the Inbox with its bytes', async () => {
    const { vault, run, as } = setUp({
      'Projects/Kickoff.md': meeting(WITHOUT_ID),
      [STANDUP]: meeting(WITHOUT_ID),
    });
    const moved: NoteChange = { ...as('added', STANDUP), path: STANDUP };

    const outcome = await run([
      as('added', 'Projects/Kickoff.md'),
      { ...moved, kind: 'removed', path: 'Projects/Standup.md' },
      moved,
    ]);

    expect(outcome.happenings).toEqual([]);
    expect(vault.log.filter((line) => line.startsWith('write'))).toEqual([]);
  });

  it('does not write into a file being typed in, and says so', async () => {
    const { vault, activity, run, as } = setUp(
      { [STANDUP]: meeting(WITHOUT_ID) },
      { dirty: [STANDUP] },
    );

    await run([as('added', STANDUP)]);

    expect(vault.files.get(STANDUP)).toBe(meeting(WITHOUT_ID));
    expect(activity.reports.map((report) => [report.level, report.message])).toEqual([
      [
        'warning',
        '2026-10-06 Standup: could not be imported. The problem is not in the file: it is open in Atlas with unsaved typing. external_id is required',
      ],
    ]);
  });

  it('reports a file whose frontmatter cannot be read, without touching it', async () => {
    const text = `---\n{ not json\n---\n${BODY}`;
    const { vault, activity, run, as } = setUp({ [STANDUP]: text });

    await run([as('added', STANDUP)]);

    expect(vault.files.get(STANDUP)).toBe(text);
    expect(activity.reports[0]?.level).toBe('warning');
    expect(activity.reports[0]?.message).toContain(
      'The problem is not in the file: its frontmatter cannot be read',
    );
  });

  it('says a file it could not finish with failed, and carries on with the rest', async () => {
    const { ports, activity, as } = setUp({ [STANDUP]: meeting(), [RESENT]: meeting(WITHOUT_ID) });
    const failing = {
      ...ports,
      index: {
        ...ports.index,
        query: async () => {
          throw new Error('The index is closed.');
        },
      },
    };

    const outcome = await importArrivedMeetings({
      ports: failing,
      changes: [as('added', STANDUP), as('added', RESENT)],
      today: TODAY,
      activity,
    });

    expect(outcome.happenings.map((happening) => happening.kind)).toEqual(['failed', 'invalid']);
    expect(activity.reports[0]).toMatchObject({
      level: 'error',
      message: '2026-10-06 Standup: could not be imported. The index is closed.',
    });
  });
});

describe('importArrivedMeetings: adversarial', () => {
  it('imports an arrival that changed before it was read when the next sync reports it', async () => {
    const { vault, run, as } = setUp({ [STANDUP]: meeting(), [RESENT]: meeting() });
    await run([as('added', STANDUP)]);
    const reported = as('added', RESENT);
    // The pull lands the resend's next commit between the sync and the import reading it.
    vault.files.set(RESENT, meeting().replace('moves a week', 'moves two weeks'));

    await run([reported]);
    await run([as('changed', RESENT)]);

    expect(vault.files.has(RESENT)).toBe(false);
    expect(vault.properties(`Archive/${RESENT}`)).toMatchObject({
      atlas_duplicate_of: '[[2026-10-06 Standup]]',
    });
  });
});

describe('importArrivedMeetings: adversarial, round 2', () => {
  /**
   * The mapping writes a resend at the path written first whenever it is free
   * — and it is free once the original has been filed or archived. The resend
   * then has the path and the bytes of the original's own arrival, which the
   * seen versions remember, so it is never looked at: it stays in the Inbox
   * beside the meeting it copies. A Mac that restarted since (or never heard
   * the first arrival) archives it, so correctness rests on the memory.
   */
  it('archives a resend at the path the original arrived at once the original is filed', async () => {
    const filed = 'Projects/Larkspur/2026-10-06 Standup.md';
    const { vault, ports, activity, run, as } = setUp({ [STANDUP]: meeting() });
    await run([as('added', STANDUP)]);
    const digest = digestOf(meeting());
    vault.files.delete(STANDUP);
    vault.files.set(filed, meeting());
    await run([
      { kind: 'removed', path: STANDUP, type: 'meeting', digest },
      as('added', filed),
    ]);

    vault.files.set(STANDUP, meeting());
    const resent = [as('added', STANDUP)];
    await run(resent);
    const keptByMacThatRemembers = vault.files.has(STANDUP);
    // A Mac with no memory of the first arrival, hearing the same sync.
    await importArrivedMeetings({ ports, changes: resent, today: TODAY, activity });
    const keptByMacThatForgot = vault.files.has(STANDUP);

    expect(keptByMacThatForgot).toBe(false);
    expect(vault.properties(`Archive/${STANDUP}`)['atlas_duplicate_of']).toMatch(/Standup\]\]$/);
    expect(keptByMacThatRemembers).toBe(keptByMacThatForgot);
  });

  /**
   * One copy that cannot be written — denied, or changed under the read —
   * throws out of the original's own settling: Activity says the original,
   * which is fine, could not be imported, with the copy's problem, and the
   * copies after it are left in the Inbox.
   */
  it('says a copy that cannot be written against the copy, and still settles the others', async () => {
    const third = 'Inbox/Meetings/2026-10-06 Standup (gemini 5e6f7a8b).md';
    const { vault, ports, activity, as } = setUp({
      [STANDUP]: meeting(),
      [RESENT]: meeting(),
      [third]: meeting(),
    });
    const denying = {
      ...ports,
      fs: {
        ...ports.fs,
        writeTextFile: async (args: Parameters<typeof ports.fs.writeTextFile>[0]) => {
          if (args.path === RESENT) throw new Error('Permission denied.');
          return ports.fs.writeTextFile(args);
        },
      },
    };

    const outcome = await importArrivedMeetings({
      ports: denying,
      changes: [as('added', STANDUP)],
      today: TODAY,
      activity,
    });

    expect(outcome.happenings).toContainEqual({ kind: 'arrived', path: STANDUP });
    expect(outcome.happenings).not.toContainEqual(
      expect.objectContaining({ kind: 'failed', path: STANDUP }),
    );
    expect(vault.files.has(`Archive/${third}`)).toBe(true);
  });
});
