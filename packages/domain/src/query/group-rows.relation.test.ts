/**
 * Grouping a board by a relation: tasks by project, one column per project.
 *
 * A relation's value is a link, and the same note can be linked several ways,
 * so the column is the note the link points at — named by its title, never
 * shown as `[[…]]`, and the value a card moved there is given is the link.
 */
import { describe, expect, it } from 'vitest';
import { noteNames } from '../types/relation-names.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import { groupRows, type BoardRow } from './group-rows.ts';

const task = (path: string, project: unknown): BoardRow => ({
  path,
  title: path,
  values: { path, project },
});

describe('grouping by a relation', () => {
  it('makes one column per project, named by the project', () => {
    const columns = groupRows({
      rows: [task('a', '[[Atlas]]'), task('b', '[[Garden]]'), task('c', '[[Atlas]]')],
      groupBy: 'project',
      options: [],
      grouping: 'relation',
    });
    expect(columns.map((column) => [column.label, column.value, column.rows.length])).toEqual([
      ['Atlas', '[[Atlas]]', 2],
      ['Garden', '[[Garden]]', 1],
    ]);
  });

  it('puts every spelling of one link in one column', () => {
    const columns = groupRows({
      rows: [
        task('a', '[[Atlas]]'),
        task('b', '[[projects/Atlas]]'),
        task('c', '[[atlas|The app]]'),
      ],
      groupBy: 'project',
      options: [],
      grouping: 'relation',
    });
    expect(columns).toHaveLength(1);
    expect(columns[0]?.rows.map((row) => row.path)).toEqual(['a', 'b', 'c']);
    expect(columns[0]?.label).toBe('Atlas');
  });

  it('shows the declared projects first, in order, even with nothing in them', () => {
    const columns = groupRows({
      rows: [task('a', '[[Zebra]]'), task('b', '[[Garden]]')],
      groupBy: 'project',
      options: ['[[Garden]]', '[[Atlas]]'],
      grouping: 'relation',
    });
    expect(columns.map((column) => [column.label, column.rows.length])).toEqual([
      ['Garden', 1],
      ['Atlas', 0],
      ['Zebra', 1],
    ]);
  });

  it('groups a card linked to several projects under the first', () => {
    const columns = groupRows({
      rows: [task('a', '[[Garden]], [[Atlas]]')],
      groupBy: 'project',
      options: [],
      grouping: 'relation',
    });
    expect(columns.map((column) => column.label)).toEqual(['Garden']);
  });

  it('keeps the cards with no project, and any plain text, rather than dropping them', () => {
    const columns = groupRows({
      rows: [task('a', null), task('b', 'Atlas-ish'), task('c', '  ')],
      groupBy: 'project',
      options: [],
      grouping: 'relation',
    });
    expect(columns.map((column) => [column.label, column.rows.length])).toEqual([
      ['Atlas-ish', 1],
      ['No value', 2],
    ]);
  });

  it('names a column by the title the project gives itself, as every list does', () => {
    const names = noteNames([{ path: 'P-01.md' as VaultPath, title: 'Atlas' }]);
    const columns = groupRows({
      rows: [task('a', '[[P-01]]'), task('b', '[[Gone]]')],
      groupBy: 'project',
      options: [],
      grouping: 'relation',
      names,
    });
    expect(columns.map((column) => [column.label, column.value])).toEqual([
      ['Atlas', '[[P-01]]'],
      ['Gone', '[[Gone]]'],
    ]);
  });

  it('draws a project column as a plain label, not as a status', () => {
    const [column] = groupRows({
      rows: [task('a', '[[Done]]')],
      groupBy: 'project',
      options: [],
      grouping: 'relation',
    });
    expect(column?.tone).toBeNull();
  });
});

describe('grouping by an option', () => {
  it('tones a column by the colour the type chose, else by its name', () => {
    const columns = groupRows({
      rows: [],
      groupBy: 'status',
      options: ['in review', 'done', 'custom'],
      colors: { 'in review': 'review' },
    });
    expect(columns.map((column) => column.tone)).toEqual(['review', 'done', 'backlog']);
  });

  it('keeps a value exactly as the type declares it', () => {
    const [column] = groupRows({ rows: [], groupBy: 'status', options: ['[[odd]]'] });
    expect(column?.value).toBe('[[odd]]');
    expect(column?.label).toBe('[[odd]]');
  });
});
