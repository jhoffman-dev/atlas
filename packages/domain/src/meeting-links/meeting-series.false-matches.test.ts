/**
 * #227: when the series rule is unsure, it does not file. A wrong project
 * written at high confidence is the failure that matters, so a twin needs the
 * same title and the same people, a series much the same people, the owner is
 * never what two meetings share, and a series that moved to a closed project
 * does not revive an older one. Found by the adversarial review of PR #228.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import type { DirectoryPerson } from './attendee-matching.ts';
import {
  isOwnerKnown,
  meetingParticipants,
  participantOwnerOf,
  suggestMeetingProject,
  type FiledProject,
  type SeriesMeeting,
} from './meeting-series.ts';

const p = createVaultPath;
const LEDGER: FiledProject = { path: p('Projects/Ledger.md'), title: 'Ledger' };
const PAYRUN: FiledProject = { path: p('Projects/Payrun.md'), title: 'Payrun' };
const MARA = 'email:mara@larkspur.example';
const TOBIAS = 'email:tobias@larkspur.example';
const ODETTE = 'email:odette@larkspur.example';
const IVO = 'email:ivo@larkspur.example';

let made = 0;
function meeting(more: Partial<SeriesMeeting> = {}): SeriesMeeting {
  made += 1;
  return {
    path: p(`Meetings/${more.date ?? '2026-10-01'} Adv ${made}.md`),
    title: '1:1',
    date: '2026-10-01',
    start: '10:00',
    provider: 'gemini',
    participants: [MARA],
    project: null,
    filed: more.project !== undefined && more.project !== null,
    ...more,
  };
}

const suggest = (
  target: SeriesMeeting,
  others: readonly SeriesMeeting[],
  { ownerKnown = true }: { ownerKnown?: boolean } = {},
) => suggestMeetingProject({ meeting: target, others, ownerKnown });

describe('a twin is the same title and the same people, started less than 15 minutes apart', () => {
  it('back-to-back 1:1s with different people are not one meeting, though they share a generic title', () => {
    // 10:00 1:1 with Mara recorded by Gemini, filed under Ledger;
    // 10:15 1:1 with Tobias recorded by Granola: a different meeting.
    const withMara = meeting({
      date: '2026-10-14',
      start: '10:00',
      participants: [MARA],
      project: LEDGER,
    });
    const withTobias = meeting({
      date: '2026-10-14',
      start: '10:15',
      provider: 'granola',
      participants: [TOBIAS],
    });
    // Before the fix: { project: Ledger, confidence: 'high', via: 'twin' } — arrival files it under Ledger.
    expect(suggest(withTobias, [withMara])).toBeNull();
  });

  it('a different meeting with one shared colleague 15 minutes later is not a twin', () => {
    const review = meeting({
      date: '2026-10-14',
      start: '10:00',
      title: 'Ledger review',
      participants: [MARA, TOBIAS],
      project: LEDGER,
    });
    const debrief = meeting({
      date: '2026-10-14',
      start: '10:15',
      title: 'Hiring debrief',
      provider: 'granola',
      participants: [MARA, ODETTE],
    });
    // Before the fix: high twin -> Ledger.
    expect(suggest(debrief, [review])?.confidence).not.toBe('high');
  });
});

describe('a series is the same title and much the same people', () => {
  it("a generic title shared by two teams with one common colleague does not borrow the other team's project", () => {
    // Team A standup (Mara, Tobias, Ivo) daily under Ledger; team B standup (Ivo, Odette) weekly under Payrun.
    const teamA = ['09', '10', '11', '12', '13'].map((day) =>
      meeting({
        title: 'Standup',
        date: `2026-10-${day}`,
        participants: [MARA, TOBIAS, IVO],
        project: LEDGER,
      }),
    );
    const teamBLastWeek = meeting({
      title: 'Standup',
      date: '2026-10-07',
      participants: [IVO, ODETTE],
      project: PAYRUN,
    });
    const teamBToday = meeting({
      title: 'Standup',
      date: '2026-10-14',
      participants: [IVO, ODETTE],
    });
    // Before the fix: Ledger at high (5 of 6 days), auto-filed on arrival — team B's own series says Payrun.
    const got = suggest(teamBToday, [...teamA, teamBLastWeek]);
    expect(got === null || got.project === PAYRUN.path || got.confidence !== 'high').toBe(true);
  });

  it('a series whose recent project closed does not revive a months-old project at high confidence', () => {
    // January: three meetings under Ledger (still open, long stale).
    // September-October: filed under a project now done — filed, but under nothing open.
    const january = ['2026-01-06', '2026-01-13', '2026-01-20'].map((date) =>
      meeting({ title: 'Larkspur Sync', date, participants: [MARA], project: LEDGER }),
    );
    const sinceThen = ['2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06'].map((date) =>
      meeting({ title: 'Larkspur Sync', date, participants: [MARA], project: null, filed: true }),
    );
    const today = meeting({ title: 'Larkspur Sync', date: '2026-10-13', participants: [MARA] });
    // Before the fix: { project: Ledger, confidence: 'high' } from meetings nine months old.
    expect(suggest(today, [...january, ...sinceThen])?.confidence).not.toBe('high');
  });
});

describe('the owner is left out by every name their Person note gives', () => {
  const owner: DirectoryPerson = {
    path: p('People/Jonas Varga.md'),
    name: 'Jonas Varga',
    emails: [],
    aliases: ['Joe Varga'],
    company: null,
  };

  it('leaves the owner out of participants when an attendee list names them by their Person note alias', () => {
    const me = participantOwnerOf({ people: [owner], selfName: 'Jonas Varga', selfEmails: [] });
    const participants = meetingParticipants({
      attendees: [
        { name: 'Joe Varga', email: null, group: false },
        { name: 'Mara Quill', email: null, group: false },
      ],
      people: [],
      owner: me,
    });
    // Before the fix: ['name:joe varga', 'name:mara quill'] — the owner is a shared participant of every meeting.
    expect(participants).toEqual(['name:mara quill']);
  });

  it('so every "1:1" in the vault is not one series through the owner', () => {
    const me = participantOwnerOf({ people: [owner], selfName: 'Jonas Varga', selfEmails: [] });
    const who = (name: string) =>
      meetingParticipants({
        attendees: [
          { name: 'Joe Varga', email: null, group: false },
          { name, email: null, group: false },
        ],
        people: [],
        owner: me,
      });
    const withMara = ['2026-10-06', '2026-10-08', '2026-10-10'].map((date) =>
      meeting({ date, participants: who('Mara Quill'), project: LEDGER }),
    );
    const withOdette = meeting({ date: '2026-10-13', participants: who('Odette Brun') });
    // Before the fix: Ledger at high — Odette's 1:1 auto-filed under Mara's project.
    expect(suggest(withOdette, withMara)?.confidence).not.toBe('high');
  });
});

describe('two twins filed apart', () => {
  it('is not sure when two other copies, equally near, are filed under different projects', () => {
    const a = meeting({ date: '2026-10-14', start: '10:05', provider: 'gemini', project: LEDGER });
    const b = meeting({ date: '2026-10-14', start: '09:55', provider: 'fathom', project: PAYRUN });
    const copy = meeting({ date: '2026-10-14', start: '10:00', provider: 'granola' });
    // Before the fix: high, whichever comes first in the list.
    expect(suggest(copy, [a, b])?.confidence).not.toBe('high');
  });
});

describe('the twin rule, at its edges', () => {
  const copy = (more: Partial<SeriesMeeting> = {}) =>
    meeting({
      title: 'Ledger review',
      date: '2026-10-14',
      start: '10:00',
      provider: 'granola',
      ...more,
    });
  const filed = (more: Partial<SeriesMeeting> = {}) =>
    meeting({ title: 'Ledger review', date: '2026-10-14', project: LEDGER, ...more });

  it('is a twin 14 minutes apart, and none 15 minutes apart', () => {
    expect(suggest(copy(), [filed({ start: '10:14' })])).toMatchObject({
      via: 'twin',
      confidence: 'high',
    });
    expect(suggest(copy(), [filed({ start: '10:15' })])?.via).not.toBe('twin');
  });

  it('is never a twin by its people alone, under another title', () => {
    expect(suggest(copy(), [filed({ start: '10:05', title: 'Payrun review' })])).toBeNull();
  });

  it('is never a twin by a generic title alone, though one side lists nobody', () => {
    const standup = (more: Partial<SeriesMeeting>) => ({ title: 'Daily Standup', ...more });
    expect(
      suggest(copy(standup({ participants: [] })), [filed(standup({ start: '10:05' }))]),
    ).toBeNull();
  });

  it('takes the twin by a specific title when one side lists nobody', () => {
    expect(suggest(copy({ participants: [] }), [filed({ start: '10:05' })])).toMatchObject({
      via: 'twin',
      confidence: 'high',
    });
  });

  it('names the nearest of two twins that agree', () => {
    const near = filed({ start: '10:02', provider: 'fathom' });
    const far = filed({ start: '09:50' });
    expect(suggest(copy(), [far, near])).toMatchObject({
      via: 'twin',
      confidence: 'high',
      reason: expect.stringContaining('fathom') as unknown,
    });
  });

  it('gives no twin answer when its copy is filed under a closed project', () => {
    const closed = filed({ start: '10:05', project: null, filed: true });
    expect(suggest(copy(), [closed])).toBeNull();
  });
});

describe('the series rule, at its edges', () => {
  const on = (day: number, more: Partial<SeriesMeeting>) =>
    meeting({ title: 'Ledger review', date: `2026-10-${String(day).padStart(2, '0')}`, ...more });

  it('takes half the people shared as one series, and less than half as none', () => {
    const series = (participants: readonly string[]) =>
      [1, 2, 3].map((day) => on(day, { participants, project: LEDGER }));
    const today = on(14, { participants: [MARA, TOBIAS] });
    expect(suggest(today, series([MARA]))).toMatchObject({
      project: LEDGER.path,
      confidence: 'high',
    });
    expect(suggest(today, series([MARA, TOBIAS, ODETTE]))?.confidence).toBe('high');
    expect(suggest(today, series([MARA, ODETTE]))).toBeNull();
  });

  it('compares the Person notes both link before the names one notetaker lists', () => {
    const series = [1, 2, 3].map((day) =>
      on(day, { participants: ['note:people/mara quill.md', ODETTE, IVO], project: LEDGER }),
    );
    const today = on(14, { participants: ['note:people/mara quill.md', MARA] });
    expect(suggest(today, series)).toMatchObject({ project: LEDGER.path, confidence: 'high' });
  });

  it('never forms a series by a generic title alone', () => {
    const series = [1, 2, 3].map((day) =>
      meeting({ title: 'Weekly Sync', date: `2026-10-0${day}`, participants: [], project: LEDGER }),
    );
    expect(suggest(meeting({ title: 'Weekly Sync', date: '2026-10-14' }), series)).toBeNull();
  });

  it('suggests nothing when most of its latest days are filed under a closed project', () => {
    const closed = [8, 9, 10, 11].map((day) => on(day, { project: null, filed: true }));
    const open = [1, 2].map((day) => on(day, { project: LEDGER }));
    expect(suggest(on(14, {}), [...closed, ...open])).toBeNull();
  });

  it('is low when its nearest day is filed under a closed project, though most are open', () => {
    const open = [7, 8, 9, 10].map((day) => on(day, { project: LEDGER }));
    const closed = on(13, { project: null, filed: true });
    expect(suggest(on(14, {}), [...open, closed])).toMatchObject({
      project: LEDGER.path,
      confidence: 'low',
    });
  });

  it('never counts a meeting filed under nothing at all', () => {
    const open = [7, 8, 9].map((day) => on(day, { project: LEDGER }));
    const unfiled = on(13, { project: null, filed: false });
    expect(suggest(on(14, {}), [...open, unfiled])?.confidence).toBe('high');
  });
});

describe('an owner who cannot be told', () => {
  it('is known by a name, an address or a Person note, and unknown by none', () => {
    expect(isOwnerKnown(participantOwnerOf({ people: [], selfName: null, selfEmails: [] }))).toBe(
      false,
    );
    expect(isOwnerKnown(participantOwnerOf({ people: [], selfName: 'Ivo', selfEmails: [] }))).toBe(
      true,
    );
    expect(
      isOwnerKnown(participantOwnerOf({ people: [], selfName: null, selfEmails: ['i@x.example'] })),
    ).toBe(true);
  });

  it('makes neither a twin nor a series sure enough to file by itself', () => {
    const series = ['2026-10-06', '2026-10-08', '2026-10-10'].map((date) =>
      meeting({ title: 'Ledger review', date, project: LEDGER }),
    );
    const today = meeting({ title: 'Ledger review', date: '2026-10-13' });
    expect(suggest(today, series)?.confidence).toBe('high');
    expect(suggest(today, series, { ownerKnown: false })).toMatchObject({
      project: LEDGER.path,
      confidence: 'medium',
    });
    const twin = meeting({
      title: 'Ledger review',
      date: '2026-10-13',
      provider: 'granola',
      project: LEDGER,
    });
    expect(suggest(today, [twin], { ownerKnown: false })).toMatchObject({
      via: 'twin',
      confidence: 'medium',
    });
  });

  it('leaves out the owner by an address on their Person note, though the vault keeps others', () => {
    const owner: DirectoryPerson = {
      path: p('People/Jonas Varga.md'),
      name: 'Jonas Varga',
      emails: ['jonas@old.example'],
      aliases: [],
      company: null,
    };
    const me = participantOwnerOf({
      people: [owner],
      selfName: 'Jonas Varga',
      selfEmails: ['jv@new.example'],
    });
    const participants = meetingParticipants({
      attendees: [
        { name: 'J. V.', email: 'jonas@old.example', group: false },
        { name: 'J. V.', email: 'jv@new.example', group: false },
        { name: 'Mara Quill', email: 'mara@larkspur.example', group: false },
      ],
      people: [p('People/Jonas Varga.md')],
      owner: me,
    });
    expect(participants).toEqual([MARA]);
  });
});
