// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BoardColumn } from '@atlas/domain';
import { BoardView } from './board-view.tsx';
import { announced, dragByKeyboard, layOut, type Box } from './drag/test-layout.ts';

function boardBoxes(element: Element): Box | null {
  const columns = [...document.querySelectorAll('.board__column')];
  if (element.matches('.board__column')) {
    return { left: columns.indexOf(element) * 300, top: 0, width: 280, height: 600 };
  }
  if (element.matches('.board__card')) {
    const column = columns.indexOf(element.closest('.board__column') ?? element);
    return { left: column * 300 + 10, top: 60, width: 260, height: 60 };
  }
  return null;
}

const columns: BoardColumn[] = [
  {
    value: 'backlog',
    label: 'backlog',
    rows: [{ path: 'a.md', title: 'First', values: { status: 'backlog', phase: 1 } }],
  },
  { value: 'doing', label: 'doing', rows: [] },
];

const props = {
  columns,
  groupBy: 'status',
  fields: ['title', 'status', 'phase'],
  onOpenNote: () => {},
  onMoveCard: () => {},
  onAddCard: () => {},
};

describe('BoardView', () => {
  it('shows a column per group', () => {
    render(<BoardView {...props} />);
    expect(screen.getByRole('region', { name: 'backlog' })).toBeDefined();
    expect(screen.getByRole('region', { name: 'doing' })).toBeDefined();
  });

  it('heads a project column with its name, and a status column with its chosen tone', () => {
    render(
      <BoardView
        {...props}
        groupBy="project"
        columns={[
          { value: '[[Atlas]]', label: 'Atlas', rows: [], tone: null },
          { value: 'in review', label: 'in review', rows: [], tone: 'review' },
        ]}
      />,
    );
    const atlas = screen.getByRole('region', { name: 'Atlas' });
    expect(atlas.querySelector('.status-pill')).toBeNull();
    expect(atlas.querySelector('.board__group-label')?.textContent).toBe('Atlas');
    const review = screen.getByRole('region', { name: 'in review' });
    expect(review.querySelector('.status-pill')?.getAttribute('data-tone')).toBe('review');
  });

  it('keeps an empty column, because that is where a card goes next', () => {
    render(<BoardView {...props} />);
    const doing = screen.getByRole('region', { name: 'doing' });
    expect(within(doing).queryByRole('article')).toBeNull();
    expect(within(doing).getByLabelText('0 cards')).toBeDefined();
  });

  it('counts the cards in a column', () => {
    render(<BoardView {...props} />);
    const backlog = screen.getByRole('region', { name: 'backlog' });
    expect(within(backlog).getByLabelText('1 card')).toBeDefined();
  });

  it('shows a card per row', () => {
    render(<BoardView {...props} />);
    expect(screen.getByRole('button', { name: 'First' })).toBeDefined();
  });

  it('shows other fields on the card but not the one it is grouped by', () => {
    render(<BoardView {...props} />);
    const card = screen.getByRole('button', { name: 'First' }).closest('article');
    // phase 1 is shown; the status it is filed under is not repeated on the card.
    expect(card?.textContent).toContain('1');
    expect(card?.textContent).not.toContain('backlog');
  });

  it('opens the note when a card title is clicked', async () => {
    const onOpenNote = vi.fn();
    render(<BoardView {...props} onOpenNote={onOpenNote} />);
    await userEvent.click(screen.getByRole('button', { name: 'First' }));
    expect(onOpenNote).toHaveBeenCalledWith('a.md');
  });

  it('opens the note on Enter, which does not pick the card up', async () => {
    const onOpenNote = vi.fn();
    const onMoveCard = vi.fn();
    render(<BoardView {...props} onOpenNote={onOpenNote} onMoveCard={onMoveCard} />);

    screen.getByRole('button', { name: 'First' }).focus();
    await userEvent.keyboard('{Enter}');

    expect(onOpenNote).toHaveBeenCalledWith('a.md');
    expect(onMoveCard).not.toHaveBeenCalled();
  });

  it('asks for a name before adding a card', async () => {
    const onAddCard = vi.fn();
    render(<BoardView {...props} onAddCard={onAddCard} />);

    await userEvent.click(screen.getByRole('button', { name: 'Add to doing' }));
    expect(onAddCard).not.toHaveBeenCalled();

    await userEvent.type(
      screen.getByRole('textbox', { name: 'New card in doing' }),
      'Ship it{Enter}',
    );
    expect(onAddCard).toHaveBeenCalledWith({ value: 'doing', name: 'Ship it' });
  });

  it('keeps the field open for the next card', async () => {
    const onAddCard = vi.fn();
    render(<BoardView {...props} onAddCard={onAddCard} />);

    await userEvent.click(screen.getByRole('button', { name: 'Add to doing' }));
    const field = screen.getByRole('textbox', { name: 'New card in doing' });
    await userEvent.type(field, 'One{Enter}');
    await userEvent.type(field, 'Two{Enter}');

    expect(onAddCard).toHaveBeenCalledTimes(2);
    expect(onAddCard).toHaveBeenLastCalledWith({ value: 'doing', name: 'Two' });
  });

  it('does not add a card with no name', async () => {
    const onAddCard = vi.fn();
    render(<BoardView {...props} onAddCard={onAddCard} />);

    await userEvent.click(screen.getByRole('button', { name: 'Add to doing' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'New card in doing' }), '   {Enter}');

    expect(onAddCard).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'New card in doing' })).toBeNull();
  });

  it('abandons the field on escape', async () => {
    const onAddCard = vi.fn();
    render(<BoardView {...props} onAddCard={onAddCard} />);

    await userEvent.click(screen.getByRole('button', { name: 'Add to doing' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'New card in doing' }), 'x{Escape}');

    expect(onAddCard).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'New card in doing' })).toBeNull();
  });

  it('can add to the column for cards with no value', async () => {
    const onAddCard = vi.fn();
    render(
      <BoardView
        {...props}
        columns={[{ value: null, label: 'No value', rows: [] }]}
        onAddCard={onAddCard}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add to No value' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'New card in No value' }),
      'Loose end{Enter}',
    );
    expect(onAddCard).toHaveBeenCalledWith({ value: null, name: 'Loose end' });
  });
});

