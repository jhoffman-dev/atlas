import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { granolaNoteToFields, mapGranolaNote } from './granola-note.ts';
import { MeetingMappingError } from './meeting-mapping-error.ts';
import { mapMeeting } from './meeting-to-atlas.ts';

/*
 * A Granola note (its public API's `GET /v1/notes/{id}?include=transcript`)
 * as the mapper's fields (P28-09). The zone is the vault's
 * `granola_time_zone`, passed in: never the Mac's, so every writer of the
 * same note writes the same bytes. All names here are made up.
 */

const LA = 'America/Los_Angeles';
/** The vault's person in these tests: Mara Quill, who owns most of the notes. */
const SELF = ['Mara.Quill@example.com'];
const OPTIONS = { timeZone: LA, selfEmails: SELF, groupAddresses: [] };
const fixtures = new URL('../fixtures/granola/', import.meta.url);
const fixtureNames = readdirSync(fixtures)
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.slice(0, -'.json'.length));
const noteOf = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`${name}.json`, fixtures), 'utf8')) as Record<string, unknown>;
const golden = (name: string) => readFileSync(new URL(`${name}.md`, fixtures), 'utf8');

type Item = Record<string, unknown>;

const item = (speaker: Item, text: string, start: string | null, end?: string | null): Item => ({
  speaker: { source: 'speaker', ...speaker },
  text,
  start_time: start,
  end_time: end === undefined ? start : end,
});

const NOTE: Item = {
  id: 'not_4kTq2mWxLp4Rz7',
  object: 'note',
  owner: { name: 'Mara Quill', email: 'mara.quill@example.com' },
  title: 'Larkspur Payroll renewal',
  web_url: 'https://notes.granola.ai/d/0b6c1d2e',
  calendar_event: null,
  attendees: [],
  summary_text: 'Plain summary.',
  summary_markdown: 'Markdown **summary**.',
  private_notes_text: null,
  private_notes_markdown: null,
  transcript: [item({ attribution: 'me' }, 'Hello.', '2026-10-06T17:01:05Z')],
};

const fieldsOf = (note: Item, timeZone = LA) =>
  granolaNoteToFields(note, { timeZone, selfEmails: SELF });
const fileOf = (note: Item, timeZone = LA) =>
  mapGranolaNote(note, { ...OPTIONS, timeZone }).content;
const calendar = (start: string | null, end: string | null, invitees: Item[] = []): Item => ({
  event_title: 'Renewal',
  invitees,
  organiser: null,
  calendar_event_id: null,
  scheduled_start_time: start,
  scheduled_end_time: end,
});
const turnsOf = (note: Item) => fieldsOf(note).turns as readonly Item[];

