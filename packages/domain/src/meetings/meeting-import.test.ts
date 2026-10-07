import { describe, expect, it } from 'vitest';
import type { FrontmatterReading } from './meeting-import.ts';
import { validateMeetingImport } from './meeting-import.ts';

/*
 * The domain has no YAML parser, so these tests hand the validator the values
 * a frontmatter block would read as. The fixtures are read with the app's own
 * YAML reader in packages/adapters (meeting-import-contract.test.ts).
 */

const VALID: Readonly<Record<string, unknown>> = {
  type: 'meeting',
  atlas_import: 'meeting/v1',
  title: 'Platform weekly sync',
  date: '2026-09-29',
  start: '10:00',
  end: '10:30',
  kind: 'Standup',
  provider: 'gemini',
  external_id: 'gemini-7f3a9c21',
  attendees: [
    { name: 'Mara Quill', email: 'mara.quill@example.com' },
    { name: 'platform-team', email: 'platform-team@example.com', group: true },
  ],
};

const BODY = [
  '## Summary',
  '',
  'Agreed.',
  '',
  '## Provider next steps',
  '',
  '- [Mara Quill] Write the note: for the channel.',
  '',
  '## Transcript',
  '',
  '**Mara Quill** [~00:00:00] Morning. ^t0001',
  '',
  '**You** [~00:09:44] Morning. ^t0002',
  '',
].join('\n');

/** Four frontmatter lines, so the body starts on line 5. */
const FRONTMATTER = '---\nheld: by the fake reader\nnothing: else\n---\n';

function validate({
  properties = VALID,
  problem = null,
  body = BODY,
  frontmatter = FRONTMATTER,
}: {
  properties?: Readonly<Record<string, unknown>>;
  problem?: string | null;
  body?: string;
  frontmatter?: string;
} = {}) {
  const readFrontmatter = (): FrontmatterReading => ({ properties, problem });
  return validateMeetingImport({
    text: frontmatter + body,
    readFrontmatter,
    selfName: 'James Hoffman',
  });
}

const without = (key: string) =>
  Object.fromEntries(Object.entries(VALID).filter(([k]) => k !== key));
const withValue = (key: string, value: unknown) => ({ ...VALID, [key]: value });

function errorsOf(result: ReturnType<typeof validate>) {
  if (result.ok) throw new Error('expected the file to be refused');
  return result.errors;
}

describe('a meeting file that follows meeting/v1', () => {
  it('validates, and reads into the meeting it holds', () => {
    const result = validate();
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const { meeting } = result;
    expect(meeting).toMatchObject({
      title: 'Platform weekly sync',
      date: '2026-09-29',
      start: '10:00',
      end: '10:30',
      kind: 'Standup',
      provider: 'gemini',
      externalId: 'gemini-7f3a9c21',
      transcriptClock: 'elapsed',
      summary: '\nAgreed.\n',
      notes: null,
    });
    expect(meeting.nextSteps).toEqual([expect.objectContaining({ owner: 'Mara Quill', line: 11 })]);
    expect(
      meeting.transcript.map(({ speaker, line, blockId }) => [speaker, line, blockId]),
    ).toEqual([
      [{ kind: 'named', name: 'Mara Quill' }, 15, 't0001'],
      [{ kind: 'self', name: 'James Hoffman' }, 17, 't0002'],
    ]);
  });

  it('keeps a group address as an attendee flagged group, beside the people', () => {
    const result = validate();
    expect(result.ok && result.meeting.attendees).toEqual([
      { name: 'Mara Quill', email: 'mara.quill@example.com', group: false },
      { name: 'platform-team', email: 'platform-team@example.com', group: true },
    ]);
  });

  it('needs none of the optional keys or sections', () => {
    const properties = { ...VALID };
    for (const key of ['end', 'kind', 'attendees']) delete properties[key];
    const result = validate({ properties: { ...properties, kind: null }, body: '' });
    expect(result.ok && result.meeting).toMatchObject({
      end: null,
      kind: null,
      attendees: [],
      transcriptClock: 'elapsed',
      summary: null,
      nextSteps: [],
      transcript: [],
    });
  });

  it('says whether its times are elapsed or the time of day', () => {
    const result = validate({ properties: withValue('transcript_clock', 'wall') });
    expect(result.ok && result.meeting.transcriptClock).toBe('wall');
  });

  it('may carry keys the contract does not name, which Atlas adds later', () => {
    expect(validate({ properties: withValue('atlas_import_error', 'earlier') }).ok).toBe(true);
  });
});

