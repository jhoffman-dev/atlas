import { describe, expect, it } from 'vitest';
import { meetingTurnsOf } from '../meetings/meeting-turns.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  CLAUDE_NOTE_CHARACTERS,
  CLAUDE_ASKS_PER_RUN,
  CLAUDE_TOTAL_NOTE_CHARACTERS,
  claudeAsks,
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

describe('a meeting read in parts (P29-05)', () => {
  const SECTIONS = '---\ntype: meeting\n---\n\n## Summary\n\nWe ship on Friday.\n\n## Transcript\n';
  /** A meeting of `turns` turns, each about 400 characters. */
  const meetingOf = (turns: number, path = MEETING): AnsweredNote => {
    let text = SECTIONS;
    for (let id = 1; id <= turns; id += 1) text += turn(id, `Turn ${id}. ${'word '.repeat(70)}`);
    return { path, text, meeting: { identity: null } };
  };
  const idsIn = (text: string) =>
    [...text.matchAll(/\^t(\d{4})$/gm)].map((match) => Number(match[1]));

  it('asks once about all the notes, each cut to its share, when the output does not read in parts', () => {
    const notes = [meetingOf(120), meetingOf(3, createVaultPath('Meetings/Short.md'))];

    const plan = claudeAsks(notes, { inParts: false });

    expect(plan.asks).toEqual([notes]);
    expect(plan.cut).toEqual(cutNotes(notes));
    expect(plan.cut).toHaveLength(1);
  });

  it('asks about each note alone, a short one whole', () => {
    const notes = [meetingOf(3), meetingOf(4, createVaultPath('Meetings/Other.md'))];

    const plan = claudeAsks(notes, { inParts: true });

    expect(plan.asks).toEqual([[notes[0]], [notes[1]]]);
    expect(plan.cut).toEqual([]);
  });

  it('reads a long meeting in parts: every turn in exactly one, in order, each part under the head and within the room', () => {
    const long = meetingOf(120);
    expect(long.text.length).toBeGreaterThan(2 * CLAUDE_NOTE_CHARACTERS);

    const plan = claudeAsks([long], { inParts: true });

    expect(plan.asks.length).toBeGreaterThan(2);
    expect(plan.cut).toEqual([]);
    const parts = plan.asks.map(([part]) => part!);
    expect(parts.flatMap((part) => idsIn(part.text))).toEqual(
      Array.from({ length: 120 }, (_, at) => at + 1),
    );
    for (const [at, part] of parts.entries()) {
      expect(part.text.length).toBeLessThanOrEqual(CLAUDE_NOTE_CHARACTERS);
      expect(part.text.startsWith(SECTIONS)).toBe(true);
      expect(part.text).toContain(`(Part ${at + 1} of ${parts.length} of this transcript.`);
      expect(part.path).toBe(MEETING);
      expect(part.meeting).toEqual(long.meeting);
      // Shown as it is: the prompt's own cut has nothing left to take.
      expect(shownNotes([part])[0]!.text).toBe(part.text);
    }
    // A turn of one part cannot be cited from another.
    const last = idsIn(parts[0]!.text).at(-1)!;
    expect(cites(parts[0]!, `t${String(last).padStart(4, '0')}`)).toBe(true);
    expect(cites(parts[1]!, `t${String(last).padStart(4, '0')}`)).toBe(false);
  });

  it('stops at the most asks one run makes, and says how much of the meeting no ask showed', () => {
    const endless = meetingOf(700);

    const plan = claudeAsks([endless], { inParts: true });

    expect(plan.asks).toHaveLength(CLAUDE_ASKS_PER_RUN);
    expect(plan.cut).toHaveLength(1);
    const [cut] = plan.cut;
    expect(cut).toMatchObject({ path: MEETING, of: endless.text.length });
    const shown = plan.asks.flatMap(([part]) => idsIn(part!.text));
    expect(shown).toEqual(Array.from({ length: shown.length }, (_, at) => at + 1));
    expect(shown.length).toBeLessThan(700);
    // What it says was read is what the asks held: the head once, and each shown turn.
    expect(cut!.shown).toBeGreaterThan(shown.length * 250);
    expect(cut!.shown).toBeLessThan(CLAUDE_ASKS_PER_RUN * CLAUDE_NOTE_CHARACTERS);
  });

  it('stops at the step’s own budget when it is given one, leaving room for a reduce ask (#179)', () => {
    const endless = meetingOf(700);

    const plan = claudeAsks([endless], { inParts: true, asks: 9 });

    expect(plan.asks).toHaveLength(9);
    expect(plan.cut.map((cut) => cut.path)).toEqual([MEETING]);
  });

  it('gives every note its ask before a long meeting takes the rest', () => {
    const others = Array.from({ length: 4 }, (_, at) =>
      meetingOf(2, createVaultPath(`Meetings/Short ${at}.md`)),
    );
    const endless = meetingOf(700);

    const plan = claudeAsks([endless, ...others], { inParts: true });

    expect(plan.asks).toHaveLength(CLAUDE_ASKS_PER_RUN);
    expect(plan.asks.filter(([part]) => part!.path === MEETING)).toHaveLength(
      CLAUDE_ASKS_PER_RUN - 4,
    );
    expect(plan.asks.slice(-4).map(([part]) => part)).toEqual(others);
    expect(plan.cut.map((cut) => cut.path)).toEqual([MEETING]);
  });

  it('leaves a turn too long for any part out of them all, and says the meeting was not read whole', () => {
    const text = `${SECTIONS}${turn(1, 'First.')}${turn(2, 'x'.repeat(CLAUDE_NOTE_CHARACTERS))}${turn(3, 'Last.')}`;

    const plan = claudeAsks([asMeeting(text)], { inParts: true });

    expect(plan.asks.flatMap(([part]) => idsIn(part!.text))).toEqual([1, 3]);
    expect(plan.cut).toHaveLength(1);
    expect(plan.cut[0]!.shown).toBeLessThan(1_000);
  });

  it('skips a note with no transcript turn to cite, and says why, instead of asking about it', () => {
    const unheaded = asMeeting(meetingOf(120).text.replace('## Transcript', '## Words'));
    const plain: AnsweredNote = { path: MEETING, text: 'line\n'.repeat(10_000) };

    for (const note of [unheaded, plain]) {
      const plan = claudeAsks([note], { inParts: true });

      expect(plan.asks).toEqual([]);
      expect(plan.skipped).toEqual([
        { path: note.path, reason: expect.stringContaining('no transcript turn') },
      ]);
    }
  });

  it('closes a fence the trimmed Notes opened, and keeps the head within its budget', () => {
    const notes = `- ${'a note line '.repeat(8)}\n`.repeat(400);
    const text = meetingOf(120).text.replace(
      '## Transcript',
      `## Notes\n\n\`\`\`\n${notes}\`\`\`\n\n## Transcript`,
    );

    const plan = claudeAsks([asMeeting(text)], { inParts: true });

    expect(plan.asks.length).toBeGreaterThan(1);
    for (const [part] of plan.asks) {
      const head = part!.text.slice(0, part!.text.indexOf('## Transcript'));
      expect(head.length).toBeLessThan(CLAUDE_NOTE_CHARACTERS / 2);
      expect((head.match(/^```/gm) ?? []).length % 2).toBe(0);
      expect(part!.text.length).toBeLessThanOrEqual(CLAUDE_NOTE_CHARACTERS);
      expect(meetingTurnsOf(part!.text).length).toBeGreaterThan(0);
    }
  });

  it('quotes the last two turns of the part before at the start of the next, and they cannot be cited', () => {
    const plan = claudeAsks([meetingOf(120)], { inParts: true });
    const [first, second] = plan.asks.map(([part]) => part!);
    const lastBefore = idsIn(first!.text).slice(-2);

    const quoted = second!.text.split('\n').filter((line) => line.startsWith('> '));
    expect(quoted.join('\n')).toContain(`Turn ${lastBefore[0]}.`);
    expect(quoted.join('\n')).toContain(`Turn ${lastBefore[1]}.`);
    expect(quoted.join('\n')).not.toMatch(/\^t\d+/);
    expect(meetingTurnsOf(second!.text).map((turn) => turn.blockId)).not.toContain(
      `t${String(lastBefore[1]).padStart(4, '0')}`,
    );
    expect(first!.text).not.toContain('\n> ');
  });

  it('reads a long meeting saved with Windows line endings in parts too', () => {
    const long = meetingOf(120);
    const crlf = { ...long, text: long.text.replace(/\n/g, '\r\n') };

    const plan = claudeAsks([crlf], { inParts: true });

    expect(plan.asks.length).toBeGreaterThan(2);
    expect(plan.cut).toEqual([]);
    const parts = plan.asks.map(([part]) => part!);
    expect(parts.flatMap((part) => idsIn(part.text.replace(/\r/g, '')))).toEqual(
      Array.from({ length: 120 }, (_, at) => at + 1),
    );
    for (const part of parts) {
      expect(shownNotes([part])[0]!.text).toBe(part.text);
      expect(
        cites(part, `t${String(idsIn(part.text.replace(/\r/g, ''))[0]).padStart(4, '0')}`),
      ).toBe(true);
    }
  });

  it('asks nothing about no notes', () => {
    expect(claudeAsks([], { inParts: true })).toEqual({ asks: [], cut: [], skipped: [] });
  });
});
