import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  isOpenFiling,
  meetingParticipants,
  seriesTitle,
  suggestMeetingProject,
  type FiledProject,
  type SeriesMeeting,
} from './meeting-series.ts';

const p = createVaultPath;
const LEDGER: FiledProject = { path: p('Projects/Ledger.md'), title: 'Ledger' };
const PAYRUN: FiledProject = { path: p('Projects/Payrun.md'), title: 'Payrun' };
const OPS: FiledProject = { path: p('Areas/Operations.md'), title: 'Operations' };
const MARA = 'email:mara@larkspur.example';
const TOBIAS = 'email:tobias@larkspur.example';

let made = 0;
/** A meeting of the Larkspur standup unless said otherwise. */
function meeting(more: Partial<SeriesMeeting> = {}): SeriesMeeting {
  made += 1;
  return {
    path: p(`Meetings/${more.date ?? '2026-10-01'} Standup ${made}.md`),
    title: 'Larkspur Standup',
    date: '2026-10-01',
    start: '09:30',
    provider: 'gemini',
    participants: [MARA, TOBIAS],
    project: null,
    ...more,
  };
}

const suggest = (target: SeriesMeeting, others: readonly SeriesMeeting[]) =>
  suggestMeetingProject({ meeting: target, others });

describe('suggestMeetingProject: the twin', () => {
  it('files a copy as its twin from the other notetaker is filed: same day, close start, same people', () => {
    const twin = meeting({ date: '2026-10-14', start: '08:06', project: LEDGER, title: 'Sync' });
    const copy = meeting({
      date: '2026-10-14',
      start: '08:00',
      provider: 'granola',
      title: 'Untitled',
    });
    expect(suggest(copy, [twin])).toEqual({
      project: LEDGER.path,
      title: 'Ledger',
      confidence: 'high',
      via: 'twin',
      reason: `The same meeting as gemini’s copy, 2026-10-14 Sync, which is filed under Ledger.`,
    });
  });

  it('takes the twin over the series, even where the series says otherwise', () => {
    const twin = meeting({ date: '2026-10-14', start: '08:10', project: PAYRUN });
    const series = [1, 2, 3].map((day) =>
      meeting({ date: `2026-10-0${day}`, project: LEDGER, provider: 'granola' }),
    );
    const copy = meeting({ date: '2026-10-14', start: '08:00', provider: 'granola' });
    expect(suggest(copy, [...series, twin])).toMatchObject({ project: PAYRUN.path, via: 'twin' });
  });

  it('is no twin past 15 minutes apart, from the same provider, or with no one and nothing in common', () => {
    const copy = meeting({ date: '2026-10-14', start: '08:00', provider: 'granola' });
    const late = meeting({ date: '2026-10-14', start: '08:16', project: LEDGER, title: 'Other' });
    const same = meeting({
      date: '2026-10-14',
      start: '08:00',
      provider: 'granola',
      title: 'Other',
      project: LEDGER,
    });
    const strangers = meeting({
      date: '2026-10-14',
      start: '08:05',
      title: 'Other',
      participants: ['email:ada@example.com'],
      project: LEDGER,
    });
    expect(suggest(copy, [late, same, strangers])).toBeNull();
  });

  it('is a twin by title alone when neither lists anyone', () => {
    const twin = meeting({ date: '2026-10-14', start: '08:05', participants: [], project: OPS });
    const copy = meeting({
      date: '2026-10-14',
      start: '08:00',
      provider: 'granola',
      participants: [],
    });
    expect(suggest(copy, [twin])).toMatchObject({
      project: OPS.path,
      via: 'twin',
      confidence: 'high',
    });
  });

  it('never takes the meeting itself for its twin', () => {
    const copy = meeting({ date: '2026-10-14', project: LEDGER });
    expect(suggest(copy, [copy])).toBeNull();
  });
});

