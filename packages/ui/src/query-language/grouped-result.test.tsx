// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  boardGroups,
  groupResultRows,
  parseObjectType,
  queryableFields,
  type BoardRow,
  type ViewLayout,
} from '@atlas/domain';
import { GroupedResult } from './grouped-result.tsx';

const TYPES = [
  parseObjectType({
    name: 'task',
    properties: {
      status: { kind: 'select', options: ['backlog', 'doing', 'done'] },
      project: { kind: 'relation', target: 'project' },
    },
  }),
  parseObjectType({ name: 'project', properties: {} }),
];
const FIELDS = queryableFields(TYPES, ['task']);
const field = (text: string) => {
  const found = FIELDS.find((candidate) => candidate.text === text);
  if (found === undefined) throw new Error(text);
  return found;
};

const row = (title: string, project: string | null, status: string): BoardRow => ({
  path: `tasks/${title}.md`,
  title,
  values: { path: `tasks/${title}.md`, title, type: 'task', project, status },
});

const ROWS = [
  row('Write', '[[Atlas]]', 'doing'),
  row('Ship', '[[Atlas]]', 'done'),
  row('Weed', '[[Garden]]', 'backlog'),
  row('Plan', '[[Atlas]]', 'doing'),
];

function Harness({
  layout,
  groupBy,
  onOpenNote = () => {},
}: {
  layout: ViewLayout;
  groupBy: string[];
  onOpenNote?: (path: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const board = layout === 'board' ? boardGroups({ rows: ROWS, levels: groupBy.map(field) }) : null;
  return (
    <GroupedResult
      layout={layout}
      fields={[
        { key: 'type', label: 'Type' },
        { key: 'status', label: 'Status' },
      ]}
      rows={ROWS}
      groups={board?.columns ?? groupResultRows({ rows: ROWS, groups: groupBy.map(field) })}
      {...(board !== null && { lanes: board.lanes })}
      collapsed={collapsed}
      onToggleGroup={(id) =>
        setCollapsed((was) => {
          const next = new Set(was);
          if (!next.delete(id)) next.add(id);
          return next;
        })
      }
      onOpenNote={onOpenNote}
    />
  );
}

const group = (name: string) => screen.getByRole('group', { name });

describe('GroupedResult', () => {
  const header = (name: RegExp) => screen.getByRole('button', { name });
  const titles = () =>
    [...document.querySelectorAll('.qresult__title')].map((node) => node.textContent);

  it('draws a table in groups and sub-groups, as header rows with their counts', () => {
    render(<Harness layout="table" groupBy={['project', 'status']} />);
    const headers = [...document.querySelectorAll('.table__group-toggle')].map((node) => [
      node.textContent,
      node.getAttribute('data-depth'),
    ]);
    expect(headers).toEqual([
      ['Atlas3', '0'],
      ['Doing2', '1'],
      ['Done1', '1'],
      ['Garden1', '0'],
      ['Backlog1', '1'],
    ]);
    expect(titles()).toEqual(['Write', 'Plan', 'Ship', 'Weed']);
    // A query view adds no notes, so there is no "+ New" under its groups.
    expect(screen.queryByRole('button', { name: /^ in / })).toBeNull();
  });

  it('folds a group shut and open again from its header', async () => {
    render(<Harness layout="table" groupBy={['project', 'status']} />);
    await userEvent.click(header(/^Atlas/));
    expect(header(/^Atlas/).getAttribute('aria-expanded')).toBe('false');
    expect(titles()).toEqual(['Weed']);
    await userEvent.click(header(/^Atlas/));
    expect(titles()).toEqual(['Write', 'Plan', 'Ship', 'Weed']);
  });

  it('draws a board: groups as columns, empty ones kept, sub-groups as lanes across them', async () => {
    render(<Harness layout="board" groupBy={['status', 'project']} />);
    const heads = [...document.querySelectorAll('.board__lane-head')].map(
      (head) => head.textContent,
    );
    expect(heads).toEqual(['Backlog1', 'Doing2', 'Done1']);
    const cell = screen.getByRole('region', { name: 'doing, in Atlas' });
    expect(
      within(cell)
        .getAllByRole('listitem')
        .map((card) => card.textContent),
    ).toEqual(['Writetask · doing', 'Plantask · doing']);
    const atlas = screen.getByRole('region', { name: 'Atlas lane' });
    await userEvent.click(within(atlas).getByRole('button', { name: /^Atlas/ }));
    expect(screen.queryByRole('region', { name: 'doing, in Atlas' })).toBeNull();
    expect(screen.getByRole('region', { name: 'backlog, in Garden' })).toBeDefined();
  });

  it('draws a board with no grouping as one column of every note', () => {
    render(<Harness layout="board" groupBy={[]} />);
    const all = screen.getByRole('region', { name: 'All notes' });
    expect(within(all).getAllByRole('listitem')).toHaveLength(4);
  });

  it('draws a list in groups, and opens a note from its name', async () => {
    const onOpenNote = vi.fn();
    render(<Harness layout="list" groupBy={['status']} onOpenNote={onOpenNote} />);
    const done = group('done');
    await userEvent.click(within(done).getByRole('button', { name: 'Ship' }));
    expect(onOpenNote).toHaveBeenCalledWith('tasks/Ship.md');
  });

  it('draws a plain table when nothing groups it', () => {
    render(<Harness layout="table" groupBy={[]} />);
    expect(screen.queryAllByRole('group')).toEqual([]);
    expect(screen.getAllByRole('row')).toHaveLength(5);
  });
});