describe('when the meeting was', () => {
  it('is the calendar event’s scheduled start and end, on the clock of the zone given', () => {
    const note = {
      ...NOTE,
      calendar_event: calendar('2026-10-06T17:00:00Z', '2026-10-06T17:30:00Z'),
    };
    expect(fieldsOf(note)).toMatchObject({ date: '2026-10-06', start: '10:00', end: '10:30' });
    expect(fieldsOf(note, 'Europe/London')).toMatchObject({
      date: '2026-10-06',
      start: '18:00',
      end: '18:30',
    });
  });

  it('moves the day with the zone: an evening meeting in Los Angeles is the next day in UTC', () => {
    const note = { ...NOTE, calendar_event: calendar('2026-10-07T03:30:00Z', null) };
    expect(fieldsOf(note)).toMatchObject({ date: '2026-10-06', start: '20:30' });
    expect(fieldsOf(note, 'UTC')).toMatchObject({ date: '2026-10-07', start: '03:30' });
  });

  it('is the first turn’s start and the last turn’s end without a calendar event', () => {
    const note = {
      ...NOTE,
      transcript: [
        item({}, 'First.', '2026-10-07T21:58:30Z', '2026-10-07T21:58:32Z'),
        item({}, 'Last.', '2026-10-07T22:12:41Z', '2026-10-07T22:12:47Z'),
      ],
    };
    expect(fieldsOf(note)).toMatchObject({ date: '2026-10-07', start: '14:58', end: '15:12' });
  });

  it('is the earliest and the latest turn, when the turns come out of order', () => {
    const note = {
      ...NOTE,
      transcript: [
        item({}, 'Middle.', '2026-10-07T22:00:00Z'),
        item({}, 'Last.', '2026-10-07T22:30:00Z', '2026-10-07T22:31:00Z'),
        item({}, 'First.', '2026-10-07T21:45:00Z'),
      ],
    };
    expect(fieldsOf(note)).toMatchObject({ start: '14:45', end: '15:31' });
  });

  it('ends at a turn’s start when its end_time is before it', () => {
    const note = {
      ...NOTE,
      transcript: [item({}, 'Backwards.', '2026-10-07T22:30:00Z', '2026-10-07T22:00:00Z')],
    };
    expect(fieldsOf(note)).toMatchObject({ start: '15:30', end: '15:30' });
  });

  it('falls back to the turns for a calendar event with no scheduled times', () => {
    const note = {
      ...NOTE,
      calendar_event: calendar(null, null),
      transcript: [item({}, 'Hi.', '2026-10-07T21:58:30Z', '2026-10-07T22:01:00Z')],
    };
    expect(fieldsOf(note)).toMatchObject({ date: '2026-10-07', start: '14:58', end: '15:01' });
  });

  it('takes no time from a turn whose words were dropped', () => {
    const note = {
      ...NOTE,
      transcript: [item({}, ' ', '2026-10-07T20:00:00Z'), item({}, 'Hi.', '2026-10-07T21:58:30Z')],
    };
    expect(fieldsOf(note)).toMatchObject({ start: '14:58', end: '14:58' });
  });

  it('reads no instant without an offset, which would be read on the Mac’s own clock', () => {
    const note = {
      ...NOTE,
      calendar_event: calendar('2026-10-06T10:00:00', '2026-10-06T10:30:00'),
      transcript: [item({}, 'Hi.', '2026-10-06T17:01:05Z')],
    };
    expect(fieldsOf(note)).toMatchObject({ start: '10:01', end: '10:01' });
    const unstamped = {
      ...NOTE,
      calendar_event: calendar('2026-10-06T17:00:00Z', null),
      transcript: [item({}, 'Hi.', '2026-10-06 10:00')],
    };
    expect(turnsOf(unstamped)).toEqual([
      { speaker: 'Unknown', time: null, approximate: false, words: 'Hi.' },
    ]);
  });

  it.each([
    ['no calendar event and no turns', { ...NOTE, transcript: [] }],
    ['no calendar event and a null transcript', { ...NOTE, transcript: null }],
    ['turns with no readable time', { ...NOTE, transcript: [item({}, 'Hi.', 'soon')] }],
    [
      'a calendar event with no times and no turns',
      { ...NOTE, calendar_event: calendar(null, null), transcript: [] },
    ],
  ])('refuses a note with %s: it has no start', (_, note) => {
    expect(() => fieldsOf(note)).toThrow(MeetingMappingError);
    expect(() => fieldsOf(note)).toThrow(/no start/);
  });

  it('maps a meeting across the fall-back hour to the clock times the zone showed', () => {
    // 2026-11-01: Los Angeles goes from 01:59:59 PDT back to 01:00:00 PST.
    const note = {
      ...NOTE,
      calendar_event: calendar('2026-11-01T08:30:00Z', '2026-11-01T09:30:00Z'),
      transcript: [
        item({}, 'Before.', '2026-11-01T08:45:10Z'),
        item({}, 'After.', '2026-11-01T09:05:00Z'),
      ],
    };
    expect(fieldsOf(note)).toMatchObject({ date: '2026-11-01', start: '01:30', end: '01:30' });
    expect(turnsOf(note).map((each) => each['time'])).toEqual(['01:45:10', '01:05:00']);
  });

  it('maps a meeting across the spring-forward hour to the clock times the zone showed', () => {
    // 2026-03-08: Los Angeles goes from 01:59:59 PST to 03:00:00 PDT.
    const note = {
      ...NOTE,
      calendar_event: calendar('2026-03-08T09:30:00Z', '2026-03-08T10:30:00Z'),
    };
    expect(fieldsOf(note)).toMatchObject({ date: '2026-03-08', start: '01:30', end: '03:30' });
  });

  it('refuses a zone that is not one', () => {
    expect(() => fieldsOf(NOTE, 'Mars/Olympus_Mons')).toThrow(MeetingMappingError);
  });
});

