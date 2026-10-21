import { describe, expect, it } from 'vitest';
import {
  correctionDigestOf,
  createVaultPath,
  digestOf,
  splitFrontmatter,
  type NoteChange,
} from '@dfai/domain';
import { automationVault, jsonNote } from '../testing/automation-vault.ts';
import { recordingActivity } from '../testing/fake-activity.ts';
import { MEETING_HEADER } from '../testing/meeting-files.ts';
import { UnsavedTypingError } from '../vault/update-links.ts';
import { importArrivedMeetings } from './import-arrived-meetings.ts';
import {
  correctMeetingTerms,
  CorrectionRefusedError,
  meetingTextAsCorrected,
  undoMeetingTermCorrections,
} from './meeting-corrections.ts';

const TODAY = '2026-10-08';
const STANDUP = 'Inbox/Meetings/2026-10-06 Standup.md';

/**
 * Larkspur Pay is misheard as Lark Spur Pay; Mara Quill's name as Mara Quil,
 * which a term says. Her person note's alias is only for linking: it is never used.
 */
const VOCABULARY_NOTES = {
  'Terms/Larkspur Pay.md': jsonNote(
    { type: 'term', kind: 'product', variants: ['Lark Spur Pay'] },
    '',
  ),
  'Terms/Mara Quill.md': jsonNote({ type: 'term', kind: 'person', variants: ['Mara Quil'] }, ''),
  'People/Mara Quill.md': jsonNote({ type: 'person', aliases: ['Mara Quil', 'Toby'] }, ''),
  'People/Tobias Fenn.md': jsonNote({ type: 'person', aliases: ['Toby', 'Tobias Fen'] }, ''),
};

const MISHEARD_BODY = [
  '',
  '## Summary',
  '',
  'Lark Spur Pay go-live moves a week. ^s1',
  '',
  '## Transcript',
  '',
  '**Mara Quil** [~00:00:00] Morning. Lark Spur Pay is late. ^t0001',
  '',
  '**Tobias Fenn** [~00:00:05] See [[Lark Spur Pay]]. ^t0002',
  '',
].join('\n');

const CLEAN_BODY = MISHEARD_BODY.replace(/Lark Spur Pay(?!\]\])/g, 'Larkspur Pay').replace(
  'Mara Quil**',
  'Mara Quill**',
);

const meeting = (body = MISHEARD_BODY, header: Record<string, unknown> = { ...MEETING_HEADER }) =>
  jsonNote(header, body);

function setUp(notes: Record<string, string>, { dirty = [] as string[] } = {}) {
  const vault = automationVault({ notes: { ...VOCABULARY_NOTES, ...notes }, today: TODAY, dirty });
  const activity = recordingActivity();
  const added = (path: string): NoteChange => ({
    kind: 'added',
    path,
    type: 'meeting',
    digest: digestOf(vault.files.get(path) ?? ''),
  });
  const importing = (path: string) =>
    importArrivedMeetings({ ports: vault.ports, changes: [added(path)], today: TODAY, activity });
  const body = (path: string) => splitFrontmatter(vault.files.get(path) ?? '').body;
  return { vault, activity, importing, body };
}