describe('suggestMeetingProject: the series', () => {
  const series = (projects: readonly (FiledProject | null)[]) =>
    projects.map((project, at) =>
      meeting({ date: `2026-09-${String(10 + at).padStart(2, '0')}`, project }),
    );

  it('files a meeting as most of its series is, saying which meeting and how many', () => {
    const target = meeting({ date: '2026-10-01' });
    const suggestion = suggest(target, series([LEDGER, LEDGER, PAYRUN, LEDGER, LEDGER]));
    expect(suggestion).toEqual({
      project: LEDGER.path,
      title: 'Ledger',
      confidence: 'high',
      via: 'series',
      reason:
        'Same series as 2026-09-14 Larkspur Standup: 4 of its last 5 were filed under Ledger.',
    });
  });

  it('reads only the latest six days: an old habit is outvoted by the recent one', () => {
    const old = series([PAYRUN, PAYRUN, PAYRUN, PAYRUN, PAYRUN, PAYRUN]).map((each, at) => ({
      ...each,
      date: `2026-05-${String(10 + at).padStart(2, '0')}`,
    }));
    const recent = series([LEDGER, LEDGER, LEDGER, LEDGER, LEDGER, LEDGER]);
    expect(suggest(meeting({ date: '2026-10-01' }), [...old, ...recent])).toMatchObject({
      project: LEDGER.path,
      confidence: 'high',
    });
  });

  it('looks both ways in time, nearest first: a backfilled meeting reads the meetings after it too', () => {
    const later = series([LEDGER, LEDGER, LEDGER]).map((each, at) => ({
      ...each,
      date: `2026-10-0${2 + at}`,
    }));
    const earlier = series([PAYRUN, PAYRUN, PAYRUN, PAYRUN]).map((each, at) => ({
      ...each,
      date: `2026-08-0${1 + at}`,
    }));
    // Six nearest: three later (Ledger) and the three latest earlier (Payrun): a tie, broken by the nearer.
    expect(suggest(meeting({ date: '2026-10-01' }), [...later, ...earlier])).toMatchObject({
      project: LEDGER.path,
      confidence: 'low',
    });
  });

  it('is low on a tie, which the nearest meeting breaks', () => {
    const suggestion = suggest(
      meeting({ date: '2026-10-01' }),
      series([LEDGER, PAYRUN, LEDGER, PAYRUN]),
    );
    // The nearest (2026-09-13) is Payrun.
    expect(suggestion).toMatchObject({ project: PAYRUN.path, confidence: 'low' });
  });

  it('is low when its days are filed two ways at once, however many of them agree', () => {
    const copies = series([LEDGER, LEDGER, LEDGER]).map((each) => ({
      ...each,
      path: p(`${each.path}.copy.md`),
      provider: 'granola',
      project: PAYRUN,
    }));
    const suggestion = suggest(meeting({ date: '2026-10-01' }), [
      ...series([LEDGER, LEDGER, LEDGER]),
      ...copies,
    ]);
    expect(suggestion).toMatchObject({ project: LEDGER.path, confidence: 'low' });
  });

  it('is medium on a plain majority the nearest meeting does not share', () => {
    const suggestion = suggest(
      meeting({ date: '2026-10-01' }),
      series([LEDGER, LEDGER, LEDGER, PAYRUN]),
    );
    expect(suggestion).toMatchObject({ project: LEDGER.path, confidence: 'medium' });
  });

  it('is low when no project holds a majority', () => {
    const suggestion = suggest(
      meeting({ date: '2026-10-01' }),
      series([LEDGER, LEDGER, PAYRUN, OPS, PAYRUN, LEDGER]),
    );
    expect(suggestion).toMatchObject({ project: LEDGER.path, confidence: 'low' });
  });

  it('is medium on a series of one, said as that meeting', () => {
    const suggestion = suggest(meeting({ date: '2026-10-01' }), series([OPS]));
    expect(suggestion).toMatchObject({
      project: OPS.path,
      confidence: 'medium',
      reason: 'Same series as 2026-09-10 Larkspur Standup, which is filed under Operations.',
    });
  });

  it('counts two copies of one day once', () => {
    const twinned = series([LEDGER, LEDGER]).flatMap((each) => [
      each,
      { ...each, path: p(`${each.path}.copy.md`), provider: 'granola' },
    ]);
    const suggestion = suggest(meeting({ date: '2026-10-01' }), [...twinned, ...series([PAYRUN])]);
    // Two days of Ledger, one of Payrun (the 10th, shared with Ledger): Ledger 2 of 2 days.
    expect(suggestion?.reason).toContain('2 of its last 2');
  });

  it('matches a series by its title in any spelling, with the same people', () => {
    const others = series([LEDGER, LEDGER]).map((each) => ({
      ...each,
      title: 'larkspur  STANDUP!',
    }));
    expect(suggest(meeting(), others)).toMatchObject({ project: LEDGER.path, confidence: 'high' });
  });

  it('is no series when nobody is shared: a common title among strangers says nothing', () => {
    const others = series([LEDGER, LEDGER]).map((each) => ({
      ...each,
      participants: ['email:ada@example.com'],
    }));
    expect(suggest(meeting(), others)).toBeNull();
  });

  it('is medium at most when the title is all there is to go on', () => {
    const others = series([LEDGER, LEDGER, LEDGER]).map((each) => ({ ...each, participants: [] }));
    expect(suggest(meeting({ participants: [] }), others)).toMatchObject({
      project: LEDGER.path,
      confidence: 'medium',
      reason: expect.stringContaining('Matched by title alone') as unknown,
    });
  });

  it('suggests nothing when the series is filed under nothing open, or there is no series', () => {
    expect(suggest(meeting(), series([null, null]))).toBeNull();
    expect(suggest(meeting(), [])).toBeNull();
    expect(
      suggest(
        meeting({ title: '' }),
        series([LEDGER]).map((each) => ({ ...each, title: '' })),
      ),
    ).toBeNull();
  });
});