describe('a meeting file that breaks meeting/v1', () => {
  const REQUIRED = ['type', 'atlas_import', 'title', 'date', 'start', 'provider', 'external_id'];

  it.each(REQUIRED)('names %s when it is missing', (key) => {
    expect(errorsOf(validate({ properties: without(key) }))).toEqual([
      { in: 'frontmatter', field: key, message: `${key} is required`, line: null },
    ]);
  });

  it.each(REQUIRED)('names %s when it is empty', (key) => {
    expect(errorsOf(validate({ properties: withValue(key, null) })).map((e) => e.field)).toEqual([
      key,
    ]);
  });

  it('names every missing key at once', () => {
    const properties = { type: 'meeting', atlas_import: 'meeting/v1' };
    expect(errorsOf(validate({ properties })).map((error) => error.field)).toEqual(
      REQUIRED.slice(2),
    );
  });

  it.each([
    ['type', 'note', /must be `meeting`/],
    ['atlas_import', 'meeting/v2', /must be `meeting\/v1`/],
    ['title', '   ', /not blank/],
    ['title', 2026, /must be text/],
    ['date', '2026-02-30', /a day that exists/],
    ['date', '2028-02-30', /a day that exists/],
    ['date', '2026-13-01', /a day that exists/],
    ['date', '29/09/2026', /a day that exists/],
    ['start', '25:00', /24-hour time/],
    ['start', '9:30', /24-hour time/],
    ['end', '10:60', /24-hour time/],
    ['kind', '', /not blank/],
    ['provider', 'Gemini', /lowercase name/],
    ['external_id', 4471, /must be text/],
    ['transcript_clock', 'minutes', /one of elapsed, wall/],
  ])('refuses %s: %j', (key, value, message) => {
    const errors = errorsOf(validate({ properties: withValue(key, value) }));
    expect(errors.map((error) => error.field)).toEqual([key]);
    expect(errors[0]?.message).toMatch(message);
  });

  it('accepts 29 February in a leap year only', () => {
    expect(validate({ properties: withValue('date', '2028-02-29') }).ok).toBe(true);
    expect(validate({ properties: withValue('date', '2000-02-29') }).ok).toBe(true);
    expect(validate({ properties: withValue('date', '2100-02-29') }).ok).toBe(false);
    expect(validate({ properties: withValue('date', '2026-02-29') }).ok).toBe(false);
  });

  it('refuses attendees that are not a list of { name, email, group }', () => {
    expect(errorsOf(validate({ properties: withValue('attendees', 'Mara') }))).toEqual([
      expect.objectContaining({ field: 'attendees', message: 'attendees must be a list' }),
    ]);
    const attendees = [
      'Mara Quill — mara@example.com',
      { email: 'not-an-address' },
      { name: 'platform-team', group: 'yes', role: 'list' },
    ];
    const errors = errorsOf(validate({ properties: withValue('attendees', attendees) }));
    expect(errors.map((error) => error.field)).toEqual([
      'attendees[0]',
      'attendees[1].name',
      'attendees[1].email',
      'attendees[2].group',
      'attendees[2].role',
    ]);
    expect(errors[0]?.message).toMatch(/not a line of text/);
  });

  it('refuses a file with no frontmatter, or frontmatter YAML cannot read', () => {
    expect(errorsOf(validate({ frontmatter: '' }))).toEqual([
      expect.objectContaining({ in: 'frontmatter', field: 'frontmatter' }),
    ]);
    const unreadable = errorsOf(validate({ problem: 'Missing closing ]' }));
    expect(unreadable).toEqual([expect.objectContaining({ field: 'frontmatter', line: null })]);
    expect(unreadable[0]?.message).toMatch(/not readable YAML: Missing closing \]/);
  });

  it('refuses a body that breaks the contract, numbering the line in the file', () => {
    const body = BODY.replace(' ^t0002', '');
    const errors = errorsOf(validate({ body }));
    expect(errors).toEqual([
      expect.objectContaining({ in: 'body', field: 'Transcript', line: 17 }),
    ]);
  });

  it('reports the frontmatter and the body together', () => {
    const errors = errorsOf(validate({ properties: without('title'), body: '## Transcript\n' }));
    expect(errors.map((error) => [error.in, error.field])).toEqual([
      ['frontmatter', 'title'],
      ['body', 'Transcript'],
    ]);
  });

  it('refuses bad next steps', () => {
    const body = '## Provider next steps\n\nShip it.\n';
    expect(errorsOf(validate({ body }))).toEqual([
      expect.objectContaining({ field: 'Provider next steps', line: 7 }),
    ]);
  });
});
