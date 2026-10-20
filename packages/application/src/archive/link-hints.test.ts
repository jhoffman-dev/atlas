import { describe, expect, it } from 'vitest';
import { LINK_HINTS_QUERY_COLUMNS, LINK_HINTS_QUERY_MARK } from '@atlas/domain';
import { fakeIndexPort } from '../testing/fake-ports.ts';
import { readLinkHints } from './link-hints.ts';

const answering = (rows: unknown[][], columns: readonly string[] = LINK_HINTS_QUERY_COLUMNS) => {
  const asked: string[] = [];
  const index = fakeIndexPort({
    query: async (sql) => {
      asked.push(sql);
      return { columns: [...columns], rows, truncated: false };
    },
  });
  return { index, asked };
};

describe('readLinkHints', () => {
  it('reads the notes, their aliases and their use in one query', async () => {
    const { index, asked } = answering([
      ['note', 'people/Mara Quill.md', 'Mara Quill', null, null],
      ['note', 'people/Tobias Fenn.md', 'Tobias Fenn', null, null],
      ['alias', 'people/Mara Quill.md', 'MQ', null, null],
      ['alias', 'people/Mara Quill.md', 'Mara', null, null],
      ['use', 'people/Tobias Fenn.md', null, 3, 1700],
    ]);
    const read = await readLinkHints({ index });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.startsWith(LINK_HINTS_QUERY_MARK)).toBe(true);
    expect(read.notes).toEqual([
      { path: 'people/Mara Quill.md', title: 'Mara Quill' },
      { path: 'people/Tobias Fenn.md', title: 'Tobias Fenn' },
    ]);
    expect(read.hints.aliases.get('people/Mara Quill.md')).toEqual(['MQ', 'Mara']);
    expect(read.hints.uses.get('people/Tobias Fenn.md')).toEqual({ count: 3, last: 1700 });
  });

  it('leaves out archived notes and templates, which no link field offers', async () => {
    const { index } = answering([
      ['note', 'Archive/Old Co.md', 'Old Co', null, null],
      ['note', 'Larkspur Payroll.md', 'Larkspur Payroll', null, null],
      ['note', 'assets/logo.png', 'logo.png', null, null],
    ]);
    expect((await readLinkHints({ index })).notes).toEqual([
      { path: 'Larkspur Payroll.md', title: 'Larkspur Payroll' },
    ]);
  });

  it('finds its columns by name, whatever order they come back in', async () => {
    const { index } = answering(
      [[1700, 2, null, 'people/Tobias Fenn.md', 'use']],
      ['last', 'uses', 'text', 'path', 'kind'],
    );
    const read = await readLinkHints({ index });
    expect(read.hints.uses.get('people/Tobias Fenn.md')).toEqual({ count: 2, last: 1700 });
  });

  it('skips a row it cannot read rather than offering nonsense', async () => {
    const { index } = answering([
      ['note', null, 'No path', null, null],
      ['alias', 'a.md', 42, null, null],
      ['use', 'b.md', null, 'many', null],
      ['other', 'c.md', 'x', null, null],
    ]);
    const read = await readLinkHints({ index });
    expect(read.notes).toEqual([]);
    expect(read.hints.aliases.size).toBe(0);
    expect(read.hints.uses.size).toBe(0);
  });

  it('passes on an index that cannot answer', async () => {
    const index = fakeIndexPort({
      query: async () => {
        throw new Error('The index is not open.');
      },
    });
    await expect(readLinkHints({ index })).rejects.toThrow('The index is not open.');
  });
});
