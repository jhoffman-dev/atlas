// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BoardRow } from '@atlas/domain';
import { BoardView } from './board-view.tsx';
import type { DoneTicks } from './done-checkbox.tsx';
import { FeedView } from './feed-view.tsx';
import { GalleryView, ListView } from './list-view.tsx';
import { TableView } from './table-view.tsx';

/**
 * Tick-to-done, in every layout that lists notes: the box is a real checkbox
 * named for its note, shows whether the note is finished, and says which way
 * it was changed — by pointer or by Space.
 */

const rows: BoardRow[] = [
  { path: 'a.md', title: 'First', values: { status: 'doing' } },
  { path: 'b.md', title: 'Second', values: { status: 'done' } },
];

const ticksFor = (onToggle = vi.fn()): DoneTicks => ({
  isDone: (values) => values['status'] === 'done',
  onToggle,
});

const noBodies = { bodyOf: () => undefined, load: async () => null };

const layouts: [string, (ticks?: DoneTicks) => ReactElement][] = [
  [
    'table',
    (ticks) => (
      <TableView
        result={{
          columns: ['path', 'title', 'status'],
          rows: rows.map((row) => [row.path, row.title, row.values['status']]),
          truncated: false,
          sql: '',
        }}
        sorts={[]}
        error={null}
        onOpenNote={() => {}}
        onEditCell={() => {}}
        onToggleSort={() => {}}
        {...(ticks !== undefined && { ticks })}
      />
    ),
  ],
  [
    'list',
    (ticks) => <ListView rows={rows} fields={[]} onOpenNote={() => {}} {...(ticks && { ticks })} />,
  ],
  [
    'gallery',
    (ticks) => (
      <GalleryView rows={rows} fields={[]} onOpenNote={() => {}} {...(ticks && { ticks })} />
    ),
  ],
  [
    'feed',
    (ticks) => (
      <FeedView
        rows={rows}
        fields={[]}
        bodies={noBodies}
        shown={10}
        onShowMore={() => {}}
        onOpenNote={() => {}}
        onFollowLink={() => {}}
        {...(ticks && { ticks })}
      />
    ),
  ],
  [
    'board',
    (ticks) => (
      <BoardView
        columns={[
          { value: 'doing', label: 'doing', rows: [rows[0]!] },
          { value: 'done', label: 'done', rows: [rows[1]!] },
        ]}
        groupBy="status"
        fields={[]}
        onOpenNote={() => {}}
        onMoveCard={() => {}}
        onAddCard={() => {}}
        {...(ticks && { ticks })}
      />
    ),
  ],
];

describe.each(layouts)('the done box in a %s', (_layout, draw) => {
  it('is a checkbox named for its note, ticked when the note is done', () => {
    render(draw(ticksFor()));
    const first = screen.getByRole('checkbox', { name: 'Mark First done' });
    const second = screen.getByRole('checkbox', { name: 'Mark Second done' });
    expect((first as HTMLInputElement).checked).toBe(false);
    expect((second as HTMLInputElement).checked).toBe(true);
  });

  it('ticks a note done when clicked, and unticks a finished one', async () => {
    const onToggle = vi.fn();
    render(draw(ticksFor(onToggle)));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Mark First done' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Mark Second done' }));
    expect(onToggle.mock.calls).toEqual([
      [{ path: 'a.md', done: true }],
      [{ path: 'b.md', done: false }],
    ]);
  });

  it('ticks from the keyboard with Space', async () => {
    const onToggle = vi.fn();
    render(draw(ticksFor(onToggle)));
    screen.getByRole('checkbox', { name: 'Mark First done' }).focus();
    await userEvent.keyboard(' ');
    expect(onToggle).toHaveBeenCalledWith({ path: 'a.md', done: true });
  });

  it('marks a finished note so it can be drawn struck through', () => {
    const { container } = render(draw(ticksFor()));
    const done = container.querySelectorAll('[class*="--done"]');
    expect(done).toHaveLength(1);
    expect(done[0]?.textContent).toContain('Second');
  });

  it('draws no box for a type that cannot be ticked done', () => {
    render(draw());
    expect(screen.getByText('First')).toBeDefined();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});

describe('the table with a done box', () => {
  it('leaves out the status it carries only for the box', () => {
    render(
      <TableView
        result={{
          columns: ['path', 'title', 'phase', 'status'],
          rows: [['a.md', 'First', 3, 'doing']],
          truncated: false,
          sql: '',
        }}
        sorts={[]}
        error={null}
        onOpenNote={() => {}}
        onEditCell={() => {}}
        onToggleSort={() => {}}
        ticks={ticksFor()}
        hiddenColumns={['status']}
      />,
    );
    expect(screen.getByRole('button', { name: /Sort by Phase|Phase/ })).toBeDefined();
    expect(screen.queryByText('Status')).toBeNull();
    expect(screen.queryByText('doing')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Mark First done' })).toBeDefined();
  });
});
