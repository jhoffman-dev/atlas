import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  mapGranolaNote,
  splitFrontmatter,
  validateMeetingImport,
  type MeetingImport,
} from '@atlas/domain';
import { remarkMarkdown } from './markdown-port.ts';

/*
 * The Granola mapping (P28-09) held to the meeting/v1 contract by both of its
 * checks: the validator Atlas runs, with the YAML reader every note is read
 * with, and the JSON Schema. All names here are made up.
 */

const root = new URL('../../../../', import.meta.url);
const fixtures = new URL('packages/domain/src/meetings/fixtures/granola/', root);
const schemaFile = new URL('vault/docs/contracts/meeting-import-v1.schema.json', root);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const schemaAccepts = ajv.compile(JSON.parse(readFileSync(schemaFile, 'utf8')) as object);

const goldenNames = readdirSync(fixtures).filter((name) => name.endsWith('.md'));
const OPTIONS = {
  timeZone: 'America/Los_Angeles',
  selfEmails: ['mara.quill@example.com'],
  groupAddresses: [],
};

function accepted(content: string): MeetingImport {
  const result = validateMeetingImport({
    text: content,
    selfName: 'Mara Quill',
    readFrontmatter: (frontmatter) => ({
      properties: remarkMarkdown.frontmatterProperties(frontmatter),
      problem: remarkMarkdown.frontmatterProblem(frontmatter),
    }),
  });
  if (!result.ok)
    throw new Error(`refused:\n${JSON.stringify(result.errors, null, 2)}\n${content}`);
  const frontmatter = remarkMarkdown.frontmatterProperties(splitFrontmatter(content).frontmatter);
  expect(schemaAccepts(frontmatter), ajv.errorsText(schemaAccepts.errors)).toBe(true);
  return result.meeting;
}

const turn = (name: string | undefined, text: string, at: number) => ({
  speaker: { source: 'speaker', ...(name === undefined ? {} : { name }) },
  text,
  start_time: new Date(Date.UTC(2026, 9, 6, 17, 0, at)).toISOString(),
  end_time: new Date(Date.UTC(2026, 9, 6, 17, 0, at + 2)).toISOString(),
});

const NOTE = {
  id: 'not_4kTq2mWxLp4Rz7',
  title: 'Larkspur Payroll renewal',
  web_url: 'https://notes.granola.ai/d/0b6c1d2e',
  calendar_event: null,
  attendees: [],
  summary_text: 'Agreed.',
  summary_markdown: null,
  private_notes_text: null,
  private_notes_markdown: null,
};

const meetingOf = (note: object) => accepted(mapGranolaNote(note, OPTIONS).content);

describe('the Granola golden files', () => {
  it('are there to check', () => {
    expect(goldenNames.length).toBeGreaterThanOrEqual(3);
  });

  it.each(goldenNames)('%s follows the contract', (name) => {
    const meeting = accepted(readFileSync(new URL(name, fixtures), 'utf8'));
    expect(meeting).toMatchObject({ provider: 'granola', transcriptClock: 'wall' });
  });

  it('reads the turns back as the speakers who said them, You as the vault’s owner', () => {
    const meeting = accepted(readFileSync(new URL('renewal-call.md', fixtures), 'utf8'));
    expect(meeting.transcript.map((each) => each.speaker)).toEqual([
      { kind: 'self', name: 'Mara Quill' },
      { kind: 'named', name: 'Tobias Fenn' },
      { kind: 'unknown' },
      { kind: 'unknown' },
      { kind: 'named', name: 'Mara Quill' },
    ]);
    expect(meeting.transcript.map((each) => each.blockId)).toEqual([
      't0001',
      't0002',
      't0003',
      't0004',
      't0005',
    ]);
  });
});

describe('a Granola note the contract could choke on', () => {
  it('keeps speakers with colons, stars and id-shaped words in their own turns', () => {
    const meeting = meetingOf({
      ...NOTE,
      transcript: [
        turn('Fenn: Tobias', 'One.', 1),
        turn('*Mara* **Quill**', 'Two ^t0001.', 2),
        turn('^t9', 'Three ^t9', 3),
        turn(undefined, '[10:00:00] Four.', 4),
        turn('Lena\n*Ortiz*\r\n', 'Five.', 5),
      ],
    });
    expect(meeting.transcript.map((each) => [each.writtenSpeaker, each.blockId])).toEqual([
      ['Fenn: Tobias', 't0001'],
      ['Mara Quill', 't0002'],
      ['^t9', 't0003'],
      ['Unknown', 't0004'],
      ['Lena Ortiz', 't0005'],
    ]);
    expect(meeting.transcript[3]?.words).toBe('[10:00:00] Four.');
  });

  it('writes ten thousand turns the contract reads back, one block each', () => {
    const transcript = Array.from({ length: 10_000 }, (_, at) =>
      turn('Tobias Fenn', `Turn ${at}.`, at),
    );
    const meeting = meetingOf({ ...NOTE, transcript });
    expect(meeting.transcript).toHaveLength(10_000);
    expect(meeting.transcript.at(-1)?.blockId).toBe('t10000');
  });

  it('writes turns that come out of order, and one that ends before it starts', () => {
    const backwards = {
      ...turn('Tobias Fenn', 'Backwards.', 30),
      end_time: '2026-10-06T16:00:00Z',
    };
    const meeting = meetingOf({
      ...NOTE,
      transcript: [turn(undefined, 'Later.', 20), turn(undefined, 'Earlier.', 10), backwards],
    });
    expect(meeting).toMatchObject({ start: '10:00', end: '10:00' });
    expect(meeting.transcript.map((each) => each.words)).toEqual([
      'Later.',
      'Earlier.',
      'Backwards.',
    ]);
  });

  it('writes a note with null wherever Granola allows one, given a time', () => {
    const meeting = meetingOf({
      ...NOTE,
      calendar_event: {
        event_title: null,
        invitees: [],
        organiser: null,
        calendar_event_id: null,
        scheduled_start_time: '2026-10-06T17:00:00Z',
        scheduled_end_time: null,
      },
      attendees: [{ name: null, email: 'ines.park@example.com' }],
      summary_text: null,
      transcript: null,
    });
    expect(meeting).toMatchObject({ start: '10:00', end: null });
    expect(meeting.attendees).toEqual([
      { name: 'ines.park', email: 'ines.park@example.com', group: false },
    ]);
  });
});
