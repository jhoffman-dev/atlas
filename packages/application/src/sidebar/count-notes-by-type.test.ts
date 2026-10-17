import { describe, expect, it, vi } from 'vitest';
import { TYPE_COUNTS_QUERY_MARK, type ObjectType } from '@atlas/domain';
import { fakeIndexPort } from '../testing/fake-ports.ts';
import { countNotesByType } from './count-notes-by-type.ts';

const type = (name: string): ObjectType => ({ name, label: name, properties: [] });

/** An index that answers the counts query with `rows`, and says each query it was asked. */
function countingIndex(rows: readonly (readonly unknown[])[], columns = ['type', 'count']) {
  const query = vi.fn(async () => ({ columns, rows, truncated: false }));
  const notesOfType = vi.fn(async () => [{ path: 'a.md', title: 'a' }]);
  return { index: fakeIndexPort({ query, notesOfType }), query, notesOfType };
}

describe('countNotesByType', () => {
  it('asks the index once for every type’s count, and never for the notes themselves', async () => {
    const { index, query, notesOfType } = countingIndex([
      ['task', 2],
      ['person', 1],
    ]);

    const counts = await countNotesByType({
      index,
      types: [type('task'), type('person'), type('project')],
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql.startsWith(TYPE_COUNTS_QUERY_MARK)).toBe(true);
    expect(parameters).toEqual(['task', 'person', 'project']);
    expect(notesOfType).not.toHaveBeenCalled();
    expect(counts).toEqual(
      new Map([
        ['task', 2],
        ['person', 1],
        ['project', 0],
      ]),
    );
  });

  it('reads the counts by column name, wherever the index puts them', async () => {
    const { index } = countingIndex([[3, 'task']], ['count', 'type']);
    const counts = await countNotesByType({ index, types: [type('task')] });
    expect(counts.get('task')).toBe(3);
  });

  it('keeps no count for a type it did not ask about', async () => {
    const { index } = countingIndex([
      ['task', 2],
      ['ghost', 9],
    ]);
    const counts = await countNotesByType({ index, types: [type('task')] });
    expect([...counts.keys()]).toEqual(['task']);
  });

  it('counts every type as none when the index cannot answer, rather than failing the sidebar', async () => {
    const index = fakeIndexPort({
      query: async () => {
        throw new Error('the index is being rebuilt');
      },
    });

    const onFailed = vi.fn();
    const counts = await countNotesByType({
      index,
      types: [type('task'), type('person')],
      onFailed,
    });

    expect(counts).toEqual(
      new Map([
        ['task', 0],
        ['person', 0],
      ]),
    );
    expect(onFailed).toHaveBeenCalledWith(new Error('the index is being rebuilt'));
  });

  it('asks nothing of the index when the vault has no types', async () => {
    const { index, query, notesOfType } = countingIndex([]);
    const counts = await countNotesByType({ index, types: [] });
    expect(counts.size).toBe(0);
    expect(query).not.toHaveBeenCalled();
    expect(notesOfType).not.toHaveBeenCalled();
  });
});
