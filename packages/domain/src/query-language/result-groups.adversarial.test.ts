import { describe, expect, it } from 'vitest';
import type { BoardRow } from '../query/group-rows.ts';
import { queryableFields, type QueryField } from './fields.ts';
import { QUERY_TEST_TYPES } from './query-fixtures.ts';
import { groupResultRows, type RowGroup } from './result-groups.ts';

/**
 * Adversarial: a group's id is what a collapsed header is remembered by, so it
 * has to be stable across runs and unique among all the groups (RowGroup.id).
 */

const FIELDS = queryableFields(QUERY_TEST_TYPES, ['task']);
const field = (text: string): QueryField => {
  const found = FIELDS.find((candidate) => candidate.text === text);
  if (found === undefined) throw new Error(`no field ${text}`);
  return found;
};

const row = (title: string, values: Record<string, unknown>): BoardRow => ({
  path: `tasks/${title}.md`,
  title,
  values: { title, ...values },
});

const allIds = (groups: readonly RowGroup[]): string[] =>
  groups.flatMap((group) => [group.id, ...allIds(group.subgroups)]);

describe('groupResultRows ids (adversarial)', () => {
  it('gives a relation group the same id whichever spelling of the link comes first', () => {
    // Why: the id is built from the first spelling seen ([[Atlas]] or [[atlas]]), so re-sorting the rows renames the group.
    const one = row('One', { project: '[[Atlas]]' });
    const two = row('Two', { project: '[[atlas]]' });
    const groups = [field('project')];
    const before = groupResultRows({ rows: [one, two], groups }).map((group) => group.id);
    const after = groupResultRows({ rows: [two, one], groups }).map((group) => group.id);
    expect(before).toHaveLength(1);
    expect(after).toEqual(before);
  });

  it('never gives a group and a sub-group the same id', () => {
    // Why: ids join `/field=value` unescaped, so the value "x/notes=y" at the top reads as group x, sub-group y.
    const groups = groupResultRows({
      rows: [row('A', { status: 'x/notes=y', notes: 'z' }), row('B', { status: 'x', notes: 'y' })],
      groups: [field('status'), field('notes')],
    });
    const ids = allIds(groups);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