describe('isOpenFiling', () => {
  const filing = (more: Record<string, unknown>) =>
    isOpenFiling({
      path: 'Projects/Ledger.md',
      type: 'project',
      para: null,
      status: null,
      ...more,
    });

  it('takes a project and an area, by PARA or by the old Area type', () => {
    expect(filing({})).toBe(true);
    expect(filing({ para: 'Area' })).toBe(true);
    expect(filing({ type: 'area' })).toBe(true);
    expect(filing({ para: 'something of my own' })).toBe(true);
  });

  it('never a resource, an archived one, one in the Archive, or one that is over', () => {
    expect(filing({ para: 'resource' })).toBe(false);
    expect(filing({ type: 'resource' })).toBe(false);
    expect(filing({ para: ' archive ' })).toBe(false);
    expect(filing({ path: 'Archive/Projects/Ledger.md' })).toBe(false);
    expect(filing({ status: 'Done' })).toBe(false);
    expect(filing({ status: 'cancelled' })).toBe(false);
    expect(filing({ type: 'person' })).toBe(false);
  });
});

describe('meetingParticipants', () => {
  const owner = {
    selfName: 'Mara Quill',
    selfEmails: ['mara@larkspur.example'],
    notes: [p('People/Mara Quill.md')],
  };

  it('keys attendees by address, else name, and linked people by note — never the owner', () => {
    const participants = meetingParticipants({
      attendees: [
        { name: 'Mara Quill', email: 'MARA@larkspur.example', group: false },
        { name: 'Quill, Mara', email: null, group: false },
        { name: 'Tobias Fenn', email: 'Tobias@Larkspur.example ', group: false },
        { name: 'Ada Venn', email: null, group: false },
        { name: 'Ada Venn', email: null, group: false },
      ],
      people: [p('People/Mara Quill.md'), p('People/Tobias Fenn.md')],
      owner,
    });
    expect(participants).toEqual([
      'email:tobias@larkspur.example',
      'name:ada venn',
      'note:people/tobias fenn.md',
    ]);
  });
});

describe('seriesTitle', () => {
  it('keeps letters and digits, case and accents folded', () => {
    expect(seriesTitle('Ledger v2 Sync')).toBe(seriesTitle('Ledger V2 Sync'));
    expect(seriesTitle('Mara & Tobias 1:1')).toBe(
      seriesTitle('Mara / Tobias 1-1'.replace('/', '&')),
    );
    expect(seriesTitle('Café Review 🤠')).toBe('cafe review');
  });
});
