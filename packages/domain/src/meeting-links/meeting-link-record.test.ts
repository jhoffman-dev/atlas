import { describe, expect, it } from 'vitest';
import {
  addedLinks,
  linkRecordProperties,
  linksTakenBack,
  linksUndone,
  recordedLinks,
  UNDONE_LINK_PROPERTIES,
  wasLinked,
} from './meeting-link-record.ts';

const PROPOSAL = 'Inbox/Proposals/Ada Venn — Standup.md';

describe('the record linking leaves on a meeting', () => {
  it('writes the links it added by relation, and the proposals it wrote', () => {
    expect(
      linkRecordProperties({
        links: [
          { key: 'people', added: ['[[Mara Quill]]', '[[Tobias Fenn]]'] },
          { key: 'companies', added: [] },
        ],
        proposals: [PROPOSAL as never],
      }),
    ).toEqual({
      atlas_links: [{ key: 'people', added: ['[[Mara Quill]]', '[[Tobias Fenn]]'] }],
      atlas_link_proposals: [PROPOSAL],
    });
  });

  it('marks a meeting nobody was linked to, with no key for proposals it did not write', () => {
    expect(linkRecordProperties({ links: [], proposals: [] })).toEqual({ atlas_links: 'none' });
    expect(
      linkRecordProperties({ links: [{ key: 'people', added: [] }], proposals: [PROPOSAL as never] }),
    ).toEqual({ atlas_links: 'none', atlas_link_proposals: [PROPOSAL] });
  });

  it('says a meeting was linked for the key in any form, and only then', () => {
    expect(wasLinked({})).toBe(false);
    expect(wasLinked({ people: ['[[Mara Quill]]'] })).toBe(false);
    for (const value of ['none', 'undone', [], [{ key: 'people', added: ['[[Mara Quill]]'] }]]) {
      expect(wasLinked({ atlas_links: value })).toBe(true);
    }
    expect(linksUndone({ atlas_links: 'undone' })).toBe(true);
    expect(linksUndone({ atlas_links: 'none' })).toBe(false);
  });

  it('reads back what an undo could take: links added, proposals written, or both', () => {
    const written = linkRecordProperties({
      links: [{ key: 'people', added: ['[[Mara Quill]]'] }],
      proposals: [PROPOSAL as never],
    });
    expect(recordedLinks(written)).toEqual({
      links: [{ key: 'people', added: ['[[Mara Quill]]'] }],
      proposals: [PROPOSAL],
    });
    expect(recordedLinks({ atlas_links: 'none', atlas_link_proposals: [PROPOSAL] })).toEqual({
      links: [],
      proposals: [PROPOSAL],
    });
  });

  it('has nothing to undo for a meeting never linked, linked to no one, or undone', () => {
    expect(recordedLinks({})).toBeNull();
    expect(recordedLinks({ atlas_links: 'none' })).toBeNull();
    expect(recordedLinks({ atlas_links: 'undone', atlas_link_proposals: [PROPOSAL] })).toBeNull();
    expect(recordedLinks({ atlas_links: [] })).toBeNull();
  });

  it('believes only what linking writes: its two relations, links that are text, proposals where proposals wait', () => {
    expect(
      recordedLinks({
        atlas_links: [
          { key: 'title', added: ['Renamed'] },
          { key: 'project', added: ['[[Ledger]]'] },
          { key: 'companies', added: ['[[Larkspur Payroll]]', 7, '', null] },
          { key: 'people', added: 'everyone' },
          'people',
          null,
        ],
        atlas_link_proposals: [
          PROPOSAL,
          'People/Mara Quill.md',
          '../outside.md',
          '.atlas/settings.md',
          12,
        ],
      }),
    ).toEqual({
      links: [{ key: 'companies', added: ['[[Larkspur Payroll]]'] }],
      proposals: [PROPOSAL],
    });
  });
});

describe('the links a relation gained', () => {
  it('are those in its value after that were not in it before, as written', () => {
    expect(addedLinks(['[[Tobias Fenn]]'], ['[[Tobias Fenn]]', '[[Mara Quill]]'])).toEqual([
      '[[Mara Quill]]',
    ]);
    expect(addedLinks(undefined, ['[[Mara Quill]]'])).toEqual(['[[Mara Quill]]']);
    expect(addedLinks('[[Mara Quill]]', ['[[Mara Quill]]'])).toEqual([]);
  });
});

describe('taking a meeting’s links back', () => {
  const record = {
    links: [
      { key: 'people', added: ['[[Mara Quill]]', '[[Tobias Fenn]]'] },
      { key: 'companies', added: ['[[Larkspur Payroll]]'] },
    ],
    proposals: [],
  };

  it('takes out exactly the links linking added, and marks the meeting undone', () => {
    const taken = linksTakenBack({
      properties: {
        people: ['[[Ada Venn]]', '[[Mara Quill]]', '[[Tobias Fenn]]'],
        companies: ['[[Larkspur Payroll]]'],
      },
      record,
    });
    expect(taken).toEqual({
      values: { people: ['[[Ada Venn]]'], companies: null, ...UNDONE_LINK_PROPERTIES },
      removed: 3,
    });
    expect(taken.values).toMatchObject({ atlas_links: 'undone', atlas_link_proposals: null });
  });

  it('leaves a link the person took out, rewrote or added, and a relation it has nothing in', () => {
    const taken = linksTakenBack({
      properties: {
        // Mara was taken out by hand; Tobias was rewritten with a label: neither is linking's any more.
        people: ['[[Tobias Fenn|Toby]]', '[[Ada Venn]]'],
        companies: ['[[Larkspur Payroll]]', '[[Fenn & Co]]'],
      },
      record,
    });
    expect(taken.removed).toBe(1);
    expect(taken.values).toEqual({ companies: ['[[Fenn & Co]]'], ...UNDONE_LINK_PROPERTIES });
  });

  it('reads a relation written as one link, and leaves one that is no longer links', () => {
    expect(
      linksTakenBack({ properties: { people: '[[Mara Quill]]' }, record }).values,
    ).toMatchObject({ people: null });
    const odd = linksTakenBack({ properties: { people: { a: 1 }, companies: 7 }, record });
    expect(odd).toEqual({ values: { ...UNDONE_LINK_PROPERTIES }, removed: 0 });
  });

  it('marks the meeting undone even when every link has gone already', () => {
    expect(linksTakenBack({ properties: {}, record })).toEqual({
      values: { ...UNDONE_LINK_PROPERTIES },
      removed: 0,
    });
  });
});
