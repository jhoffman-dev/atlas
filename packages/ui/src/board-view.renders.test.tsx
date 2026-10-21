// @vitest-environment jsdom
/**
 * How much a board draws again (#260): the pane hands the board new handlers
 * and kinds on every render, and a moved card is drawn in its new column at
 * once. A card draws again only for a change of its own.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { BoardColumn, BoardRow } from '@dfai/domain';
import { BoardView } from './board-view.tsx';
import { startCountingRenders, stopCountingRenders } from './testing/render-counter.ts';

// Before React loads, so every commit is handed to the counter.
await vi.hoisted(async () => {
  const { installRenderCounter } = await import('./testing/render-counter.ts');
  installRenderCounter();
});

const row = (at: number, status: string): BoardRow => ({
  path: `t${at}.md`,
  title: `Task ${at}`,
  values: { path: `t${at}.md`, title: `Task ${at}`, status, due: '2026-10-20' },
});

const ROWS = [
  ...Array.from({ length: 4 }, (_, at) => row(at, 'backlog')),
  ...Array.from({ length: 4 }, (_, at) => row(at + 4, 'doing')),
];

function columnsOf(rows: readonly BoardRow[]): BoardColumn[] {
  return ['backlog', 'doing', 'done'].map((value) => ({
    value,
    label: value,
    rows: rows.filter((each) => each.values['status'] === value),
    tone: null,
  }));
}

/** The board as the pane hands it over: every handler, and the kinds, made again on each render. */
function board(columns: readonly BoardColumn[]) {
  return (
    <BoardView
      columns={columns}
      groupBy="status"
      fields={['status', 'due']}
      kinds={{ status: 'select', due: 'date' }}
      onOpenNote={() => {}}
      onMoveCard={() => {}}
      onAddCard={() => {}}
    />
  );
}

function cardsDrawnBy(act: () => void): number {
  startCountingRenders();
  act();
  return stopCountingRenders().renders['CardFace'] ?? 0;
}

describe('BoardView — what one commit draws (#260)', () => {
  it('draws no card again when the pane draws again with nothing changed on the board', () => {
    const columns = columnsOf(ROWS);
    const view = render(board(columns));
    expect(screen.getByText('Task 7')).toBeDefined();

    expect(cardsDrawnBy(() => view.rerender(board(columns)))).toBe(0);
  });

  it('draws only the moved card when one card is drawn in another column', () => {
    const view = render(board(columnsOf(ROWS)));
    // As the pending move draws it: every other row the object it was.
    const moved = ROWS.map((each) =>
      each.path === 't5.md' ? { ...each, values: { ...each.values, status: 'done' } } : each,
    );

    expect(cardsDrawnBy(() => view.rerender(board(columnsOf(moved))))).toBe(1);
    expect(screen.getByRole('region', { name: 'done' }).textContent).toContain('Task 5');
  });
});
