/**
 * What an arrow key means while something is held, kept out of the components.
 *
 * dnd-kit's keyboard sensor moves by pixels. None of Atlas's surfaces are laid
 * out in pixels a person cares about: a board is columns, a calendar is days in
 * weeks, a timeline is days along a line. These functions turn a key into the
 * next column, day or day-offset, and a target box into the coordinates that
 * put the held item over it. No React, no DOM, no dnd-kit.
 */

import type { LayoutStep } from '@atlas/domain';

export type Direction = 'left' | 'right' | 'up' | 'down';

/** A rectangle in page coordinates, as much of a `DOMRect` as the maths needs. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Days in a calendar row: an up or down arrow is a week. */
const WEEK = 7;

const DIRECTIONS: Readonly<Record<string, Direction>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

/** The direction a `KeyboardEvent.code` names, or null for any other key. */
export function directionOf(code: string): Direction | null {
  return DIRECTIONS[code] ?? null;
}

/**
 * The item `step` places along from `current`, or `current` itself when that
 * would run off either end — a held item stops at the edge rather than wrapping
 * to the far side, which would be a surprise nobody asked for.
 */
function stepAlong<T>(items: readonly T[], current: T, step: number): T {
  const index = items.indexOf(current);
  if (index === -1) return current;
  const next = items[index + step];
  return next === undefined ? current : next;
}

/**
 * The column a card goes to next on a board.
 *
 * Left and right move between columns. Up and down do nothing: a column's order
 * comes from the view's sort, not from where a card was dropped, so moving a
 * card up would show an order the file cannot keep.
 */
export function boardStep(columns: readonly string[], current: string, direction: Direction) {
  if (direction === 'left') return stepAlong(columns, current, -1);
  if (direction === 'right') return stepAlong(columns, current, 1);
  return current;
}

/**
 * The cell a card goes to next on a board with swimlanes: left and right move
 * between the columns of its lane, up and down between lanes in its column.
 * `cells` is the lanes, top to bottom, each a row of its cells' ids.
 */
export function laneStep(
  cells: readonly (readonly string[])[],
  current: string,
  direction: Direction,
): string {
  const lane = cells.findIndex((row) => row.includes(current));
  const row = cells[lane];
  if (row === undefined) return current;
  if (direction === 'left' || direction === 'right') {
    return boardStep(row, current, direction);
  }
  const column = row.indexOf(current);
  const next = cells[lane + (direction === 'up' ? -1 : 1)];
  return next?.[column] ?? current;
}

/**
 * What an arrow does to a widget held on a dashboard. The grid reads in one
 * order, so every arrow moves it earlier or later in it — up and down as well,
 * since a row of a twelve-column grid is not a fixed number of widgets. With
 * Shift, left and right make it narrower or wider; up and down do nothing.
 */
export function dashboardStep(direction: Direction, shift: boolean): LayoutStep | null {
  if (shift) {
    if (direction === 'left') return 'narrower';
    return direction === 'right' ? 'wider' : null;
  }
  return direction === 'left' || direction === 'up' ? 'earlier' : 'later';
}

/**
 * The day a calendar entry goes to next.
 *
 * `days` is the grid in reading order, seven to a week. Left and right are a day
 * — so they run on past the end of a week into the next one, as a date does —
 * and up and down are a week. The held entry stops at the edge of the grid
 * rather than turning the month under it: see `calendar-view.tsx`.
 */
export function calendarStep(days: readonly string[], current: string, direction: Direction) {
  const step = { left: -1, right: 1, up: -WEEK, down: WEEK }[direction];
  return stepAlong(days, current, step);
}

/** How far, in pixels, one arrow press moves a timeline bar: a day, sideways only. */
export function timelineStep(direction: Direction, dayWidth: number): number {
  if (direction === 'left') return -dayWidth;
  if (direction === 'right') return dayWidth;
  return 0;
}

/**
 * Whole days a bar moved, from where it was grabbed and how far it travelled.
 *
 * The bar lands on the day under the pointer, measured in days from the day it
 * was grabbed by — which is why the grab offset matters: a bar grabbed near the
 * end of a day crosses into the next one sooner than one grabbed at its start.
 */
export function daysMoved({
  grabOffset,
  deltaX,
  dayWidth,
}: {
  /** Pixels from the chart's left edge to where the bar was grabbed. */
  grabOffset: number;
  deltaX: number;
  dayWidth: number;
}): number {
  return Math.floor((grabOffset + deltaX) / dayWidth) - Math.floor(grabOffset / dayWidth);
}

/**
 * Where on the chart a bar was grabbed, in pixels from the chart's left edge.
 *
 * A pointer grabs it where it pressed. A keyboard has no such place, so it is
 * taken as the middle of the bar's first day: then each whole-day step lands
 * squarely in the next day, never on a line between two.
 */
export function grabOffset({
  clientX,
  barLeft,
  offset,
  dayWidth,
}: {
  /** Where the pointer pressed, or null for a keyboard pick-up. */
  clientX: number | null;
  /** The bar's left edge on screen. */
  barLeft: number;
  /** Days from the chart's start to the bar's. */
  offset: number;
  dayWidth: number;
}): number {
  const barStart = offset * dayWidth;
  return clientX === null ? barStart + dayWidth / 2 : barStart + (clientX - barLeft);
}

/** The top left that puts the centre of `moving` on the centre of `target`. */
export function centredOn(target: Box, moving: Box): Point {
  return {
    x: target.left + target.width / 2 - moving.width / 2,
    y: target.top + target.height / 2 - moving.height / 2,
  };
}

export function centreOf(box: Box): Point {
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/** The id of the first box the point lies inside, or null if it is in none. */
export function boxContaining<Id>(point: Point, boxes: ReadonlyMap<Id, Box>): Id | null {
  for (const [id, box] of boxes) {
    const inside =
      point.x >= box.left &&
      point.x <= box.left + box.width &&
      point.y >= box.top &&
      point.y <= box.top + box.height;
    if (inside) return id;
  }
  return null;
}

/**
 * The next drop target up or down a list, from wherever the held item is.
 *
 * A tree's drop targets are its folders, and a note being carried starts
 * between them rather than inside one, so the step is by position: the
 * nearest target whose centre is past the held item's, in the direction
 * pressed. Null at either end, and for left and right, which a list has no use for.
 */
export function rowStep<Id>(
  boxes: ReadonlyMap<Id, Box>,
  from: Point,
  direction: Direction,
): Id | null {
  if (direction !== 'up' && direction !== 'down') return null;
  const sign = direction === 'down' ? 1 : -1;
  let best: { id: Id; distance: number } | null = null;
  for (const [id, box] of boxes) {
    const distance = (centreOf(box).y - from.y) * sign;
    // A pixel's grace: the held item sitting exactly on a target is on it, not past it.
    if (distance <= 1) continue;
    if (best === null || distance < best.distance) best = { id, distance };
  }
  return best?.id ?? null;
}
