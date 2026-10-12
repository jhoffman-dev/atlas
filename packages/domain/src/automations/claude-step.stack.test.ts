/**
 * What the adversarial pass over the stacked post-processing (#92, P28-06,
 * P29-04, P29-03) found in the domain's rules for a Claude step, each as the
 * rule it should have held: a meeting cut by turns whatever its line endings,
 * words answered once wherever their note is filed, a proposal known by what
 * it cites and not by how the citation was written, and a log that says what
 * a re-ask found.
 */
import { describe, expect, it } from 'vitest';
import { automationEntryReport } from '../activity/activity-reports.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  answeredMeetingOf,
  CLAUDE_NOTE_CHARACTERS,
  cutNotes,
  shownNotes,
  type AnsweredNote,
} from './answered-note.ts';
import { claudeProposalId } from './claude-proposal-id.ts';
import { handledVersions } from './note-trigger.ts';
import { checkDraft, type ProposalDraft } from './proposal-schema.ts';
import {
  formatLogEntry,
  logEntrySummary,
  parseRunLog,
  type ClaudeRunInfo,
  type LogEntry,
} from './run-log.ts';

const p = createVaultPath;

describe('a meeting with CRLF line endings, too long to show whole', () => {
  const turn = (at: number) =>
    `**Mara Quill** [~00:00:${String(at % 60).padStart(2, '0')}] ${'word '.repeat(400)}^t${String(at).padStart(4, '0')}`;
  const text = ['## Transcript', ...Array.from({ length: 30 }, (_, at) => turn(at + 1)), ''].join(
    '\r\n\r\n',
  );
  const meeting: AnsweredNote = { path: p('Meetings/Long.md'), text, meeting: { identity: null } };

  it('is cut between turns, as one with LF endings is: the model is shown whole turns to cite', () => {
    expect(text.length).toBeGreaterThan(CLAUDE_NOTE_CHARACTERS);

    const [shown] = shownNotes([meeting]);
    const [cut] = cutNotes([meeting]);

    expect(shown?.text).toContain('^t0001');
    expect(cut?.shown).toBeGreaterThan(CLAUDE_NOTE_CHARACTERS / 2);
    // Whole turns only: what is shown ends at a turn's id, before the cut mark.
    expect(shown?.text).toMatch(/\^t\d{4}\n… \(cut\)$/);
  });
});

describe('what a rule’s log says it handled, once the note has moved', () => {
  const STANDUP = p('Inbox/Meetings/2026-10-06 Standup.md');
  const FILED = p('Meetings/2026-10-06 Standup.md');
  const ran = (extra: Partial<Extract<LogEntry, { kind: 'run' }>>): LogEntry => ({
    kind: 'run',
    at: '2026-10-08T09:00:00',
    trigger: 'note',
    done: [],
    left: [],
    capped: false,
    ...extra,
  });
  const handledIt = { versions: [{ path: STANDUP, digest: 'words', wrote: false }] };
  const answered = ran({ ...handledIt, claude: { model: 'claude-opus-5-5', ms: 10 } });

  it('still counts words a Claude step answered, at whatever path they are now', () => {
    const handled = handledVersions([answered, ran({ went: [STANDUP] })]);

    expect(handled.has({ path: FILED, digest: 'words' })).toBe(true);
    expect(handled.has({ path: STANDUP, digest: 'words' })).toBe(true);
    // Other words are another question.
    expect(handled.has({ path: FILED, digest: 'edited' })).toBe(false);
  });

  it('keeps a path’s history as it was for a rule that asks no model: a new note there is new', () => {
    const handled = handledVersions([ran(handledIt), ran({ went: [STANDUP] })]);

    expect(handled.has({ path: STANDUP, digest: 'words' })).toBe(false);
    expect(handled.has({ path: FILED, digest: 'words' })).toBe(false);
  });

  it('does not count words a failed step was asked about: it is asked again', () => {
    const handled = handledVersions([
      {
        kind: 'failed',
        at: '2026-10-08T09:00:00',
        trigger: 'note',
        problem: 'No.',
        claude: { model: 'claude-opus-5-5', ms: 10 },
      },
    ]);

    expect(handled.has({ path: FILED, digest: 'words' })).toBe(false);
  });
});

