// @vitest-environment jsdom
/**
 * The other side of a board that draws a card again only for a change of its
 * own (#260): whatever does change reaches the cards. A field added, kinds
 * changed, a row read again, a new handler and a column added after the board
 * was drawn are each drawn, or used, at once.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BoardColumn, BoardRow, PropertyKind } from '@dfai/domain';
import { BoardView } from './board-view.tsx';
import { dragByKeyboard, layOut, type Box } from './drag/test-layout.ts';

const ROW: BoardRow = {
  path: 'a.md',
  title: 'First',
  values: {
    path: 'a.md',
    title: 'First',
    status: 'backlog',
    owner: 'Mara Quill',
    due: '2026-10-20',
  },
};

const columnsOf = (rows: readonly BoardRow[], values = ['backlog', 'doing']): BoardColumn[] =>
  values.map((value) => ({
    value,
    label: value,
    rows: rows.filter((row) => row.values['status'] === value),
  }));

interface Shown {
  columns?: readonly BoardColumn[];
  fields?: readonly string[];
  kinds?: Readonly<Record<string, PropertyKind>>;
  onOpenNote?: (path: string) => void;
  onMoveCard?: (move: unknown) => void;
}

function board({
  columns = columnsOf([ROW]),
  fields = ['status'],
  kinds = { status: 'select' },
  onOpenNote = () => {},
  onMoveCard = () => {},
}: Shown = {}) {
  return (
    <BoardView
      columns={columns}
      groupBy="status"
      fields={fields}
      kinds={kinds}
      onOpenNote={onOpenNote}
      onMoveCard={onMoveCard}
      onAddCard={() => {}}
    />
  );
}

const card = () => document.querySelector<HTMLElement>('.board__card[data-path="a.md"]');

describe('BoardView — what changes reaches the cards (#260)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('draws a field added to the view on the cards already drawn', () => {
    const view = render(board());
    expect(card()?.textContent).not.toContain('Mara Quill');

    view.rerender(board({ fields: ['status', 'owner'] }));

    expect(card()?.textContent).toContain('Mara Quill');
  });

  it('draws the cards again when a field’s kind changes', () => {
    const view = render(
      board({ fields: ['status', 'due'], kinds: { status: 'select', due: 'text' } }),
    );
    const asText = card()?.innerHTML;

    view.rerender(board({ fields: ['status', 'due'], kinds: { status: 'select', due: 'date' } }));

    expect(card()?.innerHTML).not.toBe(asText);
  });

  it('draws the title a row is read again with', () => {
    const view = render(board());
    expect(screen.getByRole('button', { name: 'First' })).toBeDefined();

    const renamed = { ...ROW, title: 'Renamed', values: { ...ROW.values, title: 'Renamed' } };
    view.rerender(board({ columns: columnsOf([renamed]) }));

    expect(screen.getByRole('button', { name: 'Renamed' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'First' })).toBeNull();
  });

  it('opens a card with the handler the board was last handed', async () => {
    const first = vi.fn();
    const latest = vi.fn();
    const view = render(board({ onOpenNote: first }));
    view.rerender(board({ onOpenNote: latest }));

    await userEvent.click(screen.getByRole('button', { name: 'First' }));

    expect(latest).toHaveBeenCalledExactlyOnceWith('a.md', 'here');
    expect(first).not.toHaveBeenCalled();
  });

  it('moves a card from the keyboard into a column added after the board was drawn', async () => {
    // jsdom lays nothing out: columns stand 300px apart, a card inside its column.
    layOut((element: Element): Box | null => {
      const columns = [...document.querySelectorAll('.board__column')];
      if (element.matches('.board__column')) {
        return { left: columns.indexOf(element) * 300, top: 0, width: 280, height: 600 };
      }
      if (element.matches('.board__card')) {
        const at = columns.indexOf(element.closest('.board__column') ?? element);
        return { left: at * 300 + 10, top: 60, width: 260, height: 60 };
      }
      return null;
    });
    const onMoveCard = vi.fn();
    const doing = { ...ROW, values: { ...ROW.values, status: 'doing' } };
    const view = render(board({ columns: columnsOf([doing]), onMoveCard }));
    view.rerender(
      board({ columns: columnsOf([doing], ['backlog', 'doing', 'review']), onMoveCard }),
    );

    await dragByKeyboard(screen.getByRole('button', { name: 'First' }), ['{ArrowRight}']);

    expect(onMoveCard).toHaveBeenCalledExactlyOnceWith({ path: 'a.md', value: 'review' });
  });
});
