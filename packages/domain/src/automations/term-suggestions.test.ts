import { describe, expect, it } from 'vitest';
import { vocabulary, type Vocabulary } from '../terms/vocabulary.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { claudeProposalId } from './claude-proposal-id.ts';
import type { AnsweredNote, AnswerContext, AnswerVault } from './proposal-schema.ts';
import { proposalSchemaNamed } from './proposal-schemas.ts';
import {
  SUGGESTED_TERM_KINDS,
  TERM_SUGGESTION_PARTS_PER_MEETING,
  TERM_SUGGESTIONS,
  TERM_SUGGESTIONS_OUTPUT,
} from './term-suggestions.ts';

/**
 * P29-06: what Claude suggests for the glossary after a meeting. The model
 * says what it heard and what it thinks was meant; whether that may become a
 * misheard spelling is decided here, against the transcript and the
 * vocabulary.
 */

const TRANSCRIPT = `## Transcript

**Mara Quill** [~00:00:00] Morning. The Lark Spur Pay rollout is ready. ^t0001

**Tobias Fenn** [~00:00:30] Mara Quil will write it up. ^t0002

**Mara Quill** [~00:01:00] I saw lark spur pay twice, and Lark Spur Pay again. ^t0003

**Tobias Fenn** [~00:01:30] Let me mark that plan. ^t0004

**Tobias Fen** [~00:02:00] Hello from me. ^t0005

**Mara Quill** [~00:02:30] Written \`Lark Spur Payroll\` in code. ^t0006

**Mara Quill** [~00:03:00] Quill said so. ^t0007
`;

const meeting = (
  title: string,
  externalId: string,
  attendees: { name: string; group?: boolean }[] = [
    { name: 'Mara Quill' },
    { name: 'platform-team', group: true },
  ],
): AnsweredNote => ({
  path: createVaultPath(`Inbox/Meetings/${title}.md`),
  text: `---\ntype: meeting\n---\n\n${TRANSCRIPT}`,
  meeting: {
    identity: { provider: 'gemini', externalId },
    date: '2026-09-29',
    attendees: attendees.map(({ name, group }) => ({
      name,
      email: `${name.toLowerCase().replace(/\W+/g, '.')}@example.com`,
      group: group === true,
    })),
  },
});
const MONDAY = meeting('Monday sync', 'gemini-aaa');
const FRIDAY = meeting('Friday sync', 'gemini-bbb');

const term = (canonical: string, variants: string[] = []) => ({
  path: createVaultPath(`Terms/${canonical}.md`),
  canonical,
  variants,
  kind: null,
});
const named = (name: string) => ({ path: createVaultPath(`People/${name}.md`), name, aliases: [] });

const VOCABULARY: Vocabulary = vocabulary({
  terms: [
    term('Larkspur Pay', ['Lark Spur Pay Old']),
    term('Larkspur Payroll', ['Larkspur Payrol']),
  ],
  people: [named('Mara Quill'), named('Tobias Fenn')],
  companies: [],
});
const vault = (known: Vocabulary | undefined = VOCABULARY): AnswerVault => ({
  selfName: 'Mara Quill',
  people: [],
  notePaths: [MONDAY.path, FRIDAY.path],
  terms: [],
  ...(known === undefined ? {} : { vocabulary: known }),
});
const about = (note: AnsweredNote, known?: Vocabulary): AnswerContext => ({
  notes: [note],
  vault: vault(known),
});

const schema = proposalSchemaNamed('term-suggestions')!;
const item = (fields: Record<string, unknown> = {}) => ({
  heard: 'Lark Spur Pay',
  canonical: 'Larkspur Pay',
  kind: 'product',
  source_block: 't0001',
  confidence: 'high',
  ...fields,
});
const read = (items: unknown[], context: AnswerContext = about(MONDAY)) => {
  const reading = schema.read(JSON.stringify({ terms: items }), context);
  if (!reading.ok) throw new Error(reading.problem);
  return reading;
};
const one = (fields: Record<string, unknown> = {}, context?: AnswerContext) => {
  const reading = read([item(fields)], context);
  expect(reading.dropped).toEqual([]);
  expect(reading.value).toHaveLength(1);
  return reading.value[0]!;
};
const droppedFor = (fields: Record<string, unknown>, context?: AnswerContext) => {
  const reading = read([item(fields)], context);
  expect(reading.value).toEqual([]);
  expect(reading.dropped).toHaveLength(1);
  return reading.dropped[0]!;
};