describe('correcting a meeting’s words on import', () => {
  it('lets the meeting in with its spellings put right, the change list written, and Activity told', async () => {
    const { vault, activity, importing, body } = setUp({ [STANDUP]: meeting() });

    const outcome = await importing(STANDUP);

    expect(body(STANDUP)).toBe(CLEAN_BODY);
    expect(vault.properties(STANDUP)).toMatchObject({
      atlas_import_outcome: 'imported',
      atlas_corrections: [
        { from: 'Lark Spur Pay', to: 'Larkspur Pay', count: 2, blocks: ['s1', 't0001'] },
        { from: 'Mara Quil', to: 'Mara Quill', count: 1, blocks: ['t0001'] },
      ],
      atlas_corrections_digest: correctionDigestOf(CLEAN_BODY),
      atlas_corrections_original_digest: correctionDigestOf(MISHEARD_BODY),
    });
    expect(outcome.happenings).toEqual([{ kind: 'arrived', path: STANDUP, corrected: 3 }]);
    expect(activity.reports.map((report) => report.message)).toEqual([
      '2026-10-06 Standup: arrived in the Inbox. 3 misheard spellings corrected; Undo corrections on the meeting puts them back.',
    ]);
  });

  it('marks a meeting with nothing to correct in the stamp write, body untouched, so it is not read again', async () => {
    const { vault, activity, importing, body } = setUp({ [STANDUP]: meeting(CLEAN_BODY) });

    const outcome = await importing(STANDUP);

    expect(body(STANDUP)).toBe(CLEAN_BODY);
    expect(vault.properties(STANDUP)).toMatchObject({
      atlas_import_outcome: 'imported',
      atlas_corrections: 'none',
    });
    expect(vault.properties(STANDUP)).not.toHaveProperty('atlas_corrections_digest');
    expect(outcome.happenings).toEqual([{ kind: 'arrived', path: STANDUP }]);
    expect(activity.reports.map((report) => report.message)).toEqual([
      '2026-10-06 Standup: arrived in the Inbox.',
    ]);
  });

  it('does not mark a meeting while no term has a misheard spelling, so a term added later still applies', async () => {
    const { vault, importing } = setUp({ [STANDUP]: meeting(CLEAN_BODY) }, { dirty: [] });
    for (const path of [...vault.files.keys()]) {
      if (path.startsWith('Terms/')) vault.files.delete(path);
    }

    await importing(STANDUP);

    expect(vault.properties(STANDUP)).not.toHaveProperty('atlas_corrections');
  });

  it('never rewrites a name by a person’s alias: Toby and Tobias Fen stay as heard', async () => {
    const text = MISHEARD_BODY.replace('See', 'Toby and Tobias Fen said so. See');
    const { importing, body } = setUp({ [STANDUP]: meeting(text) });

    await importing(STANDUP);

    expect(body(STANDUP)).toBe(CLEAN_BODY.replace('See', 'Toby and Tobias Fen said so. See'));
  });

  it('corrects a meeting let in once its import error is fixed, and says both', async () => {
    const header = { ...MEETING_HEADER, atlas_import_outcome: 'error', atlas_import_error: 'old' };
    const { activity, importing, body } = setUp({ [STANDUP]: meeting(MISHEARD_BODY, header) });

    const outcome = await importing(STANDUP);

    expect(body(STANDUP)).toBe(CLEAN_BODY);
    expect(outcome.happenings).toEqual([{ kind: 'fixed', path: STANDUP, corrected: 3 }]);
    expect(activity.reports[0]?.message).toMatch(
      /import error was taken out\. 3 misheard spellings corrected;/,
    );
  });

  it('does not correct again a meeting whose corrections were undone, should it be let in anew', async () => {
    const header = { ...MEETING_HEADER, atlas_corrections: 'undone' };
    const { vault, importing, body } = setUp({ [STANDUP]: meeting(MISHEARD_BODY, header) });

    const outcome = await importing(STANDUP);

    expect(body(STANDUP)).toBe(MISHEARD_BODY);
    expect(vault.properties(STANDUP)).toMatchObject({ atlas_corrections: 'undone' });
    expect(outcome.happenings).toEqual([{ kind: 'arrived', path: STANDUP }]);
  });

  it('never corrects a meeting held open with unsaved typing, as it never stamps one', async () => {
    const { vault, importing } = setUp({ [STANDUP]: meeting() }, { dirty: [STANDUP] });

    const outcome = await importing(STANDUP);

    expect(vault.files.get(STANDUP)).toBe(meeting());
    expect(outcome.happenings[0]).toMatchObject({ kind: 'failed', path: STANDUP });
  });
});

describe('undoing a meeting’s corrections', () => {
  it('puts back exactly the original body and marks the corrections undone', async () => {
    const { vault, importing, body } = setUp({ [STANDUP]: meeting() });
    await importing(STANDUP);

    await undoMeetingTermCorrections({ ports: vault.ports, path: createVaultPath(STANDUP) });

    expect(body(STANDUP)).toBe(MISHEARD_BODY);
    const properties = vault.properties(STANDUP);
    expect(properties).toMatchObject({
      atlas_import_outcome: 'imported',
      atlas_corrections: 'undone',
    });
    expect(properties).not.toHaveProperty('atlas_corrections_digest');
  });

  it('is refused, and writes nothing, when the meeting’s body changed since', async () => {
    const { vault, importing } = setUp({ [STANDUP]: meeting() });
    await importing(STANDUP);
    const edited = (vault.files.get(STANDUP) ?? '').replace('moves a week', 'moves two weeks');
    vault.files.set(STANDUP, edited);

    await expect(
      undoMeetingTermCorrections({ ports: vault.ports, path: createVaultPath(STANDUP) }),
    ).rejects.toThrow(
      new CorrectionRefusedError(
        'The meeting changed since its words were corrected, so they were left as they are.',
      ),
    );
    expect(vault.files.get(STANDUP)).toBe(edited);
  });

  it('is refused while the meeting is open with unsaved typing', async () => {
    const corrected = setUp({ [STANDUP]: meeting() });
    await corrected.importing(STANDUP);
    const text = corrected.vault.files.get(STANDUP) ?? '';
    const { vault } = setUp({ [STANDUP]: text }, { dirty: [STANDUP] });

    await expect(
      undoMeetingTermCorrections({ ports: vault.ports, path: createVaultPath(STANDUP) }),
    ).rejects.toBeInstanceOf(UnsavedTypingError);
    expect(vault.files.get(STANDUP)).toBe(text);
  });
});