const TURN =
  '\n## Transcript\n\n**Mara Quill** [~00:00:00] Send me the payroll file. ^t0001\n\nSecond. ^t0002\n';
const meetingAt = (path: string, externalId: string): AnsweredNote => ({
  path: p(path),
  text: `---\ntype: meeting\n---\n${TURN}`,
  meeting: { identity: { provider: 'gemini', externalId } },
});
const draftCiting = (source: string, extra: Partial<ProposalDraft> = {}): ProposalDraft => ({
  kind: 'task',
  payload: { title: 'Send Mara the payroll file' },
  source,
  confidence: 'high',
  why: 'Mara asked for it.',
  ...extra,
});
const idOf = (source: string, notes: readonly AnsweredNote[], extra?: Partial<ProposalDraft>) => {
  const checked = checkDraft(draftCiting(source, extra), { notes }, ['tasks']);
  if (!checked.ok) throw new Error(checked.problem);
  return claudeProposalId({ rule: 'Meeting actions', proposal: checked.value });
};

describe('a proposal’s id, and how its citation was written', () => {
  const INBOX = meetingAt('Inbox/Meetings/2026-10-06 Standup.md', 'gemini-1');
  const FILED = meetingAt('Meetings/Standup with Mara.md', 'gemini-1');
  const NOTE: AnsweredNote = { path: p('Notes/Plan.md'), text: 'Ship it. ^b1\n\nThen rest. ^b2\n' };

  it('is the same whether the model cites the note by its title or by its path', () => {
    expect(idOf('[[Inbox/Meetings/2026-10-06 Standup#^t0001]]', [INBOX])).toBe(
      idOf('[[2026-10-06 Standup#^t0001]]', [INBOX]),
    );
    expect(idOf('[[Notes/Plan.md#^b1]]', [NOTE])).toBe(idOf('[[plan#^b1]]', [NOTE]));
  });

  it('is the same for a meeting once it is renamed and filed: the meeting is its provider and id', () => {
    expect(idOf('[[Standup with Mara#^t0001]]', [FILED])).toBe(
      idOf('[[2026-10-06 Standup#^t0001]]', [INBOX]),
    );
  });

  it('differs for another block, another meeting of the same name, and another note', () => {
    const base = idOf('[[2026-10-06 Standup#^t0001]]', [INBOX]);
    const otherMeeting = meetingAt('Inbox/Meetings/2026-10-06 Standup.md', 'gemini-2');

    expect(idOf('[[2026-10-06 Standup#^t0002]]', [INBOX])).not.toBe(base);
    expect(idOf('[[2026-10-06 Standup#^t0001]]', [otherMeeting])).not.toBe(base);
    expect(idOf('[[Plan#^b1]]', [NOTE])).not.toBe(idOf('[[Plan#^b2]]', [NOTE]));
  });

  it('is by path for a meeting the import does not vouch for', () => {
    const byHand = (path: string): AnsweredNote => ({
      ...meetingAt(path, 'x'),
      meeting: { identity: null },
    });

    expect(idOf('[[A#^t0001]]', [byHand('Meetings/A.md')])).not.toBe(
      idOf('[[B#^t0001]]', [byHand('Meetings/B.md')]),
    );
  });
});