describe('the turns', () => {
  it('are named by the speaker’s name first, then You for me, else Unknown', () => {
    const note = {
      ...NOTE,
      transcript: [
        item({ attribution: 'me', name: 'Mara Quill' }, 'Named me.', '2026-10-06T17:00:01Z'),
        item({ attribution: 'them', name: 'Tobias Fenn' }, 'Named them.', '2026-10-06T17:00:02Z'),
        item({ attribution: 'me' }, 'Me.', '2026-10-06T17:00:03Z'),
        item({ attribution: 'them' }, 'Them.', '2026-10-06T17:00:04Z'),
        item({}, 'Nobody said.', '2026-10-06T17:00:05Z'),
        item({ attribution: 'me', name: '  ' }, 'Blank name.', '2026-10-06T17:00:06Z'),
        item({ diarization_label: 'Speaker A' }, 'Diarized.', '2026-10-06T17:00:07Z'),
        { speaker: null, text: 'No speaker at all.', start_time: '2026-10-06T17:00:08Z' },
      ],
    };
    expect(turnsOf(note).map((each) => each['speaker'])).toEqual([
      'Mara Quill',
      'Tobias Fenn',
      'You',
      'Unknown',
      'Unknown',
      'You',
      'Unknown',
      'Unknown',
    ]);
  });

  it('name me as the owner, not You, on a note someone else shared', () => {
    const shared = {
      ...NOTE,
      transcript: [
        item({ attribution: 'me' }, 'Owner speaking.', '2026-10-06T17:00:01Z'),
        item({ attribution: 'them' }, 'Someone else.', '2026-10-06T17:00:02Z'),
      ],
    };
    const tobias = granolaNoteToFields(shared, {
      timeZone: LA,
      selfEmails: ['tobias.fenn@example.com'],
    });
    expect((tobias.turns as Item[]).map((each) => each['speaker'])).toEqual([
      'Mara Quill',
      'Unknown',
    ]);
    expect(fileOf(shared)).toContain('\n**You** [10:00:01] Owner speaking. ^t0001\n');
  });

  it('name me Unknown when the owner of a shared note has no name, or there is no owner', () => {
    const me = [item({ attribution: 'me' }, 'Hi.', '2026-10-06T17:00:01Z')];
    const unnamed = { ...NOTE, owner: { name: null, email: 'lena@example.com' }, transcript: me };
    expect(turnsOf(unnamed)[0]).toMatchObject({ speaker: 'Unknown' });
    expect(turnsOf({ ...NOTE, owner: undefined, transcript: me })[0]).toMatchObject({
      speaker: 'Unknown',
    });
    const noEmail = { ...NOTE, owner: { name: 'Lena Ortiz', email: '' }, transcript: me };
    expect(
      granolaNoteToFields(noEmail, { timeZone: LA, selfEmails: [''] }).turns as Item[],
    ).toMatchObject([{ speaker: 'Lena Ortiz' }]);
  });

  it('write a name with stars or a line break in it as the turn grammar reads it', () => {
    const note = {
      ...NOTE,
      owner: { name: 'Lena *Ortiz*', email: 'lena.ortiz@example.com' },
      transcript: [
        item({ attribution: 'me' }, 'One.', '2026-10-06T17:00:01Z'),
        item({ name: 'Tobias\nFenn' }, 'Two.', '2026-10-06T17:00:02Z'),
      ],
    };
    expect(fileOf(note)).toContain(
      '\n**Lena Ortiz** [10:00:01] One. ^t0001\n\n**Tobias Fenn** [10:00:02] Two. ^t0002\n',
    );
  });

  it('are stamped with the wall-clock time of day in the zone, to the second, and exact', () => {
    const note = { ...NOTE, transcript: [item({}, 'Hi.', '2026-10-06T17:01:11.900Z')] };
    expect(turnsOf(note)).toEqual([
      { speaker: 'Unknown', time: '10:01:11', approximate: false, words: 'Hi.' },
    ]);
    expect(fieldsOf(note).clock).toBe('wall');
    expect(fileOf(note)).toContain('\ntranscript_clock: wall\n');
  });

  it('read an offset instant at its own offset', () => {
    const note = { ...NOTE, transcript: [item({}, 'Hi.', '2026-10-06T19:01:05+02:00')] };
    expect(turnsOf(note)[0]).toMatchObject({ time: '10:01:05' });
  });

  it('drop a turn with no words, so the ids run on without a gap', () => {
    const note = {
      ...NOTE,
      transcript: [
        item({}, 'One.', '2026-10-06T17:00:01Z'),
        item({}, '', '2026-10-06T17:00:02Z'),
        item({}, ' \n\t ', '2026-10-06T17:00:03Z'),
        item({}, 'Two.', '2026-10-06T17:00:04Z'),
      ],
    };
    expect(turnsOf(note).map((each) => each['words'])).toEqual(['One.', 'Two.']);
    expect(fileOf(note)).toContain('Two. ^t0002\n');
  });

  it('keep a turn with no time, unstamped', () => {
    const note = {
      ...NOTE,
      calendar_event: calendar('2026-10-06T17:00:00Z', null),
      transcript: [item({}, 'Hi.', null)],
    };
    expect(fileOf(note)).toContain('\n**Unknown** Hi. ^t0001\n');
  });

  it('keep a name with colons, stars and an id in it inside its turn', () => {
    const note = {
      ...NOTE,
      transcript: [
        item({ name: 'Fenn: *Tobias* ^t9' }, 'Hi ^t0001 there.', '2026-10-06T17:00:01Z'),
      ],
    };
    expect(fileOf(note)).toContain('\n**Fenn: Tobias ^t9** [10:00:01] Hi \\^t0001 there. ^t0001\n');
  });

  it('are all kept from a long meeting', () => {
    const transcript = Array.from({ length: 10_000 }, (_, at) =>
      item({}, `Turn ${at}.`, new Date(Date.UTC(2026, 9, 6, 17, 0, at)).toISOString()),
    );
    const file = fileOf({ ...NOTE, transcript });
    expect(file).toContain('Turn 9999. ^t10000\n');
    expect(file).toMatch(/\nend: '12:46'\n/);
  });
});

