import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  CLAUDE_NOTE_CHARACTERS,
  CLAUDE_TOTAL_NOTE_CHARACTERS,
  cutNotes,
  shownNotes,
  type AnsweredNote,
} from './answered-note.ts';
import { citedBlockProblem } from './proposal-schema.ts';

/**
 * A meeting's transcript can be longer than a step is shown (P29-03 on
 * P28-01's turns). It is cut between turns and never inside one, a turn past
 * the cut cannot be cited, and the run can say how much was read.
 */

const MEETING = createVaultPath('Meetings/2026-10-06 Standup.md');
const HEAD = '---\ntype: meeting\n---\n\n## Transcript\n';
const turn = (id: number, words: string) =>
  `\n**Mara Quill** [00:00:${String(id).padStart(2, '0')}] ${words} ^t${String(id).padStart(4, '0')}\n`;

/** Short turns up to near the cut, then one long turn that straddles it, then a last one. */
function longTranscript(straddling: string): string {
  let text = HEAD;
  let id = 1;
  while (text.length < CLAUDE_NOTE_CHARACTERS - 4_000) text += turn(id++, 'We ship on Friday.');
  return text + turn(9997, straddling) + turn(9998, 'And the last word.');
}

const asMeeting = (text: string): AnsweredNote => ({
  path: MEETING,
  text,
  meeting: { identity: null },
});
const cites = (note: AnsweredNote, id: string) =>
  citedBlockProblem(`[[2026-10-06 Standup#^${id}]]`, [note]) === null;

describe('a meeting longer than a step is shown', () => {
  it('is cut between turns: a turn that straddles the cut is left out whole, however long', () => {
    // Longer than the reach a partial line is dropped within: by lines, its start would be shown.
    const note = asMeeting(longTranscript(`Payroll ${'runs long '.repeat(900)}`));
    const [shown] = shownNotes([note]);

    expect(note.text.length).toBeGreaterThan(CLAUDE_NOTE_CHARACTERS);
    expect(shown!.text).toContain('^t0001');
    expect(shown!.text).not.toContain('runs long');
    expect(shown!.text).not.toContain('^t9997');
    // It ends on a whole turn: its id, then the mark.
    expect(shown!.text).toMatch(/We ship on Friday\. \^t\d{4}\n… \(cut\)$/);
    // The same note, not said to be a meeting, is cut by lines and shows the start of the turn.
    const [byLines] = shownNotes([{ path: MEETING, text: note.text }]);
    expect(byLines!.text).toContain('runs long');
  });

  it('keeps a turn of several lines together', () => {
    const lines = Array.from({ length: 120 }, () => 'and another line of the same turn').join('\n');
    const note = asMeeting(longTranscript(`It begins here\n${lines}`));
    const [shown] = shownNotes([note]);

    expect(shown!.text).not.toContain('It begins here');
    expect(shown!.text).not.toContain('another line');
  });

  it('refuses a citation of the straddling turn and of every turn past it, and takes one before', () => {
    const note = asMeeting(longTranscript(`Payroll ${'runs long '.repeat(900)}`));

    expect(cites(note, 't0001')).toBe(true);
    expect(cites(note, 't9997')).toBe(false);
    expect(cites(note, 't9998')).toBe(false);
  });

  it('shows nothing of a transcript that is one turn too long to show', () => {
    const note = asMeeting(`**Mara Quill** ${'word '.repeat(5_000)}^t0001\n`);
    expect(shownNotes([note])[0]!.text).toBe('\n… (cut)');
    expect(cites(note, 't0001')).toBe(false);
  });

  it('is shown whole when it fits, and stays the meeting it was said to be', () => {
    const note: AnsweredNote = {
      path: MEETING,
      text: HEAD + turn(1, 'Short.'),
      meeting: { identity: { provider: 'gemini', externalId: 'g-1' } },
    };
    expect(shownNotes([note])).toEqual([note]);
    expect(cutNotes([note])).toEqual([]);
  });
});

describe('which notes a run was shown only the start of', () => {
  it('says each cut note, how much was shown and how much it has', () => {
    const long = asMeeting(longTranscript(`Payroll ${'runs long '.repeat(900)}`));
    const short: AnsweredNote = { path: createVaultPath('Notes/Short.md'), text: 'Short. ^b1\n' };
    const [shown] = shownNotes([long, short]);

    expect(cutNotes([long, short])).toEqual([
      { path: MEETING, shown: shown!.text.length - '\n… (cut)'.length, of: long.text.length },
    ]);
  });

  it('counts the share each of many notes gets, not the most one alone may have', () => {
    const many = Array.from({ length: 10 }, (_, at) => ({
      path: createVaultPath(`M${at}.md`),
      text: 'z'.repeat(CLAUDE_NOTE_CHARACTERS - 1),
    }));
    // Each fits alone; ten together do not.
    expect(cutNotes([many[0]!])).toEqual([]);
    const cut = cutNotes(many);
    expect(cut).toHaveLength(10);
    expect(cut[0]).toEqual({
      path: 'M0.md',
      shown: CLAUDE_TOTAL_NOTE_CHARACTERS / 10,
      of: CLAUDE_NOTE_CHARACTERS - 1,
    });
  });
});