describe('a citation by a title two of the run’s notes share', () => {
  const ALDER = meetingAt('Meetings/Alder/2026-10-06 Weekly.md', 'gemini-alder');
  const LARKSPUR = meetingAt('Inbox/Meetings/2026-10-06 Weekly.md', 'gemini-larkspur');

  it('is refused, telling the model to cite the note by its path', () => {
    for (const notes of [
      [ALDER, LARKSPUR],
      [LARKSPUR, ALDER],
    ]) {
      const checked = checkDraft(draftCiting('[[2026-10-06 Weekly#^t0001]]'), { notes });
      expect(checked).toEqual({
        ok: false,
        problem:
          'Its source cites "2026-10-06 Weekly", a title 2 of the notes this run read share. Cite the note by its path, like [[Folder/Note#^id]].',
      });
    }
  });

  it('names the one meeting when cited by path, whichever was read first', () => {
    const joined = (notes: readonly AnsweredNote[]) => {
      const source = '[[Inbox/Meetings/2026-10-06 Weekly#^t0001]]';
      const checked = checkDraft(draftCiting(source, { joinsMeeting: 'tasks' }), { notes }, [
        'tasks',
      ]);
      return checked.ok ? checked.value.payload.linkFrom : checked.problem;
    };

    expect(joined([ALDER, LARKSPUR])).toMatchObject({
      note: LARKSPUR.path,
      meeting: { externalId: 'gemini-larkspur' },
    });
    expect(joined([LARKSPUR, ALDER])).toEqual(joined([ALDER, LARKSPUR]));
  });
});

describe('a Claude step that was asked again and found its proposals already made', () => {
  const RULE = { name: 'Meeting actions', path: p('.atlas/automations/M.md') };
  const asked = (claude: ClaudeRunInfo): LogEntry => ({
    kind: 'run',
    at: '2026-10-11T09:00:00',
    trigger: 'hand',
    done: [],
    left: [],
    capped: false,
    claude,
  });

  it('says there was nothing new, and how many were already made — not that Claude proposed nothing', () => {
    const entry = asked({ model: 'claude-opus-5-5', ms: 4210, alreadyMade: 2 });

    expect(logEntrySummary(entry)).toBe('Nothing new to propose (2 already made).');
    expect(automationEntryReport(RULE, entry)?.message).toContain(
      'Nothing new to propose (2 already made).',
    );
    expect(parseRunLog(formatLogEntry(entry))).toEqual([entry]);
  });

  it('still says Claude proposed nothing when it proposed nothing', () => {
    expect(logEntrySummary(asked({ model: 'claude-opus-5-5', ms: 4210 }))).toBe(
      'Claude proposed nothing.',
    );
  });
});

describe('news a held-back rule let go', () => {
  const entry: LogEntry = { kind: 'letGo', at: '2026-10-11T09:00:00', count: 3 };

  it('is written in its log with how much, and that a run by hand takes it, and reads back', () => {
    const text = formatLogEntry(entry);

    expect(text).toContain('## 2026-10-11 09:00:00 · Let news go');
    expect(text).toContain(
      'Let go of the news of 3 syncs: more arrived than it holds while it cannot run. Run it by hand to take the notes they named.',
    );
    expect(parseRunLog(text)).toEqual([entry]);
  });

  it('is said in Activity as a warning', () => {
    const report = automationEntryReport(
      { name: 'Tidy', path: p('.atlas/automations/T.md') },
      entry,
    );

    expect(report).toMatchObject({ level: 'warning', kind: 'automation' });
    expect(report?.message).toMatch(/^Tidy: Let news go\. Let go of the news of 3 syncs/);
  });
});

describe('what the run reads as a meeting', () => {
  const stamped = { atlas_import_outcome: 'imported', external_id: ' gemini-1 ' };

  it('reads the type as linking does: a list, in any case', () => {
    expect(
      answeredMeetingOf({ ...stamped, type: ['Meeting', 'note'], provider: 'gemini' }),
    ).toEqual({ identity: { provider: 'gemini', externalId: 'gemini-1' } });
    expect(answeredMeetingOf({ type: ' MEETING ' })).toEqual({ identity: null });
    expect(answeredMeetingOf({ type: 'task' })).toBeUndefined();
  });

  it('keeps the provider as written, as the meeting is found by it: only the id is trimmed', () => {
    expect(answeredMeetingOf({ ...stamped, type: 'meeting', provider: ' gemini ' })).toEqual({
      identity: { provider: ' gemini ', externalId: 'gemini-1' },
    });
    expect(answeredMeetingOf({ ...stamped, type: 'meeting', provider: '  ' })).toEqual({
      identity: null,
    });
  });
});