describe('who was there, and what was said about it', () => {
  it('merges the attendees and the calendar invitees by address, the named one kept', () => {
    const note = {
      ...NOTE,
      attendees: [
        { name: 'Tobias Fenn', email: 'tobias.fenn@example.com' },
        { name: null, email: 'ines.park@example.com' },
      ],
      calendar_event: calendar('2026-10-06T17:00:00Z', null, [
        { email: 'TOBIAS.FENN@example.com' },
        { email: 'mara.quill@example.com' },
        { email: 'payroll-team@example.com' },
      ]),
    };
    expect(mapMeeting(fieldsOf(note)).content).toContain(
      [
        'attendees:',
        "  - name: 'Tobias Fenn'",
        "    email: 'tobias.fenn@example.com'",
        "  - name: 'ines.park'",
        "    email: 'ines.park@example.com'",
        "  - name: 'mara.quill'",
        "    email: 'mara.quill@example.com'",
        "  - name: 'payroll-team'",
        "    email: 'payroll-team@example.com'",
        '    group: true',
        '---',
      ].join('\n'),
    );
  });

  it('applies the group addresses it is given to the merged list', () => {
    const note = { ...NOTE, attendees: [{ name: 'Larkspur Desk', email: 'desk@example.com' }] };
    const file = mapGranolaNote(note, { ...OPTIONS, groupAddresses: ['desk@example.com'] }).content;
    expect(fileOf(note)).not.toContain('group: true');
    expect(file).toContain("    email: 'desk@example.com'\n    group: true\n");
  });

  it('summarises from summary_markdown, else from summary_text', () => {
    expect(fieldsOf(NOTE).summary).toBe('Markdown **summary**.');
    expect(fieldsOf({ ...NOTE, summary_markdown: null }).summary).toBe('Plain summary.');
    expect(fieldsOf({ ...NOTE, summary_markdown: '  ' }).summary).toBe('Plain summary.');
  });

  it('writes the private notes, as markdown when there is some, under Notes', () => {
    const markdown = { ...NOTE, private_notes_markdown: '- Ask **why**', private_notes_text: 'x' };
    expect(fileOf(markdown)).toContain('\n## Notes\n\n- Ask **why**\n');
    const text = { ...NOTE, private_notes_text: 'Ask why' };
    expect(fileOf(text)).toContain('\n## Notes\n\nAsk why\n');
    expect(fileOf(NOTE)).not.toContain('## Notes');
  });

  it('is from Granola, by the note’s id, with its link back', () => {
    expect(fieldsOf(NOTE)).toMatchObject({
      source: 'granola',
      sourceId: 'not_4kTq2mWxLp4Rz7',
      title: 'Larkspur Payroll renewal',
      url: 'https://notes.granola.ai/d/0b6c1d2e',
    });
  });

  it('leaves the refusal of a note with no title or id to the mapper, which names the field', () => {
    expect(() => fileOf({ ...NOTE, title: null })).toThrow(/title: missing/);
    expect(() => fileOf({ ...NOTE, id: undefined })).toThrow(/sourceId: missing/);
  });
});

