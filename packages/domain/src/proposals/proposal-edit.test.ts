import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { readProposal, readProposalPayload, type ProposalNote } from './proposal.ts';
import { editedPayload, payloadFields, propertyFromText, propertyText } from './proposal-edit.ts';

function proposal(properties: Record<string, unknown>): ProposalNote {
  const reading = readProposal({ path: createVaultPath('Inbox/Proposals/P.md'), properties });
  if (!reading.ok) throw new Error(reading.problem);
  return reading.proposal;
}

const task = proposal({
  kind: 'task',
  payload: {
    title: 'Call Tobias',
    folder: 'Work',
    body: 'About Q4.',
    properties: { status: 'next', estimate: 2, people: ['[[Tobias Fenn]]'], flagged: false },
  },
});

describe('payloadFields', () => {
  it('shows a note proposal’s title, body and each property as text, in order', () => {
    expect(payloadFields(task)).toEqual({
      kind: 'note',
      title: 'Call Tobias',
      body: 'About Q4.',
      properties: [
        ['status', 'next'],
        ['estimate', '2'],
        ['people', '[[Tobias Fenn]]'],
        ['flagged', 'false'],
      ],
    });
  });

  it('shows a link proposal’s link alone', () => {
    const link = proposal({
      kind: 'link',
      payload: { note: 'A.md', property: 'company', link: '[[Larkspur Payroll]]', digest: 'd' },
    });
    expect(payloadFields(link)).toEqual({ kind: 'link', link: '[[Larkspur Payroll]]' });
  });
});

describe('editedPayload', () => {
  it('reads back what was typed, each property in the shape it had, keeping the folder', () => {
    const edited = editedPayload(task, {
      kind: 'note',
      title: 'Call Tobias Fenn',
      body: 'About Q4 and Q1.',
      properties: [
        ['status', 'doing'],
        ['estimate', '3'],
        ['people', '[[Tobias Fenn]], [[Mara Quill]]'],
        ['flagged', 'true'],
      ],
    });
    expect(readProposalPayload('task', edited)).toEqual({
      ok: true,
      payload: {
        title: 'Call Tobias Fenn',
        folder: 'Work',
        body: 'About Q4 and Q1.',
        properties: {
          status: 'doing',
          estimate: 3,
          people: ['[[Tobias Fenn]]', '[[Mara Quill]]'],
          flagged: true,
        },
      },
    });
  });

  it('changes only a link proposal’s link', () => {
    const link = proposal({
      kind: 'link',
      payload: { note: 'A.md', property: 'company', link: '[[Larkspur]]', digest: 'd' },
    });
    expect(editedPayload(link, { kind: 'link', link: '[[Larkspur Payroll]]' })).toEqual({
      note: 'A.md',
      property: 'company',
      link: '[[Larkspur Payroll]]',
      digest: 'd',
    });
  });
});

describe('propertyText and propertyFromText', () => {
  it('shows nothing for no value, and an object as JSON', () => {
    expect(propertyText(null)).toBe('');
    expect(propertyText({ a: 1 })).toBe('{"a":1}');
  });

  it('keeps text that no longer reads as the number or yes/no it was', () => {
    expect(propertyFromText('two', 2)).toBe('two');
    expect(propertyFromText('', 2)).toBe('');
    expect(propertyFromText('maybe', true)).toBe('maybe');
  });

  it('reads an emptied list as an empty list', () => {
    expect(propertyFromText('  ', ['[[A]]'])).toEqual([]);
  });
});
