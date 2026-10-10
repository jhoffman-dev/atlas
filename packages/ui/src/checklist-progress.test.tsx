// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { BoardColumn, BoardRow } from '@atlas/domain';
import { BoardView } from './board-view.tsx';
import { ListView } from './list-view.tsx';
import { TableView, type TableResult } from './table-view.tsx';

/** P30-03: a note's checklist progress, drawn as a bar where its view lists it. */
const halfway: BoardRow = {
  path: 'Plan.md',
  title: 'Plan the launch',
  values: { status: 'in-progress', progress: 40 },
};
const unboxed: BoardRow = {
  path: 'Rest.md',
  title: 'Rest',
  values: { status: 'inbox', progress: null },
};

const bars = () => screen.queryAllByRole('progressbar', { name: 'Checklist progress' });

describe('a checklist’s progress', () => {
  it('is a bar on a board card, at its share, with the percentage — 2 of 5 is 40%', () => {
    const columns: BoardColumn[] = [
      { value: 'in-progress', label: 'In Progress', rows: [halfway, unboxed] },
    ];
    render(
      <BoardView
        columns={columns}
        groupBy="status"
        fields={['title', 'status']}
        onOpenNote={() => {}}
        onMoveCard={() => {}}
        onAddCard={() => {}}
      />,
    );
    const card = screen.getByText('Plan the launch').closest('article');
    if (card === null) throw new Error('no card');
    const bar = within(card as HTMLElement).getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect(bar.textContent).toBe('40%');
    expect(
      (bar.querySelector('.checklist-progress__fill') as HTMLElement | null)?.style.width,
    ).toBe('40%');
    expect(bars()).toHaveLength(1);
  });

  it('is a bar on a list row', () => {
    render(<ListView rows={[halfway, unboxed]} fields={['title']} onOpenNote={() => {}} />);
    const row = screen.getByText('Plan the launch').closest('li');
    expect(within(row as HTMLElement).getByRole('progressbar').textContent).toBe('40%');
    expect(bars()).toHaveLength(1);
  });

  it('is a bar beside a table row’s name, never a column of its own', () => {
    const result: TableResult = {
      columns: ['path', 'title', 'status', 'progress'],
      rows: [
        ['Plan.md', 'Plan the launch', 'in-progress', 40],
        ['Rest.md', 'Rest', 'inbox', null],
      ],
      truncated: false,
      sql: '',
    };
    render(
      <TableView
        result={result}
        sorts={[]}
        error={null}
        onOpenNote={() => {}}
        onToggleSort={() => {}}
        hiddenColumns={['progress']}
      />,
    );
    const name = screen.getByText('Plan the launch').closest('td');
    expect(within(name as HTMLElement).getByRole('progressbar').textContent).toBe('40%');
    expect(bars()).toHaveLength(1);
    expect(screen.queryByRole('columnheader', { name: 'Progress' })).toBeNull();
  });

  it('is not drawn for a type with a progress of its own', () => {
    render(
      <ListView
        rows={[halfway]}
        fields={['title']}
        kinds={{ progress: 'number' }}
        onOpenNote={() => {}}
      />,
    );
    expect(screen.getByText('Plan the launch')).toBeDefined();
    expect(bars()).toHaveLength(0);
  });
});
