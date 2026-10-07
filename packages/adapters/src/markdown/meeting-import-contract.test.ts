import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  parseObjectType,
  parseTranscript,
  splitFrontmatter,
  validateMeetingImport,
  type EditorDocument,
  type EditorNode,
  type MeetingImportResult,
} from '@atlas/domain';
import { frontmatterProblem, parseFrontmatterProperties } from './frontmatter.ts';
import { parseMarkdownBody, serializeMarkdownBody } from './markdown-blocks.ts';

/*
 * The meeting import contract v1 (ADR-0027) has three statements of itself —
 * the doc, the JSON Schema n8n can check a file against, and the validator
 * Atlas runs. These tests read the fixtures with the YAML reader every note is
 * read with, and hold the schema and the validator to the same verdicts.
 */

const root = new URL('../../../../', import.meta.url);
const fixtures = new URL('packages/domain/src/meetings/fixtures/', root);
const schemaFile = new URL('vault/docs/contracts/meeting-import-v1.schema.json', root);

const fixtureNames = (folder: 'valid' | 'invalid') =>
  readdirSync(new URL(`${folder}/`, fixtures)).filter((name) => name.endsWith('.md'));
const fixture = (folder: 'valid' | 'invalid', name: string) =>
  readFileSync(new URL(`${folder}/${name}`, fixtures), 'utf8');