describe('the registered output', () => {
  it('is registered as term-suggestions, reading the vault and one meeting in parts', () => {
    expect(TERM_SUGGESTIONS_OUTPUT).toBe('term-suggestions');
    expect(schema.name).toBe('term-suggestions');
    expect(schema.readsVault).toBe(true);
    expect(schema.readsInParts).toBe(true);
    expect(schema.partsPerNote).toBe(2);
    expect(TERM_SUGGESTION_PARTS_PER_MEETING).toBe(2);
  });

  it('asks for a list under terms, and tells the model the kinds it may name', () => {
    expect(schema.instructions).toContain('{ "terms": [ … ] }');
    for (const kind of SUGGESTED_TERM_KINDS) expect(schema.instructions).toContain(kind);
    expect(SUGGESTED_TERM_KINDS).not.toContain('other');
  });

  it('knows a meeting by its words, so a meeting already read is not read again', () => {
    expect(schema.handledKeyOf!(MONDAY)).toMatch(/^meeting:gemini:gemini-aaa:body:/);
    expect(schema.handledKeyOf!({ text: MONDAY.text })).toBeNull();
  });

  it('is shared across rules and notes', () => {
    expect(TERM_SUGGESTIONS.sharedAcrossRules).toBe(true);
    expect(TERM_SUGGESTIONS.sharedAcrossNotes).toBe(true);
  });
});

describe('a suggestion that is kept', () => {
  it('becomes a term proposal: the right spelling, in Terms, with its kind and the heard spelling as its variant', () => {
    const proposal = one();

    expect(proposal.kind).toBe('term');
    expect(proposal.payload).toEqual({
      title: 'Larkspur Pay',
      folder: 'Terms',
      properties: { kind: 'product', variants: ['Lark Spur Pay'] },
      body: '',
      linkFrom: null,
    });
    expect(proposal.source).toBe('[[Monday sync#^t0001]]');
    expect(proposal.cites.block).toBe('t0001');
    expect(proposal.confidence).toBe('high');
    expect(proposal.distinguishedBy).toBe('Lark Spur Pay');
    expect(proposal.sharedAcrossRules).toBe(true);
    expect(proposal.sharedAcrossNotes).toBe(true);
  });

  it('says in its reason what was heard, in which meeting, and what it is taken for', () => {
    const proposal = one();

    expect(proposal.why).toContain('Heard “Lark Spur Pay” in Monday sync');
    expect(proposal.why).toContain('mishearing of Larkspur Pay (a product)');
    expect(proposal.why).toContain('Accepting adds it to that term’s misheard spellings');
  });

  it('says “an acronym” for an acronym, and “a person” for a person', () => {
    expect(
      one({ kind: 'acronym', canonical: 'Mara Quill', heard: 'Mara Quil', source_block: 't0002' })
        .why,
    ).toContain('(an acronym)');
    expect(
      one({ kind: 'person', canonical: 'Mara Quill', heard: 'Mara Quil', source_block: 't0002' })
        .why,
    ).toContain('(a person)');
  });

  it.each(SUGGESTED_TERM_KINDS)('carries the kind %s into the term', (kind) => {
    expect(one({ kind }).payload.properties).toMatchObject({ kind });
  });

  it('tidies the spellings the model wrote', () => {
    const proposal = one({ heard: '  Lark   Spur Pay ', canonical: ' Larkspur   Pay  ' });

    expect(proposal.payload.title).toBe('Larkspur Pay');
    expect(proposal.payload.properties).toMatchObject({ variants: ['Lark Spur Pay'] });
  });

  it('accepts a citation written as a link to the meeting', () => {
    expect(one({ source_block: '[[Monday sync#^t0001]]' }).cites.block).toBe('t0001');
  });

  it('finds the heard spelling in the speaker’s label as well as the words', () => {
    const proposal = one({ heard: 'Tobias Fen', canonical: 'Tobias Fenn', source_block: 't0005' });

    expect(proposal.payload.title).toBe('Tobias Fenn');
  });

  it('keeps the good suggestions and reports the others in one answer', () => {
    const reading = read([
      item(),
      item({ heard: 'mark', canonical: 'Marq', source_block: 't0004' }),
    ]);

    expect(reading.value.map(({ payload }) => payload.title)).toEqual(['Larkspur Pay']);
    expect(reading.dropped).toHaveLength(1);
  });
});

