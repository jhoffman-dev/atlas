/**
 * Which group a value puts a row in (issue #6 review): the one rule a board's
 * columns are drawn by and a card's move is checked against, so a card the
 * board shows in a column is never "moved" into it again.
 */

import { describe, expect, it } from 'vitest';
import type { BoardRow } from '../query/group-rows.ts';
import { groupKeyOf, groupResultRows } from './result-groups.ts';

const relation = { kind: 'relation' } as const;
const select = { kind: 'select' } as const;
const checkbox = { kind: 'checkbox' } as const;

describe('groupKeyOf', () => {
  it('keys a relation by its first linked note, however the link is spelled', () => {
    const keys = ['[[Atlas]]', '[[atlas]]', '[[Projects/Atlas]]', '[[atlas|The app]]'].map((raw) =>
      groupKeyOf(relation, raw),
    );

    expect(new Set(keys)).toEqual(new Set(['atlas']));
  });

  it("keys a relation holding several links by the first, as the board's column is", () => {
    expect(groupKeyOf(relation, '[[A]], [[B]]')).toBe(groupKeyOf(relation, '[[a]]'));
    expect(groupKeyOf(relation, ['[[A]]', '[[B]]'])).toBe('a');
  });

  it('keys a missing box and an unticked one alike, as the unticked column holds both', () => {
    expect(groupKeyOf(checkbox, undefined)).toBe('false');
    expect(groupKeyOf(checkbox, null)).toBe('false');
    expect(groupKeyOf(checkbox, false)).toBe('false');
    expect(groupKeyOf(checkbox, 'false')).toBe('false');
    expect(groupKeyOf(checkbox, true)).toBe('true');
    expect(groupKeyOf(checkbox, 'true')).toBe('true');
  });

  it('keys an option trimmed and composed, but never folded in case', () => {
    expect(groupKeyOf(select, ' done ')).toBe('done');
    expect(groupKeyOf(select, 'Café')).toBe(groupKeyOf(select, 'Café'));
    expect(groupKeyOf(select, 'Done')).not.toBe(groupKeyOf(select, 'done'));
  });

  it('keys no value, and a blank one, as "No value"', () => {
    expect(groupKeyOf(select, null)).toBeNull();
    expect(groupKeyOf(select, undefined)).toBeNull();
    expect(groupKeyOf(select, '  ')).toBeNull();
  });

  it('keys every row into the group the board draws it in', () => {
    const rows: BoardRow[] = ['[[Projects/Atlas]]', '[[atlas]], [[Garden]]', null].map(
      (project, at) => ({ path: `${at}.md`, title: String(at), values: { project } }),
    );
    const groups = groupResultRows({
      rows,
      groups: [
        {
          text: 'project',
          label: 'Project',
          via: null,
          key: 'project',
          kind: 'relation',
          options: [],
          target: 'project',
          many: false,
        },
      ],
    });

    for (const group of groups) {
      for (const row of group.rows) {
        expect(groupKeyOf(relation, row.values['project'])).toBe(groupKeyOf(relation, group.value));
      }
    }
  });
});