const schema: unknown = JSON.parse(readFileSync(schemaFile, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const schemaAccepts = ajv.compile(schema as object);

function validate(text: string, selfName: string | null = 'James Hoffman'): MeetingImportResult {
  return validateMeetingImport({
    text,
    selfName,
    readFrontmatter: (frontmatter) => ({
      properties: parseFrontmatterProperties(frontmatter),
      problem: frontmatterProblem(frontmatter),
    }),
  });
}

const frontmatterOf = (text: string) =>
  parseFrontmatterProperties(splitFrontmatter(text).frontmatter);

/** What each failing fixture is there to show: the fields it must be refused for. */
const INVALID: Readonly<Record<string, readonly string[]>> = {
  'attendee-not-a-record.md': [
    'attendees[0]',
    'attendees[1].email',
    'attendees[1].group',
    'attendees[1].role',
  ],
  'bad-next-steps.md': ['Provider next steps', 'Provider next steps'],
  'bad-times.md': ['date', 'start', 'end', 'Transcript', 'Transcript'],
  'duplicate-block-ids.md': ['Transcript'],
  'empty-transcript.md': ['Transcript'],
  'missing-required.md': ['title', 'start', 'external_id'],
  'no-frontmatter.md': ['frontmatter'],
  'not-a-turn.md': ['Transcript'],
  'sections-out-of-order.md': ['Summary', 'Action items'],
  'turn-without-block-id.md': ['Transcript'],
  'unreadable-yaml.md': ['frontmatter'],
  'wrong-version.md': ['type', 'atlas_import', 'provider', 'external_id', 'transcript_clock'],
};

describe('the meeting fixtures', () => {
  it('include a Gemini and a Granola meeting, and every failing one is accounted for', () => {
    expect(fixtureNames('valid')).toEqual(['gemini-platform-sync.md', 'granola-vendor-call.md']);
    expect(fixtureNames('invalid')).toEqual(Object.keys(INVALID).sort());
  });

  it.each(fixtureNames('valid'))('%s follows the contract', (name) => {
    const result = validate(fixture('valid', name));
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it.each(Object.entries(INVALID))('%s is refused for what it breaks', (name, fields) => {
    const result = validate(fixture('invalid', name));
    expect(result.ok ? [] : result.errors.map((error) => error.field)).toEqual(fields);
  });
});

describe('the JSON Schema and the validator', () => {
  const every = [
    ...fixtureNames('valid').map((name) => ['valid', name] as const),
    ...fixtureNames('invalid').map((name) => ['invalid', name] as const),
  ];

  it.each(every)('agree on %s/%s', (folder, name) => {
    const text = fixture(folder, name);
    const result = validate(text);
    const validatorAccepts =
      result.ok || result.errors.every((error) => error.in !== 'frontmatter');
    const accepted = schemaAccepts(frontmatterOf(text));
    expect({ accepted, errors: ajv.errorsText(schemaAccepts.errors) }).toMatchObject({
      accepted: validatorAccepts,
    });
    if (folder === 'valid') expect(accepted).toBe(true);
  });

  it('agree that some fixture is refused by its frontmatter, so agreeing is not trivial', () => {
    const refused = fixtureNames('invalid').filter(
      (name) => !schemaAccepts(frontmatterOf(fixture('invalid', name))),
    );
    expect(refused).toEqual([
      'attendee-not-a-record.md',
      'bad-times.md',
      'missing-required.md',
      'no-frontmatter.md',
      'unreadable-yaml.md',
      'wrong-version.md',
    ]);
  });

  it.each(['type', 'atlas_import', 'title', 'date', 'start', 'provider', 'external_id'])(
    'agree that %s is required, taken off a valid meeting',
    (key) => {
      const text = fixture('valid', 'gemini-platform-sync.md');
      const without = text.replace(new RegExp(`^${key}: .*\\n`, 'm'), '');
      expect(without).not.toBe(text);
      expect(schemaAccepts(frontmatterOf(without))).toBe(false);
      expect(validate(without).ok).toBe(false);
    },
  );

  it.each(['end', 'kind', 'transcript_clock'])(
    'agree that %s is optional, taken off a valid meeting',
    (key) => {
      const text = fixture('valid', 'gemini-platform-sync.md');
      const without = text.replace(new RegExp(`^${key}: .*\\n`, 'm'), '');
      expect(without).not.toBe(text);
      expect(schemaAccepts(frontmatterOf(without))).toBe(true);
      expect(validate(without).ok).toBe(true);
    },
  );

  it.each(['end', 'kind', 'transcript_clock'])(
    'agree that %s written empty is not given',
    (key) => {
      const text = fixture('valid', 'gemini-platform-sync.md');
      const empty = text.replace(new RegExp(`^${key}: .*$`, 'm'), `${key}:`);
      expect(frontmatterOf(empty)[key]).toBeNull();
      expect(schemaAccepts(frontmatterOf(empty))).toBe(true);
      expect(validate(empty).ok).toBe(true);
    },
  );

  it('agree on 30 February, which only a real calendar check refuses', () => {
    const text = fixture('valid', 'gemini-platform-sync.md').replace(
      "'2026-09-29'",
      "'2026-02-30'",
    );
    expect(schemaAccepts(frontmatterOf(text))).toBe(false);
    expect(validate(text).ok).toBe(false);
  });
});

describe('a meeting read from its file', () => {
  it('Gemini: people and a group address, steps with owners, turns at their section’s time', () => {
    const result = validate(fixture('valid', 'gemini-platform-sync.md'));
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const { meeting } = result;
    expect(meeting.attendees.filter((attendee) => attendee.group)).toEqual([
      { name: 'platform-team', email: 'platform-team@example.com', group: true },
    ]);
    expect(meeting.nextSteps.map((step) => step.owner)).toEqual(['Tobias Fenn', 'Mara Quill']);
    expect(meeting.transcript.every((turn) => turn.time.kind === 'section')).toBe(true);
    expect(meeting.transcript[2]?.time).toMatchObject({ text: '00:09:44', seconds: 584 });
  });

  it('Granola: You is the profile’s name, Remote Speaker is unknown, steps keep confidence', () => {
    const result = validate(fixture('valid', 'granola-vendor-call.md'));
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const { meeting } = result;
    expect(meeting.transcriptClock).toBe('wall');
    expect(meeting.kind).toBe('1:1');
    expect(meeting.transcript.map((turn) => turn.speaker)).toEqual([
      { kind: 'self', name: 'James Hoffman' },
      { kind: 'unknown' },
      { kind: 'self', name: 'James Hoffman' },
      { kind: 'unknown' },
    ]);
    expect(meeting.nextSteps.map((step) => step.confidence)).toEqual(['high', 'medium']);
  });
});

describe('a transcript turn edited in Atlas', () => {
  /** The fixture's body with ` (edited)` typed at the end of each paragraph, saved. */
  function editedTranscript(): string {
    const body = splitFrontmatter(fixture('valid', 'gemini-platform-sync.md')).body;
    const parsed = parseMarkdownBody(body);
    const edit = (node: EditorNode): EditorNode =>
      node.type === 'paragraph'
        ? { ...node, content: [...(node.content ?? []), { type: 'text', text: ' (edited)' }] }
        : node;
    const doc: EditorDocument = { type: 'doc', content: parsed.doc.content.map(edit) };
    const saved = serializeMarkdownBody({ originalBody: body, parsed, doc });
    return saved.slice(saved.indexOf('## Transcript\n') + '## Transcript\n'.length);
  }

  it('is saved as a turn that still follows the contract, its id and time intact', () => {
    const { turns, errors } = parseTranscript(editedTranscript(), {
      selfName: null,
      firstLine: 1,
    });
    expect(errors).toEqual([]);
    expect(turns.map((turn) => [turn.time.kind, turn.blockId])).toEqual([
      ['section', 't0001'],
      ['section', 't0002'],
      ['section', 't0003'],
      ['section', 't0004'],
    ]);
    expect(turns[0]?.words).toMatch(/\(edited\)$/);
  });
});

describe('the Meeting type this vault ships', () => {
  it('declares the contract’s keys Atlas shows, and the links it fills in later', () => {
    const file = readFileSync(new URL('vault/.atlas/types/meeting.md', root), 'utf8');
    const type = parseObjectType(parseFrontmatterProperties(splitFrontmatter(file).frontmatter));
    expect(type.name).toBe('meeting');
    expect(Object.fromEntries(type.properties.map((p) => [p.key, p.kind]))).toEqual({
      title: 'text',
      date: 'date',
      start: 'text',
      end: 'text',
      kind: 'text',
      provider: 'text',
      external_id: 'text',
      people: 'relation',
      companies: 'relation',
      project: 'relation',
    });
    expect(type.properties.filter((p) => p.many).map((p) => [p.key, p.target])).toEqual([
      ['people', 'person'],
      ['companies', 'company'],
    ]);
  });
});