describe('confidence', () => {
  it('keeps what the model said when the right spelling is in the vocabulary', () => {
    expect(one({ confidence: 'medium' }).confidence).toBe('medium');
    expect(one({ confidence: 'high' }).confidence).toBe('high');
  });

  it('keeps what the model said when the right spelling is a person or company the vocabulary has', () => {
    const proposal = one({ heard: 'Mara Quil', canonical: 'Mara Quill', source_block: 't0002' });

    expect(proposal.confidence).toBe('high');
    expect(proposal.why).not.toContain('check the spelling');
  });

  it('makes it low, and says so, when nobody can vouch for the right spelling', () => {
    const proposal = one({ canonical: 'Larkspur Paymaster', confidence: 'high' });

    expect(proposal.confidence).toBe('low');
    expect(proposal.why).toContain(
      "“Larkspur Paymaster” is not a name the vault or the meeting's attendees have, so check the spelling.",
    );
  });

  it('keeps what the model said when an attendee of the meeting has that name, though the vault does not', () => {
    const text = MONDAY.text.replace('Mara Quil will', 'Lena Hartt will');
    const attended = { ...meeting('Monday sync', 'gemini-aaa', [{ name: 'Lena Hart' }]), text };

    const proposal = one(
      { heard: 'Lena Hartt', canonical: 'Lena Hart', source_block: 't0002', confidence: 'medium' },
      about(attended),
    );

    expect(proposal.confidence).toBe('medium');
    expect(proposal.why).not.toContain('check the spelling');
  });

  it('makes it low against an empty vocabulary, when the run read none', () => {
    const context: AnswerContext = { notes: [MONDAY] };

    expect(one({ confidence: 'high' }, context).confidence).toBe('low');
  });
});