describe('a note that is not shaped as Granola documents it', () => {
  it.each([
    ['null', null],
    ['a list', []],
    ['text', 'not_4kTq2mWxLp4Rz7'],
  ])('is refused when it is %s', (_, note) => {
    expect(() => granolaNoteToFields(note, OPTIONS)).toThrow(MeetingMappingError);
  });

  it.each([
    ['attendees that are not a list', { attendees: 'Mara Quill' }, /attendees: expected a list/],
    ['an attendee that is not a record', { attendees: ['Mara Quill'] }, /attendees\[0\]/],
    ['a transcript that is not a list', { transcript: {} }, /transcript: expected a list/],
    ['a turn that is not a record', { transcript: ['Hi.'] }, /transcript\[0\]/],
    [
      'a speaker that is not a record',
      { transcript: [{ speaker: 'Mara', text: 'Hi.', start_time: '2026-10-06T17:00:01Z' }] },
      /transcript\[0\]\.speaker/,
    ],
    ['a calendar event that is not a record', { calendar_event: 'today' }, /calendar_event/],
    [
      'invitees that are not a list',
      { calendar_event: { scheduled_start_time: '2026-10-06T17:00:00Z', invitees: 'x' } },
      /calendar_event\.invitees/,
    ],
  ])('is refused for %s', (_, change, message) => {
    expect(() => fieldsOf({ ...NOTE, ...change })).toThrow(MeetingMappingError);
    expect(() => fieldsOf({ ...NOTE, ...change })).toThrow(message);
  });
});

describe('the golden files', () => {
  it('cover a calendar meeting, an ad-hoc one, one across a clock change, and a shared one', () => {
    expect(fixtureNames).toEqual([
      'fall-back-release',
      'hallway-chat',
      'renewal-call',
      'shared-onboarding',
    ]);
  });

  it.each(fixtureNames)('%s maps to its golden file byte for byte', (name) => {
    expect(fileOf(noteOf(name))).toBe(golden(name));
  });
});

/** A seeded generator (mulberry32): the same seed, the same run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ODD_TEXT = [
  '',
  ' ',
  'Fenn: *Tobias*',
  '^t9',
  '2026-10-06T17:00:00Z',
  '25:00',
  '\u0000',
  '**',
];

function anyJson(random: () => number, depth: number): unknown {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  const roll = random();
  if (depth <= 0 || roll < 0.5) {
    return pick<unknown>([null, undefined, true, 0, -1, 1e21, Number.NaN, pick(ODD_TEXT)]);
  }
  if (roll < 0.75)
    return Array.from({ length: Math.floor(random() * 4) }, () => anyJson(random, depth - 1));
  const keys = ['name', 'email', 'text', 'speaker', 'start_time', 'end_time', 'attribution'];
  return Object.fromEntries(
    keys.filter(() => random() < 0.5).map((key) => [key, anyJson(random, depth - 1)]),
  );
}

/** Every path to a value in the note, so any one of them can be replaced. */
function paths(value: unknown, at: (string | number)[] = []): (string | number)[][] {
  if (value === null || typeof value !== 'object') return [at];
  const children = Object.entries(value as object).flatMap(([key, child]) =>
    paths(child, [...at, Array.isArray(value) ? Number(key) : key]),
  );
  return [at, ...children];
}

function replaced(note: unknown, path: (string | number)[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path as [string | number, ...(string | number)[]];
  const copy = Array.isArray(note) ? [...(note as unknown[])] : { ...(note as Item) };
  (copy as Record<string | number, unknown>)[head] = replaced(
    (note as Record<string | number, unknown>)[head],
    rest,
    value,
  );
  return copy;
}

describe('on any JSON at all', () => {
  const SEEDS = 600;

  it('throws nothing but a MeetingMappingError, before or in the mapper', () => {
    const base = noteOf('renewal-call');
    const unexpected: string[] = [];
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const random = seeded(seed);
      const changes = 1 + Math.floor(random() * 3);
      let note: unknown = base;
      for (let change = 0; change < changes; change += 1) {
        const every = paths(note);
        const path = every[Math.floor(random() * every.length)] ?? [];
        note = replaced(note, path, anyJson(random, 3));
      }
      try {
        mapGranolaNote(note, OPTIONS);
      } catch (error) {
        if (!(error instanceof MeetingMappingError))
          unexpected.push(`seed ${seed}: ${String(error)}`);
      }
    }
    expect(unexpected).toEqual([]);
  });
});
