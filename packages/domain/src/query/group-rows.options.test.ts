import { describe, expect, it } from 'vitest';
import { groupRows, type BoardRow } from './group-rows.ts';

/**
 * Adversarial: the board's drag (P14-03) keys each column by its value — as the
 * droppable id, the React key, and the list `boardStep` walks with `indexOf`.
 * Those only work if no two columns share a value. `options` comes straight
 * from a hand-edited type file (`asStrings`), with nothing removing a repeat.
 */

const row = (path: string, status: unknown): BoardRow => ({
  path,
  title: path,
  values: { path, status },
});

describe('groupRows, given a type that lists an option twice', () => {
  const columns = groupRows({
    rows: [row('a.md', 'todo'), row('b.md', 'doing')],
    groupBy: 'status',
    options: ['todo', 'doing', 'todo'],
  });

  it('draws each value as one column', () => {
    expect(columns.map((column) => column.value)).toEqual(['todo', 'doing']);
  });

  it('puts each card on the board once', () => {
    const paths = columns.flatMap((column) => column.rows.map((card) => card.path));
    expect(paths.sort()).toEqual(['a.md', 'b.md']);
  });
});