describe('a suggestion that is left out and reported', () => {
  it('names the item as heard → right spelling', () => {
    expect(droppedFor({ source_block: 't0099' }).title).toBe('Lark Spur Pay → Larkspur Pay');
  });

  it('cuts a long name down in the report', () => {
    const reported = droppedFor({ heard: `Lark ${'x'.repeat(100)}`, source_block: 't0099' }).title;

    expect(reported.length).toBeLessThan(120);
    expect(reported).toContain('→ Larkspur Pay');
  });

  it('leaves out one that cites no turn of the meeting', () => {
    expect(droppedFor({ source_block: 't0099' }).reason).toMatch(/no transcript turn \^t0099/);
    expect(droppedFor({ source_block: 'nonsense here' }).reason).toMatch(/not the id of a turn/);
  });

  it('leaves out one whose turn does not hold the spelling as written', () => {
    const left = droppedFor({ source_block: 't0002' });

    expect(left.reason).toContain('does not hold “Lark Spur Pay” as written');
  });

  it('leaves out one whose turn holds it only in other capitals', () => {
    const left = droppedFor({ heard: 'LARK SPUR PAY', source_block: 't0001' });

    expect(left.reason).toContain('does not hold “LARK SPUR PAY” as written');
  });

  it('leaves out one whose turn holds it only inside code', () => {
    const left = droppedFor({
      heard: 'Lark Spur Payroll',
      canonical: 'Larkspur Payroll',
      source_block: 't0006',
    });

    expect(left.reason).toContain('does not hold');
  });

  it('leaves out one that cites a different meeting than the one it was taken from', () => {
    expect(droppedFor({ source_block: '[[Friday sync#^t0001]]' }).reason).toMatch(
      /not the meeting it was taken from/,
    );
  });

  it('leaves out every item of an answer about two meetings', () => {
    const reading = schema.read(JSON.stringify({ terms: [item()] }), {
      notes: [MONDAY, FRIDAY],
      vault: vault(),
    });

    expect(reading).toMatchObject({ ok: true, value: [] });
    expect(reading.ok && reading.dropped[0]!.reason).toMatch(/one meeting at a time/);
  });

  it('leaves out one the variant rule refuses, saying the rule’s reason', () => {
    const left = droppedFor({ heard: 'mark', canonical: 'Marq Fenn', source_block: 't0004' });

    expect(left.reason).toMatch(/everyday word/);
  });

  it('leaves out words out of a name: Quill, while there is a Mara Quill', () => {
    const left = droppedFor({ heard: 'Quill', canonical: 'Quillen', source_block: 't0007' });

    expect(left.reason).toMatch(/part of the name “Mara Quill”/);
  });

  it('leaves out the name a person goes by', () => {
    expect(
      droppedFor({ heard: 'Mara Quill', canonical: 'Mara Quil', source_block: 't0001' }).reason,
    ).toMatch(/what someone in the vault goes by/);
  });

  it('leaves out one the vocabulary already lists as misheard', () => {
    const listed = vocabulary({
      terms: [term('Larkspur Pay', ['Lark Spur Pay'])],
      people: [],
      companies: [],
    });

    expect(droppedFor({}, about(MONDAY, listed)).reason).toMatch(
      /already listed as a misheard spelling/,
    );
  });

  it('holds a run that read no vocabulary only to the rule’s shape and the everyday words', () => {
    const context: AnswerContext = { notes: [MONDAY] };

    expect(one({}, context).payload.title).toBe('Larkspur Pay');
    const reading = read(
      [item({ heard: 'mark', canonical: 'Marq', source_block: 't0004' })],
      context,
    );
    expect(reading.dropped[0]!.reason).toMatch(/everyday word/);
  });
});

describe('an item that is unreadable alone', () => {
  it.each([
    ['is not an object', 'a string'],
    ['has no heard', { ...item(), heard: undefined }],
    ['has a blank heard', item({ heard: '   ' })],
    ['has a heard that is not text', item({ heard: 4 })],
    ['has no canonical', { ...item(), canonical: undefined }],
    ['has a blank canonical', item({ canonical: ' ' })],
    ['has an unknown kind', item({ kind: 'other' })],
    ['has no kind', { ...item(), kind: undefined }],
    ['has no source_block', { ...item(), source_block: undefined }],
    ['has an unknown confidence', item({ confidence: 'certain' })],
  ])('leaves out an item that %s, and keeps the next', (_what, bad) => {
    const reading = read([bad, item()]);

    expect(reading.value).toHaveLength(1);
    expect(reading.dropped).toHaveLength(1);
  });

  it('reports why: which part of the item is missing', () => {
    const reasons = (bad: unknown) => read([bad]).dropped[0]!.reason;

    expect(reasons({ ...item(), heard: undefined })).toContain('"heard"');
    expect(reasons({ ...item(), canonical: undefined })).toContain('"canonical"');
    expect(reasons(item({ kind: 'other' }))).toContain('product, person, company, acronym');
    expect(reasons({ ...item(), source_block: undefined })).toContain('"source_block"');
    expect(reasons(item({ confidence: 'certain' }))).toContain('high, medium, low');
  });

  it('refuses an answer that is not JSON of the shape asked for', () => {
    expect(schema.read('no json here', about(MONDAY)).ok).toBe(false);
    expect(schema.read(JSON.stringify({ items: [] }), about(MONDAY)).ok).toBe(false);
  });

  it('reads an empty list as nothing to suggest', () => {
    expect(read([])).toMatchObject({ ok: true, value: [], dropped: [] });
  });
});

