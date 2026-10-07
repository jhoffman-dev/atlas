import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { remarkMarkdown } from '@atlas/adapters';
import { splitFrontmatter, validateMeetingImport, type MeetingImport } from '@atlas/domain';
import { MeetingMappingError } from './meeting-mapping-error.ts';
import { mapMeeting, type MappingOptions, type MeetingFields } from './meeting-to-atlas.ts';

/*
 * Adversarial cases for the mapper (issue #8, P28-02). Each test names one
 * promise the mapper makes — "a file Atlas accepts, or a MeetingMappingError",
 * "content lands with the person who said or owns it", "the collision path is
 * this meeting's alone" — and an input that breaks it. All names are made up.
 */

const schemaFile = new URL(
  '../../vault/docs/contracts/meeting-import-v1.schema.json',
  import.meta.url,
);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const schemaAccepts = ajv.compile(JSON.parse(readFileSync(schemaFile, 'utf8')) as object);

function accepted(content: string): MeetingImport {
  const result = validateMeetingImport({
    text: content,
    selfName: null,
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

const BASE: MeetingFields = {
  title: 'Weekly sync',
  date: '2026-10-06',
  start: '10:00',
  source: 'gemini',
  sourceId: 'm-0001',
};

const meetingOf = (fields: MeetingFields, options?: MappingOptions) =>
  accepted(mapMeeting({ ...BASE, ...fields }, options).content);

/** The mapper's promise: a file Atlas accepts, or a MeetingMappingError — never a refused file. */
function acceptedOrMappingError(fields: MeetingFields): void {
  let content: string;
  try {
    content = mapMeeting({ ...BASE, ...fields }).content;
  } catch (error) {
    expect(error).toBeInstanceOf(MeetingMappingError);
    return;
  }
  accepted(content);
}

describe('never writes a file the contract refuses', () => {
  it('an empty `##` line in prose is not left as a stray level-2 heading', () => {
    acceptedOrMappingError({ summary: 'Agreed on the plan.\n##\nMore later.' });
  });

  it('a record step with no owner whose title opens with [x] is not read as a ticked checkbox', () => {
    acceptedOrMappingError({ nextSteps: [{ title: '[x] Close the ticket', description: 'done' }] });
  });

  it('a record step with no owner whose title opens with [ ] is not read as a blank owner', () => {
    acceptedOrMappingError({ nextSteps: [{ title: '[ ] Plan the rollout', description: 'soon' }] });
  });

  it('a Gemini section stamp with minutes past 59 never becomes a turn time', () => {
    acceptedOrMappingError({ transcript: '### 00:75:00\nAnn Lee: Hello.' });
  });
});

describe('next steps keep their owner', () => {
  it('a record step with no owner whose title opens with [draft] gets no owner', () => {
    const [step] = meetingOf({
      nextSteps: [{ title: '[draft] Plan', description: 'write it' }],
    }).nextSteps;
    expect(step?.owner).toBeNull();
  });

  it('a record owner with an unbalanced bracket is still the owner', () => {
    const [step] = meetingOf({
      nextSteps: [{ owner: 'Mara]', title: 'Plan', description: 'x' }],
    }).nextSteps;
    expect(step?.owner).not.toBeNull();
  });

  it('plain lines each starting with [Owner] are separate steps, not one merged into the first', () => {
    const steps = meetingOf({
      nextSteps: '[Ann Lee] Plan: write it\n[Bo Park] Ship: release it',
    }).nextSteps.map((step) => [step.owner, step.text]);
    expect(steps).toEqual([
      ['Ann Lee', 'Plan: write it'],
      ['Bo Park', 'Ship: release it'],
    ]);
  });
});

describe('transcript turns go to the person who spoke', () => {
  const speakersOf = (transcript: string, fields: MeetingFields = {}) =>
    meetingOf({ ...fields, transcript }).transcript.map((turn) => turn.writtenSpeaker);

  it('a bulleted `- Name: words` line is spoken by Name, not by "- Name"', () => {
    expect(speakersOf('- Ann Lee: Hello.\n- Bo Park: Hi.')).toEqual(['Ann Lee', 'Bo Park']);
  });

  it('`**Name**: words` lines are turns of their own, not one Unknown turn', () => {
    expect(speakersOf('**Ann Lee**: Hello.\n**Bo Park**: Hi.')).toEqual(['Ann Lee', 'Bo Park']);
  });

  it('a continuation line with a colon in its words (`Note: x`) is not a new speaker', () => {
    expect(
      speakersOf('### 00:00:01\nAnn Lee: Two things.\nNote: we ship on Friday.', {
        attendees: 'Ann Lee — ann@example.com',
      }),
    ).toEqual(['Ann Lee']);
  });

  it('maps a long run of speakerless lines in linear time', () => {
    const lines = Array.from({ length: 6000 }, (_, at) => `and then item ${at} came up again`);
    const started = performance.now();
    mapMeeting({ ...BASE, transcript: `Ann Lee: Hello.\n${lines.join('\n')}` });
    // Linear is ~10 ms here; the quadratic join takes seconds.
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('attendees', () => {
  const attendeesOf = (attendees: unknown) => meetingOf({ attendees }).attendees;

  it.each([
    'Staff Sergeant Rivera — rivera@example.com',
    'Dana List — dana.list@example.com',
    'Sam Crew — sam.crew@example.com',
  ])('a person whose name holds a group word is not a group: %s', (line) => {
    expect(attendeesOf(line)[0]?.group).toBe(false);
  });

  it('keeps the display name when the bare address came first', () => {
    expect(attendeesOf('ann@example.com\nAnn Lee — ann@example.com')).toEqual([
      { name: 'Ann Lee', email: 'ann@example.com', group: false },
    ]);
  });

  it('splits attendee lines on a lone CR, as the prose sections already do', () => {
    expect(
      attendeesOf('Ann Lee — ann@example.com\rBo Park — bo@example.com').map((each) => each.name),
    ).toEqual(['Ann Lee', 'Bo Park']);
  });

  it('does not keep trailing punctuation as part of an address', () => {
    expect(attendeesOf('Ann Lee — ann@example.com,')[0]?.email).toBe('ann@example.com');
  });
});

describe('the time of the meeting', () => {
  it('refuses 30 February with a time zone set, as it does without one', () => {
    expect(() =>
      mapMeeting({ ...BASE, date: '2026-02-30T10:00:00Z' }, { timeZone: 'America/Chicago' }),
    ).toThrow(MeetingMappingError);
  });

  it('refuses an unknown time zone even when no date carries an offset', () => {
    expect(() => mapMeeting(BASE, { timeZone: 'Not/AZone' })).toThrow(MeetingMappingError);
  });

  it('refuses an invalid Date as a MeetingMappingError, not a RangeError', () => {
    expect(() => mapMeeting({ ...BASE, date: new Date(Number.NaN) })).toThrow(MeetingMappingError);
  });
});

describe('the collision path', () => {
  it('is unique to provider and external_id (the workflow skips when a file is there)', () => {
    const slash = mapMeeting({ ...BASE, sourceId: 'a/b' }).collisionPath;
    const space = mapMeeting({ ...BASE, sourceId: 'a b' }).collisionPath;
    expect(slash).not.toBe(space);
  });

  it('fits in 255 bytes and keeps the date, however long the id', () => {
    const { collisionPath } = mapMeeting({ ...BASE, sourceId: 'z'.repeat(300) });
    const name = collisionPath.slice(collisionPath.lastIndexOf('/') + 1);
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(255);
    expect(name.startsWith('2026-10-06')).toBe(true);
  });
});
