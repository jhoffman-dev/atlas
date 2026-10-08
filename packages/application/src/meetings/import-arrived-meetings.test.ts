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
import { catchUpMeetings, importArrivedMeetings } from './import-arrived-meetings.ts';

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
  /** A run after the sync that reported `changes`; `stale` when no sync came between it and the last. */
  const run = (changes: readonly NoteChange[], { stale = false } = {}) => {
    if (!stale) reindex();
    return importArrivedMeetings({ ports, changes, today: TODAY, activity });
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

/** A meeting the import has let in, as its file then reads. */
const imported = (header: Readonly<Record<string, unknown>> = HEADER) =>
  meeting({ ...header, atlas_import_outcome: 'imported' });

describe('importArrivedMeetings', () => {
  it('lets a valid meeting in, writing only its stamp, and says it arrived', async () => {
    const { vault, activity, run, as } = setUp({ [STANDUP]: meeting() });

    const outcome = await run([as('added', STANDUP)]);

    expect(vault.properties(STANDUP)).toEqual({ ...HEADER, atlas_import_outcome: 'imported' });
    expect(vault.files.get(STANDUP)).toContain(BODY);
    expect(outcome).toEqual({ happenings: [{ kind: 'arrived', path: STANDUP }], wrote: true });
    expect(activity.reports).toEqual([
      {
        level: 'info',
        kind: 'meeting',
        message: '2026-10-06 Standup: arrived in the Inbox.',
        subject: { kind: 'note', path: STANDUP },
      },
    ]);
  });

  it('archives a second copy of a meeting already let in, stamped and linked to it', async () => {
    const { vault, activity, run, as } = setUp({ [STANDUP]: imported(), [RESENT]: meeting() });

    const outcome = await run([as('added', RESENT)]);

    const archived = `Archive/${RESENT}`;
    expect(vault.files.has(RESENT)).toBe(false);
    expect(vault.properties(archived)).toMatchObject({
      atlas_import_outcome: 'duplicate',
      atlas_duplicate_of: '[[2026-10-06 Standup]]',
      archived: TODAY,
      archivedFrom: RESENT,
    });
    expect(vault.files.get(STANDUP)).toBe(imported());
    expect(outcome.wrote).toBe(true);
    expect(activity.reports.map((report) => [report.level, report.message])).toEqual([
      [
        'info',
        '2026-10-06 Standup (gemini 1a2b3c4d): a second copy of 2026-10-06 Standup, so it was archived.',
      ],
    ]);
    expect(activity.reports[0]?.subject).toEqual({ kind: 'note', path: archived });
  });

  it('keeps a meeting let in as the original wherever it is, even at a later name', async () => {
    const filed = 'Archive/Projects/2026-10-06 Standup (gemini 1a2b3c4d).md';
    const { vault, run, as } = setUp({ [filed]: imported(), [STANDUP]: meeting() });

    await run([as('added', STANDUP)]);

    expect(vault.files.has(STANDUP)).toBe(false);
    expect(vault.properties(`Archive/${STANDUP}`)['atlas_duplicate_of']).toMatch(/gemini 1a2b3c4d/);
    expect(vault.files.get(filed)).toBe(imported());
  });

  it('never judges a stamped file again: an edit, a rename, an unarchive all carry the stamp', async () => {
    const edited = imported(WITHOUT_ID).replace('moves a week', 'moves two weeks');
    const copy = meeting({ ...HEADER, atlas_import_outcome: 'duplicate' });
    const { vault, activity, run, as } = setUp({ [STANDUP]: edited, [RESENT]: copy });

    const outcome = await run([as('changed', STANDUP), as('added', RESENT)]);

    expect(outcome).toEqual({ happenings: [], wrote: false });
    expect(vault.files.get(STANDUP)).toBe(edited);
    expect(vault.files.get(RESENT)).toBe(copy);
    expect(activity.reports).toEqual([]);
  });

  it('lets an unarchived duplicate stay, and looks at it no more', async () => {
    const { vault, ports, activity, run, as } = setUp({
      [STANDUP]: imported(),
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
    expect(vault.properties(RESENT)['atlas_import_outcome']).toBe('duplicate');
    expect(activity.reports).toHaveLength(reports);
  });

  it('marks a file that breaks the contract where it landed, naming the problem', async () => {
    const { vault, activity, run, as } = setUp({ [STANDUP]: meeting(WITHOUT_ID) });

    const outcome = await run([as('added', STANDUP)]);

    expect(vault.properties(STANDUP)).toMatchObject({
      atlas_import_outcome: 'error',
      atlas_import_error: 'external_id is required',
    });
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

  it('says nothing more when the stamp it wrote comes back as a change', async () => {
    const { vault, activity, run, as } = setUp({ [STANDUP]: meeting(WITHOUT_ID) });
    await run([as('added', STANDUP)]);
    const marked = vault.files.get(STANDUP);

    const outcome = await run([as('changed', STANDUP)]);

    expect(outcome.happenings).toEqual([]);
    expect(vault.files.get(STANDUP)).toBe(marked);
    expect(activity.reports).toHaveLength(1);
  });

  it('takes the error out once the file is fixed, and lets it in', async () => {
    const { vault, activity, run, as } = setUp({ [STANDUP]: meeting(WITHOUT_ID) });
    await run([as('added', STANDUP)]);
    vault.files.set(
      STANDUP,
      meeting({
        ...HEADER,
        atlas_import_outcome: 'error',
        atlas_import_error: 'external_id is required',
      }),
    );

    const outcome = await run([as('changed', STANDUP)]);

    expect(vault.properties(STANDUP)).toEqual({ ...HEADER, atlas_import_outcome: 'imported' });
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
      meeting({
        ...HEADER,
        start: '9.30',
        atlas_import_outcome: 'error',
        atlas_import_error: 'external_id is required',
      }),
    );

    await run([as('changed', STANDUP)]);

    expect(vault.properties(STANDUP)['atlas_import_error']).toBe(
      'start must be a 24-hour time like 14:05, quoted',
    );
  });

  it('stamps a file whose error is written but whose outcome is not', async () => {
    const half = meeting({ ...WITHOUT_ID, atlas_import_error: 'external_id is required' });
    const { vault, run, as } = setUp({ [STANDUP]: half });

    await run([as('changed', STANDUP)]);

    expect(vault.properties(STANDUP)).toMatchObject({
      atlas_import_outcome: 'error',
      atlas_import_error: 'external_id is required',
    });
  });

  it('never writes into a meeting filed elsewhere that it keeps as the original', async () => {
    const filed = 'Projects/Larkspur/2026-10-06 Standup.md';
    const { vault, run, as } = setUp({ [filed]: meeting(), [STANDUP]: meeting() });

    await run([as('added', STANDUP)]);

    expect(vault.files.get(filed)).toBe(meeting());
    expect(vault.files.has(`Archive/${STANDUP}`)).toBe(true);
  });

  it('takes a file with no stamp as an arrival not finished, whatever the feed called it', async () => {
    const { vault, activity, run, as } = setUp({ [STANDUP]: meeting(WITHOUT_ID) });

    await run([as('changed', STANDUP)]);

    expect(vault.properties(STANDUP)['atlas_import_outcome']).toBe('error');
    expect(activity.reports).toHaveLength(1);
  });

  it('takes ids that differ only in the spaces around them as one meeting', async () => {
    const spaced = meeting({ ...HEADER, external_id: '  gemini-7f3a9c21 ' });
    const { vault, run, as } = setUp({ [STANDUP]: imported(), [RESENT]: spaced });

    await run([as('added', RESENT)]);

    expect(vault.files.has(`Archive/${RESENT}`)).toBe(true);
  });

  it('does nothing twice for the same change, heard twice', async () => {
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

      const outcome = await run(order.map((path) => as('added', path)));

      expect(vault.files.get(STANDUP)).toBe(imported());
      expect(vault.files.has(RESENT)).toBe(false);
      expect(vault.properties(`Archive/${RESENT}`)['atlas_duplicate_of']).toBe(
        '[[2026-10-06 Standup]]',
      );
      expect(outcome.happenings.map((happening) => happening.kind).sort()).toEqual([
        'arrived',
        'duplicate',
      ]);
    }
  });

  it('settles a copy not heard of with the one that was, so nothing waits on the feed', async () => {
    const { vault, activity, run, as } = setUp({ [STANDUP]: meeting(), [RESENT]: meeting() });

    const outcome = await run([as('added', RESENT)]);

    expect(outcome.happenings.map((happening) => happening.kind)).toEqual(['arrived', 'duplicate']);
    expect(vault.properties(STANDUP)['atlas_import_outcome']).toBe('imported');
    expect(vault.files.has(`Archive/${RESENT}`)).toBe(true);
    expect(activity.reports[1]?.message).toContain('a second copy of 2026-10-06 Standup');
  });

  it('archives a copy typed in when it arrived, once it is saved', async () => {
    const { vault, activity, run, as } = setUp(
      { [STANDUP]: imported(), [RESENT]: meeting() },
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

  it('marks a broken body once, its line counted with the stamp in place', async () => {
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

  it('never takes a copy that breaks the contract as the original', async () => {
    const broken = { ...HEADER, start: 'soon' };
    const { vault, run, as } = setUp({ [STANDUP]: meeting(broken), [RESENT]: meeting() });

    const outcome = await run([as('added', STANDUP), as('added', RESENT)]);

    expect(outcome.happenings.map((happening) => happening.kind)).toEqual(['invalid', 'arrived']);
    expect(vault.files.has(RESENT)).toBe(true);
  });

  it('never takes a copy being typed in, and so not stamped as broken, as the original', async () => {
    const broken = { ...HEADER, start: 'soon' };
    const { vault, run, as } = setUp(
      { [STANDUP]: meeting(broken), [RESENT]: meeting() },
      { dirty: [STANDUP] },
    );

    const outcome = await run([as('added', STANDUP), as('added', RESENT)]);

    expect(outcome.happenings.map((happening) => happening.kind)).toEqual(['invalid', 'arrived']);
    expect(vault.files.has(RESENT)).toBe(true);
  });

  it('never takes a meeting stamped as failing import as the original', async () => {
    const marked = meeting({
      ...HEADER,
      start: 'soon',
      atlas_import_outcome: 'error',
      atlas_import_error: 'start must be…',
    });
    const { vault, run, as } = setUp({ [STANDUP]: marked, [RESENT]: meeting() });

    const outcome = await run([as('added', RESENT)]);

    expect(outcome.happenings).toEqual([{ kind: 'arrived', path: RESENT }]);
    expect(vault.files.has(RESENT)).toBe(true);
  });

  it('reads what a holder says now, not what the index last read', async () => {
    const { vault, run, as } = setUp({ [STANDUP]: imported(), [RESENT]: meeting() });
    await run([]);
    vault.files.set(STANDUP, imported({ ...HEADER, external_id: 'gemini-another' }));

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
    expect(vault.properties(active[0] ?? '')['atlas_import_outcome']).toBe('imported');
  });

  it('counts an original fixed earlier in the same sync', async () => {
    const marked = meeting({
      ...HEADER,
      atlas_import_outcome: 'error',
      atlas_import_error: 'external_id is required',
    });
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

  it('ignores notes added elsewhere', async () => {
    const { vault, run, as } = setUp({ 'Projects/Kickoff.md': meeting(WITHOUT_ID) });

    const outcome = await run([as('added', 'Projects/Kickoff.md')]);

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

describe('catchUpMeetings', () => {
  it('settles every file where meetings land that has no stamp, and leaves stamped ones', async () => {
    const third = 'Inbox/Meetings/Deeper/2026-10-07 Retro.md';
    const { vault, ports, activity } = setUp({
      [STANDUP]: meeting(),
      [RESENT]: meeting(),
      [third]: meeting(WITHOUT_ID),
      'Inbox/Meetings/2026-10-01 Kickoff.md': imported({ ...HEADER, external_id: 'g-0' }),
      'Projects/2026-10-02 Planning.md': meeting(WITHOUT_ID),
    });

    const outcome = await catchUpMeetings({ ports, today: TODAY, activity });

    expect(outcome.happenings.map((happening) => [happening.kind, happening.path]).sort()).toEqual([
      ['arrived', STANDUP],
      ['duplicate', RESENT],
      ['invalid', third],
    ]);
    expect(vault.properties('Projects/2026-10-02 Planning.md')).not.toHaveProperty(
      'atlas_import_outcome',
    );
  });

  it('has nothing to do in a vault with nowhere for meetings to land', async () => {
    const { ports, activity } = setUp({ 'Projects/Kickoff.md': meeting() });

    expect(await catchUpMeetings({ ports, today: TODAY, activity })).toEqual({
      happenings: [],
      wrote: false,
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
    await run([{ kind: 'removed', path: STANDUP, type: 'meeting', digest }, as('added', filed)]);

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

describe('importArrivedMeetings: adversarial, round 3', () => {
  /**
   * The person writes their own notes into a meeting once it is in — a
   * section of their own is the obvious one — and the file no longer follows
   * the contract. It is still the meeting the import let in, but the holders
   * are filtered by the contract before the stamp is looked at, so the next
   * copy n8n sends is let in as a second original instead of archived.
   */
  it('keeps a meeting let in as the original after the person adds a section of their own', async () => {
    const annotated = `${imported()}\n## My notes\n\nAsk Tobias about the cutover.\n`;
    const { vault, run, as } = setUp({ [STANDUP]: annotated, [RESENT]: meeting() });

    await run([as('added', RESENT)]);

    expect(vault.files.get(STANDUP)).toBe(annotated);
    expect(vault.files.has(RESENT)).toBe(false);
    expect(vault.properties(`Archive/${RESENT}`)).toMatchObject({
      atlas_import_outcome: 'duplicate',
      atlas_duplicate_of: '[[2026-10-06 Standup]]',
    });
  });

  /**
   * A copy is stamped `duplicate` first and archived second. When the move
   * fails (or Atlas quits between the two), the copy sits in the Inbox
   * stamped `duplicate`, which is never judged again — so no later change or
   * catch-up ever archives it, though Activity said only that the move failed.
   */
  it('archives a copy at the next catch-up when its archive failed after it was stamped', async () => {
    const { vault, ports, activity, run, as } = setUp({
      [STANDUP]: imported(),
      [RESENT]: meeting(),
    });
    const failingMove = {
      ...ports,
      fs: {
        ...ports.fs,
        moveEntry: async () => {
          throw new Error('Resource busy.');
        },
      },
    };
    await importArrivedMeetings({
      ports: failingMove,
      changes: [as('added', RESENT)],
      today: TODAY,
      activity,
    });
    expect(vault.properties(RESENT)['atlas_import_outcome']).toBe('duplicate');

    await run([as('changed', RESENT)]);
    await catchUpMeetings({ ports, today: TODAY, activity });

    expect(vault.files.has(RESENT)).toBe(false);
    expect(vault.files.has(`Archive/${RESENT}`)).toBe(true);
  });

  /**
   * The index, the tree and the API never read a dotted folder or file
   * (ADR-0014, `isVisibleEntry`), but the catch-up walks `Inbox/Meetings/`
   * with a rule of its own and writes an error stamp into whatever it finds
   * there — a tool's hidden scratch file the person cannot see in Atlas.
   */
  it('leaves hidden files under the meeting folder alone, as the rest of Atlas does', async () => {
    const hidden = 'Inbox/Meetings/.drafts/2026-10-06 Standup.md';
    const scratch = '# Draft\n\nNot a meeting yet.\n';
    const { vault, ports, activity } = setUp({ [STANDUP]: imported(), [hidden]: scratch });

    const outcome = await catchUpMeetings({ ports, today: TODAY, activity });

    expect(vault.files.get(hidden)).toBe(scratch);
    expect(outcome.happenings).toEqual([]);
  });
});
