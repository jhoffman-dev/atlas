import { describe, expect, it } from 'vitest';
import type { BoardRow } from '../query/group-rows.ts';
import { noteNames } from '../types/relation-names.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { queryableFields, type QueryField } from './fields.ts';
import { QUERY_TEST_TYPES } from './query-fixtures.ts';
import { groupResultRows, type RowGroup } from './result-groups.ts';

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

const ROWS = [
  row('A', { project: '[[Atlas]]', status: 'done', flagged: 'true' }),
  row('B', { project: '[[atlas|The app]]', status: 'doing' }),
  row('C', { project: '[[Garden]]', status: 'backlog', flagged: 'false' }),
  row('D', { project: null, status: 'doing' }),
  row('E', { project: '[[Atlas]]', status: 'doing' }),
];

const names = noteNames([
  { path: createVaultPath('projects/Atlas.md'), title: 'Atlas' },
  { path: createVaultPath('projects/Garden.md'), title: 'Garden' },
]);

/** Each group as its label, count and what is under it. */
function outline(groups: readonly RowGroup[]): unknown[] {
  return groups.map((group) =>
    group.subgroups.length === 0
      ? [group.label, group.rows.map((found) => found.title)]
      : [group.label, group.rows.length, outline(group.subgroups)],
  );
}

describe('groupResultRows', () => {
  it('runs a select’s declared options backwards when the view sorts it descending, “No value” still last', () => {
    const groups = groupResultRows({
      rows: ROWS,
      groups: [{ ...field('status'), direction: 'desc' }],
    });
    expect(groups.map((group) => group.label)).toEqual(['done', 'doing', 'backlog']);
    const withNone = groupResultRows({
      rows: [...ROWS, row('F', { status: null })],
      groups: [{ ...field('status'), direction: 'desc' }],
    });
    expect(withNone.map((group) => group.label).at(-1)).toBe('No value');
  });

  it('groups, then sub-groups each group, a select in its declared order', () => {
    const groups = groupResultRows({
      rows: ROWS,
      groups: [field('project'), field('status')],
      names,
    });
    expect(outline(groups)).toEqual([
      [
        'Atlas',
        3,
        [
          ['doing', ['B', 'E']],
          ['done', ['A']],
        ],
      ],
      ['Garden', 1, [['backlog', ['C']]]],
      ['No value', 1, [['doing', ['D']]]],
    ]);
  });

  it('groups by one field alone', () => {
    expect(outline(groupResultRows({ rows: ROWS, groups: [field('status')] }))).toEqual([
      ['backlog', ['C']],
      ['doing', ['B', 'D', 'E']],
      ['done', ['A']],
    ]);
  });

  it('gives no groups when there is nothing to group by', () => {
    expect(groupResultRows({ rows: ROWS, groups: [] })).toEqual([]);
  });

  it('keeps a declared value nobody has only when asked to, and only at the top', () => {
    const shown = (keepEmpty: boolean) =>
      groupResultRows({
        rows: ROWS.slice(0, 1),
        groups: [field('status'), field('flagged')],
        keepEmpty,
      }).map((group) => [group.label, group.subgroups.map((sub) => sub.label)]);
    expect(shown(false)).toEqual([['done', ['true']]]);
    expect(shown(true)).toEqual([
      ['backlog', []],
      ['doing', []],
      ['done', ['true']],
    ]);
  });

  it('gives every group an id no other group has, the same on every run', () => {
    const ids = (groups: readonly RowGroup[]): string[] =>
      groups.flatMap((group) => [group.id, ...ids(group.subgroups)]);
    const first = ids(
      groupResultRows({ rows: ROWS, groups: [field('project'), field('status')], names }),
    );
    const again = ids(
      groupResultRows({ rows: ROWS, groups: [field('project'), field('status')], names }),
    );
    expect(new Set(first).size).toBe(first.length);
    expect(again).toEqual(first);
    expect(first).toContain('/["project","atlas"]/["status","doing"]');
  });

  it('tones a select’s groups and leaves a relation’s plain', () => {
    const [project] = groupResultRows({ rows: ROWS, groups: [field('project')], names });
    const [status] = groupResultRows({ rows: ROWS, groups: [field('status')] });
    expect(project?.tone).toBeNull();
    expect(status?.tone).not.toBeNull();
    const numbered = [row('N', { estimate: 3 })];
    const [estimate] = groupResultRows({ rows: numbered, groups: [field('estimate')] });
    expect(estimate?.label).toBe('3');
    expect(estimate?.tone).toBeNull();
  });
});
