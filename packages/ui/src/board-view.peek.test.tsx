// @vitest-environment jsdom
/**
 * A card clicked peeks its note (slice 6b), handed every card in the order
 * the board shows them: column by column, and lane by lane once it has
 * swimlanes, leaving out a folded lane's. A click asking for a tab or a
 * split, or a board given no peek, still opens the note.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { boardGroups, parseObjectType, viewGroupLevels, type BoardRow } from '@atlas/domain';
import { BoardView } from './board-view.tsx';

const TASK = parseObjectType({
  name: 'task',
  properties: {
    status: { kind: 'select', options: ['backlog', 'doing'] },
    area: { kind: 'select', options: ['home', 'work'] },
  },
});

const card = (path: string, status: string, area: string): BoardRow => ({
  path,
  title: path.replace('.md', ''),
  values: { status, area },
});

const ROWS = [
  card('One.md', 'doing', 'work'),
  card('Two.md', 'backlog', 'home'),
  card('Three.md', 'doing', 'home'),
  card('Four.md', 'backlog', 'work'),
];

function grouped(subGroupBy: string | null) {
  return boardGroups({
    rows: ROWS,
    levels: viewGroupLevels({ type: TASK, groupBy: 'status', subGroupBy, sorts: [] }),
  });
}

const base = {
  groupBy: 'status',
  fields: ['area'],
  onMoveCard: () => {},
  onAddCard: () => {},
};

describe('BoardView — a card peeked', () => {
  it('peeks the card with every card, column by column', async () => {
    const onPeek = vi.fn();
    const onOpenNote = vi.fn();
    const { columns } = grouped(null);
    render(<BoardView {...base} columns={columns} onPeek={onPeek} onOpenNote={onOpenNote} />);
    await userEvent.click(screen.getByRole('button', { name: 'Three' }));
    expect(onPeek).toHaveBeenCalledWith({
      path: 'Three.md',
      order: ['Two.md', 'Four.md', 'One.md', 'Three.md'],
    });
    expect(onOpenNote).not.toHaveBeenCalled();
  });

  it('hands over a laned board lane by lane, leaving out a folded lane', async () => {
    const onPeek = vi.fn();
    const { columns, lanes } = grouped('area');
    const home = lanes.find((lane) => lane.group.value === 'home');
    const view = render(
      <BoardView {...base} columns={columns} lanes={lanes} onPeek={onPeek} onOpenNote={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Four' }));
    expect(onPeek).toHaveBeenLastCalledWith({
      path: 'Four.md',
      order: ['Two.md', 'Three.md', 'Four.md', 'One.md'],
    });

    view.rerender(
      <BoardView
        {...base}
        columns={columns}
        lanes={lanes}
        folds={{ collapsed: new Set([home?.group.id ?? '']), onToggle: () => {} }}
        onPeek={onPeek}
        onOpenNote={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Four' }));
    expect(onPeek).toHaveBeenLastCalledWith({ path: 'Four.md', order: ['Four.md', 'One.md'] });
  });

  it('focuses the card’s name as it is clicked, as WebKit does not, for the peek to hand it back', () => {
    const { columns } = grouped(null);
    render(<BoardView {...base} columns={columns} onPeek={vi.fn()} onOpenNote={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Two' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Two' }));
  });

  it('opens the note where a ⌘-click asks, and in place with no peek given', async () => {
    const onPeek = vi.fn();
    const onOpenNote = vi.fn();
    const { columns } = grouped(null);
    const view = render(
      <BoardView {...base} columns={columns} onPeek={onPeek} onOpenNote={onOpenNote} />,
    );
    const user = userEvent.setup();
    await user.keyboard('{Meta>}');
    await user.click(screen.getByRole('button', { name: 'One' }));
    await user.keyboard('{/Meta}');
    expect(onOpenNote).toHaveBeenLastCalledWith('One.md', 'new-tab');
    expect(onPeek).not.toHaveBeenCalled();

    view.rerender(<BoardView {...base} columns={columns} onOpenNote={onOpenNote} />);
    await userEvent.click(screen.getByRole('button', { name: 'One' }));
    expect(onOpenNote).toHaveBeenLastCalledWith('One.md', 'here');
  });
});