describe('correctMeetingTerms, the pipeline’s step', () => {
  const path = createVaultPath(STANDUP);

  it('corrects a meeting and returns the change list it wrote', async () => {
    const { vault, body } = setUp({ [STANDUP]: meeting() });

    const result = await correctMeetingTerms({ ports: vault.ports, path });

    expect(result.written).toBe(true);
    expect(result.records.map(({ from, to, count }) => [from, to, count])).toEqual([
      ['Lark Spur Pay', 'Larkspur Pay', 2],
      ['Mara Quil', 'Mara Quill', 1],
    ]);
    expect(body(STANDUP)).toBe(CLEAN_BODY);
  });

  it('never corrects a meeting twice, nor one whose corrections were undone', async () => {
    const { vault } = setUp({ [STANDUP]: meeting() });
    const first = await correctMeetingTerms({ ports: vault.ports, path });
    const corrected = vault.files.get(STANDUP);

    const again = await correctMeetingTerms({ ports: vault.ports, path });
    expect(again).toEqual({ records: first.records, written: false });
    expect(vault.files.get(STANDUP)).toBe(corrected);

    await undoMeetingTermCorrections({ ports: vault.ports, path });
    const undone = vault.files.get(STANDUP);
    expect(await correctMeetingTerms({ ports: vault.ports, path })).toEqual({
      records: [],
      written: false,
    });
    expect(vault.files.get(STANDUP)).toBe(undone);
  });

  it('does not write a meeting with nothing to correct', async () => {
    const { vault } = setUp({ [STANDUP]: meeting(CLEAN_BODY) });
    const before = vault.files.get(STANDUP);

    expect(await correctMeetingTerms({ ports: vault.ports, path })).toEqual({
      records: [],
      written: false,
    });
    expect(vault.files.get(STANDUP)).toBe(before);
  });

  it('leaves a meeting the import marked as read alone', async () => {
    const { vault, importing } = setUp({ [STANDUP]: meeting(CLEAN_BODY) });
    await importing(STANDUP);
    const marked = vault.files.get(STANDUP);

    expect(await correctMeetingTerms({ ports: vault.ports, path })).toEqual({
      records: [],
      written: false,
    });
    expect(vault.files.get(STANDUP)).toBe(marked);
  });

  it('refuses a note that is not a meeting', async () => {
    const { vault } = setUp({ 'Notes/Plan.md': jsonNote({ type: 'note' }, MISHEARD_BODY) });

    await expect(
      correctMeetingTerms({ ports: vault.ports, path: createVaultPath('Notes/Plan.md') }),
    ).rejects.toBeInstanceOf(CorrectionRefusedError);
  });
});

describe('meetingTextAsCorrected, what a step before the stamp reads', () => {
  it('reads a meeting not corrected yet with its spellings put right, its frontmatter as it is, and writes nothing', async () => {
    const { vault } = setUp({ [STANDUP]: meeting() });
    const text = vault.files.get(STANDUP)!;

    const read = await meetingTextAsCorrected({ ports: vault.ports, text });

    expect(read).toBe(splitFrontmatter(text).frontmatter + CLEAN_BODY);
    expect(vault.files.get(STANDUP)).toBe(text);
    expect(vault.log).toEqual([]);
  });

  it('reads a meeting with nothing misheard as it is', async () => {
    const { vault } = setUp({ [STANDUP]: meeting(CLEAN_BODY) });
    const text = vault.files.get(STANDUP)!;

    expect(await meetingTextAsCorrected({ ports: vault.ports, text })).toBe(text);
  });

  it('reads a meeting whose corrections were undone as it is, without asking for the vocabulary', async () => {
    const undone = meeting(MISHEARD_BODY, { ...MEETING_HEADER, atlas_corrections: 'undone' });
    const { vault } = setUp({ [STANDUP]: undone });
    const asked: string[] = [];
    const index: Pick<typeof vault.ports.index, 'query'> = {
      query: (sql, parameters) => {
        asked.push(sql);
        return vault.ports.index.query(sql, parameters);
      },
    };

    const read = await meetingTextAsCorrected({
      ports: { markdown: vault.ports.markdown, index },
      text: undone,
    });

    expect(read).toBe(undone);
    expect(asked).toEqual([]);
  });
});
