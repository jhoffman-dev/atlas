import { describe, expect, it } from 'vitest';
import { movedSection, sectionOrder } from './section-order.ts';
import type { SidebarSectionId } from './sidebar-section.ts';

const IDS: readonly SidebarSectionId[] = ['favorites', 'types', 'views', 'dashboards', 'userSpace'];

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, at) =>
    permutations([...items.slice(0, at), ...items.slice(at + 1)]).map((rest) => [item, ...rest]),
  );
}

interface Move {
  order: SidebarSectionId[];
  id: SidebarSectionId;
  to: number;
}

/** Every order, every section moved to every place, and one past each end: 4,200 moves. */
function everyMove(): Move[] {
  const moves: Move[] = [];
  for (const order of permutations(IDS))
    for (const id of IDS)
      for (let to = -1; to <= IDS.length; to += 1) moves.push({ order, id, to });
  return moves;
}

const placeOf = (order: readonly SidebarSectionId[], id: SidebarSectionId) =>
  sectionOrder(order).indexOf(id);

describe('movedSection, adversarially', () => {
  it('moves a section in the direction it was dragged, or not at all, for every possible move', () => {
    const wrongWay = everyMove().filter((move) => {
      const from = placeOf(move.order, move.id);
      const now = placeOf(movedSection(move), move.id);
      return move.to > from ? now < from : move.to < from ? now > from : now !== from;
    });

    expect({ count: wrongWay.length, first: wrongWay.slice(0, 2) }).toEqual({
      count: 0,
      first: [],
    });
  });

  it('lands a section exactly on the place it was dropped, clamped to the ends', () => {
    const missed = everyMove().filter((move) => {
      const landed = placeOf(movedSection(move), move.id);
      return landed !== Math.max(0, Math.min(move.to, IDS.length - 1));
    });

    expect({ count: missed.length, first: missed.slice(0, 2) }).toEqual({ count: 0, first: [] });
  });
});