describe('what the model is shown beside the meeting', () => {
  const data = (context: AnswerContext) =>
    Object.fromEntries(schema.dataFor(context).map(({ about: label, text }) => [label, text]));

  it('lists who was in the meeting, groups left out, and the vault’s terms with their known mishearings', () => {
    const shown = data(about(MONDAY));

    expect(shown['who was in the meeting']).toBe('Mara Quill');
    expect(shown['terms: the right spelling, then the mishearings already known']).toBe(
      'Larkspur Pay ← Lark Spur Pay Old\nLarkspur Payroll ← Larkspur Payrol',
    );
    expect(shown['the names of people in the vault']).toBe('Mara Quill\nTobias Fenn');
  });

  it('lists the names of companies', () => {
    const withCompany = vocabulary({
      terms: [],
      people: [],
      companies: [named('Larkspur Holdings'), named('Fenn Freight')],
    });

    const shown = data(about(MONDAY, withCompany));

    expect(shown['the names of companies in the vault']).toBe('Fenn Freight\nLarkspur Holdings');
    expect(shown['the names of people in the vault']).toBeUndefined();
  });

  it('lists a term with no mishearings by its right spelling alone', () => {
    const plain = vocabulary({ terms: [term('Quillwork')], people: [], companies: [] });

    expect(
      data(about(MONDAY, plain))['terms: the right spelling, then the mishearings already known'],
    ).toBe('Quillwork');
  });

  it('names an attendee once, however many meetings list them', () => {
    const shown = data({ notes: [MONDAY, FRIDAY], vault: vault() });

    expect(shown['who was in the meeting']).toBe('Mara Quill');
  });

  it('leaves out a list that is empty', () => {
    const shown = data({
      notes: [MONDAY],
      vault: vault(vocabulary({ terms: [], people: [], companies: [] })),
    });

    expect(Object.keys(shown)).toEqual(['who was in the meeting']);
  });

  it('shows nothing at all for a run that read no meeting', () => {
    const plain: AnsweredNote = { path: createVaultPath('Notes/Plain.md'), text: 'Just words.' };

    expect(schema.dataFor({ notes: [plain], vault: vault() })).toEqual([]);
  });

  it('shows no more than 300 names of a kind', () => {
    const many = vocabulary({
      terms: [],
      people: Array.from({ length: 350 }, (_, index) =>
        named(`Person ${String(index).padStart(3, '0')}`),
      ),
      companies: [],
    });

    const shown = data(about(MONDAY, many))['the names of people in the vault']!;

    expect(shown.split('\n')).toHaveLength(300);
  });

  it('shows no data when the run read no vocabulary, beyond who was there', () => {
    expect(Object.keys(data({ notes: [MONDAY] }))).toEqual(['who was in the meeting']);
  });
});

describe('which suggestions are one', () => {
  const idOf = (rule: string, proposal: Parameters<typeof claudeProposalId>[0]['proposal']) =>
    claudeProposalId({ rule, proposal });
  const suggest = (note: AnsweredNote, fields: Record<string, unknown> = {}) =>
    one(fields, about(note));

  it('is one id for the same heard → right spelling cited in two meetings, in two turns, by two rules', () => {
    const monday = suggest(MONDAY, { source_block: 't0001' });
    const friday = suggest(FRIDAY, { source_block: 't0003' });

    expect(idOf('rule-a', monday)).toBe(idOf('rule-b', friday));
    expect(idOf('rule-a', monday)).toBe(idOf('rule-a', monday));
  });

  it('is one id however the right spelling is capitalised or spaced', () => {
    const plain = suggest(MONDAY);
    const loose = suggest(MONDAY, { canonical: ' larkspur   pay ' });

    expect(idOf('rule-a', loose)).toBe(idOf('rule-a', plain));
  });

  it('is another id for a different heard spelling of another name', () => {
    const plain = suggest(MONDAY);
    const different = suggest(MONDAY, {
      heard: 'Mara Quil',
      canonical: 'Mara Quill',
      source_block: 't0002',
    });

    expect(idOf('rule-a', different)).not.toBe(idOf('rule-a', plain));
  });

  it('is another id for a different heard spelling that is taken for the same name', () => {
    const text = MONDAY.text.replace('Mara Quil will', 'Larkspurpay will');
    const heardElsewhere = { ...MONDAY, text };
    const first = suggest(MONDAY);
    const second = suggest(heardElsewhere, { heard: 'Larkspurpay', source_block: 't0002' });

    expect(idOf('rule-a', second)).not.toBe(idOf('rule-a', first));
  });
});