describe('BoardView card content', () => {
  it('shows what a note is about under its name', () => {
    render(
      <BoardView
        {...props}
        columns={[
          {
            value: 'doing',
            label: 'doing',
            rows: [
              {
                path: 'a.md',
                title: 'A real title',
                values: { summary: 'What the note is about.', status: 'doing' },
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText('A real title')).toBeDefined();
    expect(screen.getByText('What the note is about.')).toBeDefined();
  });

  it('shows no summary line when the note has none', () => {
    const { container } = render(
      <BoardView
        {...props}
        columns={[
          { value: 'doing', label: 'doing', rows: [{ path: 'a.md', title: 'A', values: {} }] },
        ]}
      />,
    );
    expect(container.querySelector('.board__summary')).toBeNull();
  });

  it('offers an add control in the column header, where a full column cannot hide it', () => {
    render(<BoardView {...props} />);
    const header = screen.getByRole('region', { name: 'doing' }).querySelector('header');
    expect(header?.querySelector('button')).not.toBeNull();
  });

  it('heads each column with its status as a pill in the status’s tone', () => {
    render(<BoardView {...props} />);
    const pill = screen.getByRole('region', { name: 'doing' }).querySelector('.status-pill');
    expect(pill?.textContent).toBe('Doing');
    expect(pill?.getAttribute('data-tone')).toBe('doing');
  });

  it('says an empty column has nothing in it yet, and a full one does not', () => {
    render(<BoardView {...props} />);
    const doing = screen.getByRole('region', { name: 'doing' });
    expect(within(doing).getByText('Nothing here yet')).toBeDefined();
    const backlog = screen.getByRole('region', { name: 'backlog' });
    expect(within(backlog).queryByText('Nothing here yet')).toBeNull();
  });

  it('labels a card’s properties, rather than showing bare values', () => {
    render(
      <BoardView
        {...props}
        fields={['title', 'status', 'phase', 'source', 'estimate']}
        columns={[
          {
            value: 'backlog',
            label: 'backlog',
            rows: [
              {
                path: 'a.md',
                title: 'First',
                values: { status: 'backlog', phase: 14, source: 'you', estimate: '3h' },
              },
            ],
          },
        ]}
      />,
    );
    const chips = [...document.querySelectorAll('.board__field')].map((chip) => chip.textContent);
    // The grouping property is the column, so it is not repeated as a chip.
    expect(chips).toEqual(['Phase 14', 'From you', '3h']);
    expect(document.querySelector('.board__field--you')?.textContent).toBe('From you');
  });

  it('draws a choice on a card as its pill, as the list does', () => {
    render(
      <BoardView
        {...props}
        fields={['title', 'status', 'stage', 'phase']}
        kinds={{ status: 'select', stage: 'select' }}
        columns={[
          {
            value: 'backlog',
            label: 'backlog',
            rows: [
              {
                path: 'a.md',
                title: 'First',
                values: { status: 'backlog', stage: 'seed', phase: 2 },
              },
            ],
          },
        ]}
      />,
    );
    const card = document.querySelector('.board__card');
    expect(card?.querySelector('.status-pill')?.textContent).toBe('Seed');
    // The column is the status; only the stage is drawn on the card.
    expect(card?.querySelectorAll('.status-pill')).toHaveLength(1);
    expect([...(card?.querySelectorAll('.board__field') ?? [])].map((c) => c.textContent)).toEqual([
      'Phase 2',
    ]);
  });

  it('shows a summary as words, without its markdown', () => {
    render(
      <BoardView
        {...props}
        columns={[
          {
            value: 'doing',
            label: 'doing',
            rows: [
              {
                path: 'a.md',
                title: 'A',
                values: { summary: '- Match `Board.dc.html` and **Table**' },
              },
            ],
          },
        ]}
      />,
    );
    expect(document.querySelector('.board__summary')?.textContent).toBe(
      'Match Board.dc.html and Table',
    );
  });

  it('ticks the cards in the done column, and only those', () => {
    render(
      <BoardView
        {...props}
        columns={[
          { value: 'doing', label: 'doing', rows: [{ path: 'a.md', title: 'A', values: {} }] },
          { value: 'done', label: 'done', rows: [{ path: 'b.md', title: 'B', values: {} }] },
        ]}
      />,
    );
    const done = screen.getByRole('region', { name: 'done' });
    const doing = screen.getByRole('region', { name: 'doing' });
    expect(within(done).getByRole('img', { name: 'Done' })).toBeDefined();
    expect(within(doing).queryByRole('img', { name: 'Done' })).toBeNull();
  });

  it('shows the first few cards of a long column, and the rest on request', async () => {
    const rows = Array.from({ length: 10 }, (_, at) => ({
      path: `${at}.md`,
      title: `Card ${at}`,
      values: {},
    }));
    render(<BoardView {...props} columns={[{ value: 'done', label: 'done', rows }]} />);

    expect(document.querySelectorAll('.board__card')).toHaveLength(4);
    // The count still says how many there are, not how many are drawn.
    expect(screen.getByLabelText('10 cards')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: '+ 6 more' }));
    expect(document.querySelectorAll('.board__card')).toHaveLength(10);

    await userEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(document.querySelectorAll('.board__card')).toHaveLength(4);
  });
});

describe('BoardView keyboard drag', () => {
  // jsdom lays nothing out, and dnd-kit finds drop targets by their boxes.
  // Columns stand side by side, 300px apart; a card sits inside its column.
  beforeEach(() => layOut(boardBoxes));
  afterEach(() => vi.restoreAllMocks());

  it('moves a card one column right with Space, ArrowRight, Space', async () => {
    const onMoveCard = vi.fn();
    render(<BoardView {...props} onMoveCard={onMoveCard} />);

    await dragByKeyboard(screen.getByRole('button', { name: 'First' }), ['{ArrowRight}']);

    expect(onMoveCard).toHaveBeenCalledExactlyOnceWith({ path: 'a.md', value: 'doing' });
  });

  it('stops at the last column rather than wrapping to the first', async () => {
    const onMoveCard = vi.fn();
    render(<BoardView {...props} onMoveCard={onMoveCard} />);

    // Two presses over two columns: wrapping would carry it back to backlog.
    await dragByKeyboard(screen.getByRole('button', { name: 'First' }), [
      '{ArrowRight}',
      '{ArrowRight}',
    ]);

    expect(onMoveCard).toHaveBeenCalledExactlyOnceWith({ path: 'a.md', value: 'doing' });
  });

  it('does not move a card up or down, because a column keeps no order', async () => {
    const onMoveCard = vi.fn();
    render(<BoardView {...props} onMoveCard={onMoveCard} />);

    await dragByKeyboard(screen.getByRole('button', { name: 'First' }), ['{ArrowDown}']);

    expect(onMoveCard).not.toHaveBeenCalled();
  });

  it('writes nothing when the drag is cancelled with Escape', async () => {
    const onMoveCard = vi.fn();
    render(<BoardView {...props} onMoveCard={onMoveCard} />);

    await dragByKeyboard(screen.getByRole('button', { name: 'First' }), ['{ArrowRight}'], {
      finish: '{Escape}',
    });

    expect(onMoveCard).not.toHaveBeenCalled();
  });

  it('keeps focus on the card when it is drawn again in its new column', async () => {
    const { rerender } = render(<BoardView {...props} />);

    await dragByKeyboard(screen.getByRole('button', { name: 'First' }), ['{ArrowRight}']);
    // What the write does: the query comes back with the card in doing.
    rerender(
      <BoardView
        {...props}
        columns={[
          { value: 'backlog', label: 'backlog', rows: [] },
          { value: 'doing', label: 'doing', rows: columns[0]?.rows ?? [] },
        ]}
      />,
    );

    const moved = within(screen.getByRole('region', { name: 'doing' })).getByRole('button', {
      name: 'First',
    });
    await waitFor(() => expect(document.activeElement).toBe(moved));
  });

  it('keeps a moved card drawn in a long column, past "+ N more"', async () => {
    const full = Array.from({ length: 8 }, (_, at) => ({
      path: `${at}.md`,
      title: `Card ${at}`,
      values: {},
    }));
    const { rerender } = render(<BoardView {...props} />);

    await dragByKeyboard(screen.getByRole('button', { name: 'First' }), ['{ArrowRight}']);
    // The card comes back last in a column that shows only its first four.
    rerender(
      <BoardView
        {...props}
        columns={[
          { value: 'backlog', label: 'backlog', rows: [] },
          { value: 'doing', label: 'doing', rows: [...full, ...(columns[0]?.rows ?? [])] },
        ]}
      />,
    );

    const doing = screen.getByRole('region', { name: 'doing' });
    const moved = within(doing).getByRole('button', { name: 'First' });
    await waitFor(() => expect(document.activeElement).toBe(moved));
    expect(within(doing).getByRole('button', { name: '+ 4 more' })).toBeDefined();
  });

  it('tells a screen reader the card and the column, not ids', async () => {
    render(<BoardView {...props} />);

    await dragByKeyboard(screen.getByRole('button', { name: 'First' }), ['{ArrowRight}']);

    await waitFor(() => expect(announced()).toBe('First moved to doing.'));
  });
});
