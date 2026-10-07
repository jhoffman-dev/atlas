// @vitest-environment jsdom
/**
 * A board with swimlanes (issue #6): columns stay the first grouping, the
 * sub-grouping lays lanes across them, and a card dropped into another column
 * and lane is given both properties.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { boardGroups, parseObjectType, viewGroupLevels, type BoardRow } from '@atlas/domain';
import { BoardView } from './board-view.tsx';
import { announced, dragByKeyboard, layOut, type Box } from './drag/test-layout.ts';

const TASK = parseObjectType({
  name: 'task',
  properties: {
    status: { kind: 'select', options: ['backlog', 'doing'] },
    area: { kind: 'select', options: ['home', 'work'] },
  },
});

const card = (path: string, status: string, area: string | null): BoardRow => ({
  path,
  title: path.replace('.md', ''),
  values: { status, area },
});

const ROWS = [card('First.md', 'backlog', 'home'), card('Second.md', 'doing', 'work')];
const { columns, lanes } = boardGroups({
  rows: ROWS,
  levels: viewGroupLevels({ type: TASK, groupBy: 'status', subGroupBy: 'area', sorts: [] }),
});

function Board({
  onMoveCard = () => {},
  onAddCard = () => {},
}: {
  onMoveCard?: Parameters<typeof BoardView>[0]['onMoveCard'];
  onAddCard?: Parameters<typeof BoardView>[0]['onAddCard'];
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  return (
    <BoardView
      columns={columns}
      lanes={lanes}
      folds={{
        collapsed,
        onToggle: (id) => setCollapsed((was) => (was.has(id) ? new Set() : new Set([...was, id]))),
      }}
      groupBy="status"
      fields={['area']}
      onOpenNote={() => {}}
      onMoveCard={onMoveCard}
      onAddCard={onAddCard}
    />
  );
}

const lane = (name: string) => screen.getByRole('region', { name: `${name} lane` });
const cell = (column: string, laneName: string) =>
  screen.getByRole('region', { name: `${column}, in ${laneName}` });

describe('a board with swimlanes', () => {
  it('leaves out the lane’s property from a card’s chips: the lane already says it', () => {
    render(<Board />);
    const first = screen.getByRole('button', { name: 'First' }).closest('article');
    expect(first).not.toBeNull();
    expect(first?.querySelector('.board__head')).not.toBeNull();
    expect(first?.querySelectorAll('.board__field')).toHaveLength(0);
  });

  it('shows a full cell’s first few cards and the rest behind “+ N more”, as a column does', async () => {
    const crowd = Array.from({ length: 9 }, (_, at) => card(`Crowd ${at}.md`, 'doing', 'home'));
    const crowded = boardGroups({
      rows: crowd,
      levels: viewGroupLevels({ type: TASK, groupBy: 'status', subGroupBy: 'area', sorts: [] }),
    });
    render(
      <BoardView
        columns={crowded.columns}
        lanes={crowded.lanes}
        groupBy="status"
        fields={[]}
        onOpenNote={() => {}}
        onMoveCard={() => {}}
        onAddCard={() => {}}
      />,
    );
    const full = cell('doing', 'home');
    expect(within(full).getAllByRole('article')).toHaveLength(4);
    await userEvent.click(within(full).getByRole('button', { name: '+ 5 more' }));
    expect(within(full).getAllByRole('article')).toHaveLength(9);
  });

  it('heads the columns once, then lays a lane per sub-group across them', () => {
    render(<Board />);
    const heads = [...document.querySelectorAll('.board__lane-head')].map(
      (head) => head.textContent,
    );
    expect(heads).toEqual(['Backlog1', 'Doing1']);
    const laneNames = [...document.querySelectorAll('.board__lane')].map((section) =>
      section.getAttribute('aria-label'),
    );
    expect(laneNames).toEqual(['home lane', 'work lane']);
  });

  it('puts each card in its column’s cell of its lane', () => {
    render(<Board />);
    expect(within(cell('backlog', 'home')).getByRole('button', { name: 'First' })).toBeDefined();
    expect(within(cell('doing', 'work')).getByRole('button', { name: 'Second' })).toBeDefined();
    expect(within(cell('doing', 'home')).queryByRole('article')).toBeNull();
  });

  it('counts each lane’s cards in its heading', () => {
    render(<Board />);
    const toggle = within(lane('home')).getByRole('button', { name: /^home/i });
    expect(within(toggle).getByLabelText('1 card')).toBeDefined();
  });

  it('folds a lane shut, leaving its heading and the other lanes', async () => {
    render(<Board />);
    const toggle = within(lane('home')).getByRole('button', { name: /^home/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'First' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Second' })).toBeDefined();
    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'First' })).toBeDefined();
  });

  it('adds a card in a cell with both its column’s and its lane’s value', async () => {
    const onAddCard = vi.fn();
    render(<Board onAddCard={onAddCard} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add to doing, in home' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'New card in doing, in home' }),
      'Ship it{Enter}',
    );
    expect(onAddCard).toHaveBeenCalledWith({ value: 'doing', lane: 'home', name: 'Ship it' });
  });
});

/** Cells 300px apart across, lanes 200px apart down; a card sits in its cell. */
function laneBoxes(element: Element): Box | null {
  const cells = [...document.querySelectorAll('.board__cell')];
  const place = (target: Element) => {
    const at = cells.indexOf(target);
    return { left: (at % 2) * 300, top: Math.floor(at / 2) * 200 + 40 };
  };
  if (element.matches('.board__cell')) return { ...place(element), width: 280, height: 160 };
  if (element.matches('.board__card')) {
    const { left, top } = place(element.closest('.board__cell') ?? element);
    return { left: left + 10, top: top + 10, width: 260, height: 60 };
  }
  return null;
}

describe('a board with swimlanes, from the keyboard', () => {
  beforeEach(() => layOut(laneBoxes));
  afterEach(() => vi.restoreAllMocks());

  it('moves a card to another column and lane, writing both', async () => {
    const onMoveCard = vi.fn();
    render(<Board onMoveCard={onMoveCard} />);
    await dragByKeyboard(screen.getByRole('button', { name: 'First' }), [
      '{ArrowRight}',
      '{ArrowDown}',
    ]);
    expect(onMoveCard).toHaveBeenCalledExactlyOnceWith({
      path: 'First.md',
      value: 'doing',
      lane: 'work',
    });
    expect(announced()).toBe('First moved to doing, in work.');
  });

  it('writes only the lane when the card stays in its column', async () => {
    const onMoveCard = vi.fn();
    render(<Board onMoveCard={onMoveCard} />);
    await dragByKeyboard(screen.getByRole('button', { name: 'First' }), ['{ArrowDown}']);
    expect(onMoveCard).toHaveBeenCalledExactlyOnceWith({ path: 'First.md', lane: 'work' });
  });

  it('writes only the column when the card stays in its lane', async () => {
    const onMoveCard = vi.fn();
    render(<Board onMoveCard={onMoveCard} />);
    await dragByKeyboard(screen.getByRole('button', { name: 'First' }), ['{ArrowRight}']);
    expect(onMoveCard).toHaveBeenCalledExactlyOnceWith({ path: 'First.md', value: 'doing' });
  });

  it('writes nothing for a card dropped back in its own cell', async () => {
    const onMoveCard = vi.fn();
    render(<Board onMoveCard={onMoveCard} />);
    await dragByKeyboard(screen.getByRole('button', { name: 'First' }), ['{ArrowUp}']);
    expect(onMoveCard).not.toHaveBeenCalled();
  });
});
