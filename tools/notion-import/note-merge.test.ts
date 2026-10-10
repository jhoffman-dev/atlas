import { describe, expect, it } from 'vitest';
import {
  bodyDigest,
  importedAs,
  mergeNote,
  NOTHING,
  valueDigest,
  type ImportedPage,
  type WantedContent,
} from './note-merge.ts';

const wanted = (fields: Record<string, unknown>, body = '', fillOnly = {}): WantedContent => ({
  fields,
  fillOnly,
  body,
});

/** The record a run that brought in `fields` and `body` leaves. */
const lastRun = (fields: Record<string, unknown>, body = ''): ImportedPage =>
  importedAs(wanted(fields, body));

describe('a digest', () => {
  it('reads every way of saying nothing as nothing', () => {
    for (const value of [null, undefined, '', '  ', []]) expect(valueDigest(value)).toBe(NOTHING);
    expect(bodyDigest('\n\n')).toBe(NOTHING);
  });

  it('tells values apart, and a body by its words, not the blank lines around them', () => {
    expect(valueDigest('next-action')).not.toBe(valueDigest('waiting'));
    expect(valueDigest(['[[A]]'])).not.toBe(valueDigest('[[A]]'));
    expect(bodyDigest('\nWords\n')).toBe(bodyDigest('Words'));
  });
});

describe('merging a note with Notion, against the last import', () => {
  const last = lastRun({ status: 'next-action', priority: 'H' }, 'Old words');

  it("takes Notion's change where Atlas left the value as imported", () => {
    const merge = mergeNote({
      now: { properties: { status: 'next-action', priority: 'H' }, body: '\nOld words\n' },
      wanted: wanted({ status: 'waiting', priority: 'H' }, '\nNew words\n'),
      last,
    });
    expect(merge.changes).toEqual({ status: 'waiting' });
    expect(merge.body).toBe('\nNew words\n');
    expect(merge.kept).toEqual([]);
  });

  it('leaves an edit made in Atlas when Notion has not changed, and lists nothing', () => {
    const merge = mergeNote({
      now: { properties: { status: 'in-progress', priority: 'H' }, body: 'Edited' },
      wanted: wanted({ status: 'next-action', priority: 'H' }, 'Old words'),
      last,
    });
    expect(merge.changes).toEqual({});
    expect(merge.body).toBeNull();
    expect(merge.kept).toEqual([]);
  });

  it("keeps Atlas's value, and lists it, when both changed", () => {
    const merge = mergeNote({
      now: { properties: { status: 'in-progress', priority: 'H' }, body: 'Edited' },
      wanted: wanted({ status: 'waiting', priority: 'L' }, 'Rewritten'),
      last,
    });
    expect(merge.changes).toEqual({ priority: 'L' });
    expect(merge.body).toBeNull();
    expect(merge.kept).toEqual(['status', 'body']);
  });

  it('records what Notion says now, so a difference is listed once and the next run is quiet', () => {
    const now = { properties: { status: 'in-progress', priority: 'H' }, body: 'Edited' };
    const first = mergeNote({
      now,
      wanted: wanted({ status: 'waiting', priority: 'H' }, 'Old words'),
      last,
    });
    const second = mergeNote({
      now,
      wanted: wanted({ status: 'waiting', priority: 'H' }, 'Old words'),
      last: first.imported,
    });
    expect(first.kept).toEqual(['status']);
    expect(second.kept).toEqual([]);
    expect(second.changes).toEqual({});
  });

  it('takes a value out when Notion cleared it and Atlas still holds what was imported', () => {
    const merge = mergeNote({
      now: { properties: { status: 'next-action', priority: 'H' }, body: 'Old words' },
      wanted: wanted({ status: 'next-action' }, 'Old words'),
      last,
    });
    expect(merge.changes).toEqual({ priority: null });
    expect(merge.imported.fields).not.toHaveProperty('priority');
  });

  it('changes nothing where the note already says what Notion says', () => {
    const merge = mergeNote({
      now: { properties: { status: 'waiting' }, body: 'Same' },
      wanted: wanted({ status: 'waiting' }, '\nSame\n'),
      last: null,
    });
    expect(merge).toMatchObject({ changes: {}, body: null, kept: [] });
  });
});

describe('merging a note no run of this import recorded', () => {
  it('fills in what the note lacks, and keeps and lists every value that differs', () => {
    const merge = mergeNote({
      now: { properties: { type: 'project', team: 'Platform' }, body: 'Earlier import' },
      wanted: wanted({ type: 'area', team: '[[Platform]]', priority: 'High' }, 'Notion words'),
      last: null,
    });
    expect(merge.changes).toEqual({ priority: 'High' });
    expect(merge.kept).toEqual(['type', 'team', 'body']);
  });

  it('writes the body into a note that has none', () => {
    const merge = mergeNote({
      now: { properties: {}, body: '\n' },
      wanted: wanted({}, '\nNotion words\n'),
      last: null,
    });
    expect(merge.body).toBe('\nNotion words\n');
  });
});

describe('a value set only once', () => {
  it('is set where the note has none, and never changed once there', () => {
    const fill = { completed: '2026-10-10' };
    const absent = mergeNote({
      now: { properties: {}, body: '' },
      wanted: wanted({}, '', fill),
      last: null,
    });
    const present = mergeNote({
      now: { properties: { completed: '2026-09-01' }, body: '' },
      wanted: wanted({}, '', fill),
      last: null,
    });
    expect(absent.changes).toEqual(fill);
    expect(present.changes).toEqual({});
    expect(absent.imported.fields).not.toHaveProperty('completed');
  });
});
