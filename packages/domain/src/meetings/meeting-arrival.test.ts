import { describe, expect, it } from 'vitest';
import type { NoteChange } from '../index/note-changes.ts';
import {
  importErrorText,
  isMeetingInboxPath,
  meetingCandidates,
  meetingCopies,
} from './meeting-arrival.ts';
import { bodyError, frontmatterError } from './meeting-import-error.ts';

const change = (kind: NoteChange['kind'], path: string, digest = `d-${path}`): NoteChange => ({
  kind,
  path,
  type: 'meeting',
  digest,
});

describe('isMeetingInboxPath', () => {
  it('is where meeting files land, at any depth and in any case', () => {
    expect(isMeetingInboxPath('Inbox/Meetings/2026-10-06 Standup.md')).toBe(true);
    expect(isMeetingInboxPath('inbox/meetings/Deeper/Standup.md')).toBe(true);
  });

  it('is not the Inbox itself, a lookalike folder, or the Archive', () => {
    expect(isMeetingInboxPath('Inbox/Standup.md')).toBe(false);
    expect(isMeetingInboxPath('Inbox/Meetings old/Standup.md')).toBe(false);
    expect(isMeetingInboxPath('Projects/Inbox/Meetings/Standup.md')).toBe(false);
    expect(isMeetingInboxPath('Archive/Inbox/Meetings/Standup.md')).toBe(false);
  });
});

describe('meetingCandidates', () => {
  it('takes a note added where meetings land as arrived, and one changed there as changed', () => {
    expect(
      meetingCandidates([
        change('added', 'Inbox/Meetings/A.md', 'a1'),
        change('changed', 'Inbox/Meetings/B.md', 'b2'),
      ]),
    ).toEqual([
      { path: 'Inbox/Meetings/A.md', digest: 'a1', kind: 'arrived' },
      { path: 'Inbox/Meetings/B.md', digest: 'b2', kind: 'changed' },
    ]);
  });

  it('leaves out notes elsewhere, and notes that went', () => {
    expect(
      meetingCandidates([
        change('added', 'Projects/Kickoff.md'),
        change('changed', 'Archive/Inbox/Meetings/A.md'),
        change('removed', 'Inbox/Meetings/Gone.md'),
      ]),
    ).toEqual([]);
  });

  it('takes a note brought back from the Archive as no arrival, numbered or not', () => {
    expect(
      meetingCandidates([
        change('removed', 'Archive/Inbox/Meetings/Standup.md', 'stamped'),
        change('added', 'Inbox/Meetings/Standup.md', 'unstamped'),
        change('removed', 'Archive/Inbox/Meetings/Retro.md', 'stamped-2'),
        change('added', 'inbox/meetings/Retro 2.md', 'unstamped-2'),
        change('added', 'Inbox/Meetings/Fresh.md', 'fresh'),
      ]),
    ).toEqual([{ path: 'Inbox/Meetings/Fresh.md', digest: 'fresh', kind: 'arrived' }]);
  });

  it('pairs a restore only with a note that went from the Archive', () => {
    expect(
      meetingCandidates([
        change('removed', 'Projects/Standup.md', 'old'),
        change('added', 'Inbox/Meetings/Standup.md', 'new'),
      ]),
    ).toEqual([{ path: 'Inbox/Meetings/Standup.md', digest: 'new', kind: 'arrived' }]);
  });

  it('takes a note that came with the same bytes another went with as a move, not an arrival', () => {
    expect(
      meetingCandidates([
        change('removed', 'Inbox/Meetings/Old name.md', 'same'),
        change('added', 'Inbox/Meetings/New name.md', 'same'),
        change('added', 'Inbox/Meetings/Fresh.md', 'other'),
      ]),
    ).toEqual([{ path: 'Inbox/Meetings/Fresh.md', digest: 'other', kind: 'arrived' }]);
  });
});

describe('importErrorText', () => {
  it('names each problem on one line: a key by itself, a body problem by its section and line', () => {
    expect(
      importErrorText([
        frontmatterError('external_id', 'external_id is required'),
        bodyError('Summary', '## Summary is out of\n  order', 9),
        bodyError('Transcript', 'Line 15: the turn has no block id', 15),
      ]),
    ).toBe(
      'external_id is required; Summary: line 9: ## Summary is out of order; Transcript: Line 15: the turn has no block id',
    );
  });

  it('names the first three and counts the rest', () => {
    const errors = ['a', 'b', 'c', 'd', 'e'].map((key) => frontmatterError(key, `${key} is wrong`));
    expect(importErrorText(errors)).toBe('a is wrong; b is wrong; c is wrong; and 2 more');
  });

  it('still says something when no problem was named', () => {
    expect(importErrorText([])).toBe('It does not follow meeting/v1.');
  });
});

describe('meetingCopies', () => {
  const PRIMARY = 'Inbox/Meetings/2026-10-06 Standup.md';
  const COLLISION = 'Inbox/Meetings/2026-10-06 Standup (gemini 1a2b3c4d).md';

  it('keeps the only holder, with no copies', () => {
    expect(meetingCopies([PRIMARY])).toEqual({ original: PRIMARY, copies: [] });
  });

  it('keeps the path the mapping writes first over the one it writes when that is taken', () => {
    expect(meetingCopies([COLLISION, PRIMARY])).toEqual({
      original: PRIMARY,
      copies: [COLLISION],
    });
  });

  it('decides the same whatever order the holders come in', () => {
    const holders = [COLLISION, 'Inbox/Meetings/A.md', PRIMARY, 'Inbox/Meetings/B (x 0f0f0f0f).md'];
    const answers = [
      holders,
      [...holders].reverse(),
      [holders[2]!, holders[0]!, holders[3]!, holders[1]!],
    ].map(meetingCopies);
    expect(answers[0]).toEqual({
      original: PRIMARY,
      copies: ['Inbox/Meetings/A.md', COLLISION, 'Inbox/Meetings/B (x 0f0f0f0f).md'],
    });
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
  });

  it('keeps a meeting filed elsewhere, then one archived, over any where meetings land', () => {
    expect(
      meetingCopies([PRIMARY, 'Archive/Projects/Standup.md', 'Projects/Larkspur/Standup.md']),
    ).toEqual({ original: 'Projects/Larkspur/Standup.md', copies: [PRIMARY] });
    expect(meetingCopies([COLLISION, PRIMARY, 'Archive/Inbox/Meetings/Old.md'])).toEqual({
      original: 'Archive/Inbox/Meetings/Old.md',
      copies: [PRIMARY, COLLISION],
    });
  });

  it('never makes a copy of a holder filed or archived elsewhere', () => {
    expect(meetingCopies(['Projects/B.md', 'Projects/A.md', 'Archive/Projects/C.md'])).toEqual({
      original: 'Projects/A.md',
      copies: [],
    });
  });

  it('counts a holder named twice once', () => {
    expect(meetingCopies([PRIMARY, PRIMARY])).toEqual({ original: PRIMARY, copies: [] });
  });
});
