import { describe, expect, it } from 'vitest';
import type { NoteChange } from '../index/note-changes.ts';
import {
  duplicateDecision,
  importErrorText,
  isMeetingInboxPath,
  meetingCandidates,
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

describe('duplicateDecision', () => {
  const none = new Set<string>();

  it('is the original when nothing else holds its id', () => {
    expect(duplicateDecision({ path: 'Inbox/Meetings/A.md', holders: [], pending: none })).toEqual({
      kind: 'original',
    });
    expect(
      duplicateDecision({
        path: 'Inbox/Meetings/A.md',
        holders: ['Inbox/Meetings/A.md'],
        pending: none,
      }),
    ).toEqual({ kind: 'original' });
  });

  it('is a duplicate of a note that already held its id', () => {
    expect(
      duplicateDecision({
        path: 'Inbox/Meetings/A (gemini 1a2b3c4d).md',
        holders: ['Inbox/Meetings/A (gemini 1a2b3c4d).md', 'Inbox/Meetings/A.md'],
        pending: none,
      }),
    ).toEqual({ kind: 'duplicate', of: 'Inbox/Meetings/A.md' });
  });

  it('of two arriving together, makes the first decided the original and the second its copy', () => {
    const first = 'Inbox/Meetings/A.md';
    const second = 'Inbox/Meetings/A 2.md';
    const holders = [first, second];
    expect(duplicateDecision({ path: first, holders, pending: new Set([second]) })).toEqual({
      kind: 'original',
    });
    expect(duplicateDecision({ path: second, holders, pending: none })).toEqual({
      kind: 'duplicate',
      of: first,
    });
  });

  it('prefers a holder outside the Archive, then the first by path', () => {
    expect(
      duplicateDecision({
        path: 'Inbox/Meetings/New.md',
        holders: ['Archive/Projects/A.md', 'Projects/Z.md', 'Projects/B.md'],
        pending: none,
      }),
    ).toEqual({ kind: 'duplicate', of: 'Projects/B.md' });
  });

  it('takes an archived meeting as the original when it is the only holder', () => {
    expect(
      duplicateDecision({
        path: 'Inbox/Meetings/A.md',
        holders: ['Archive/Projects/A.md'],
        pending: none,
      }),
    ).toEqual({ kind: 'duplicate', of: 'Archive/Projects/A.md' });
  });
});
