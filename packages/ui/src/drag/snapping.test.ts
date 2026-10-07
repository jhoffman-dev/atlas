import { describe, expect, it } from 'vitest';
import {
  boardStep,
  laneStep,
  boxContaining,
  calendarStep,
  centredOn,
  dashboardStep,
  daysMoved,
  directionOf,
  grabOffset,
  rowStep,
  timelineStep,
} from './snapping.ts';

describe('rowStep', () => {
  const row = (top: number) => ({ left: 0, top, width: 200, height: 30 });
  const folders = new Map([
    ['a', row(0)],
    ['b', row(60)],
    ['c', row(150)],
  ]);

  it('goes to the nearest folder below, from between two of them', () => {
    expect(rowStep(folders, { x: 10, y: 100 }, 'down')).toBe('c');
  });

  it('goes to the nearest folder above', () => {
    expect(rowStep(folders, { x: 10, y: 100 }, 'up')).toBe('b');
  });

  it('moves on from the folder it is sitting on', () => {
    expect(rowStep(folders, { x: 10, y: 75 }, 'down')).toBe('c');
    expect(rowStep(folders, { x: 10, y: 75 }, 'up')).toBe('a');
  });

  it('stops at either end', () => {
    expect(rowStep(folders, { x: 10, y: 165 }, 'down')).toBeNull();
    expect(rowStep(folders, { x: 10, y: 15 }, 'up')).toBeNull();
  });

  it('ignores left and right', () => {
    expect(rowStep(folders, { x: 10, y: 100 }, 'left')).toBeNull();
  });
});

describe('directionOf', () => {
  it('reads the four arrow keys', () => {
    expect(directionOf('ArrowLeft')).toBe('left');
    expect(directionOf('ArrowRight')).toBe('right');
    expect(directionOf('ArrowUp')).toBe('up');
    expect(directionOf('ArrowDown')).toBe('down');
  });

  it('ignores every other key', () => {
    expect(directionOf('KeyA')).toBeNull();
    expect(directionOf('Space')).toBeNull();
  });
});

describe('boardStep', () => {
  const columns = ['backlog', 'doing', 'done'];

  it('moves one column left or right', () => {
    expect(boardStep(columns, 'doing', 'left')).toBe('backlog');
    expect(boardStep(columns, 'doing', 'right')).toBe('done');
  });

  it('stops at either end rather than wrapping', () => {
    expect(boardStep(columns, 'backlog', 'left')).toBe('backlog');
    expect(boardStep(columns, 'done', 'right')).toBe('done');
  });

  it('does not move up or down, because a column keeps no order of its own', () => {
    expect(boardStep(columns, 'doing', 'up')).toBe('doing');
    expect(boardStep(columns, 'doing', 'down')).toBe('doing');
  });

  it('stays put when the current column is not on the board', () => {
    expect(boardStep(columns, 'gone', 'right')).toBe('gone');
  });
});

describe('laneStep', () => {
  const cells = [
    ['backlog/a', 'doing/a', 'done/a'],
    ['backlog/b', 'doing/b', 'done/b'],
  ];

  it('moves one column left or right within the lane', () => {
    expect(laneStep(cells, 'doing/b', 'left')).toBe('backlog/b');
    expect(laneStep(cells, 'doing/b', 'right')).toBe('done/b');
  });

  it('moves one lane up or down within the column', () => {
    expect(laneStep(cells, 'doing/a', 'down')).toBe('doing/b');
    expect(laneStep(cells, 'doing/b', 'up')).toBe('doing/a');
  });

  it('stops at every edge rather than wrapping', () => {
    expect(laneStep(cells, 'doing/a', 'up')).toBe('doing/a');
    expect(laneStep(cells, 'doing/b', 'down')).toBe('doing/b');
    expect(laneStep(cells, 'done/a', 'right')).toBe('done/a');
  });

  it('stays put when the current cell is not on the board', () => {
    expect(laneStep(cells, 'gone', 'down')).toBe('gone');
  });
});

describe('dashboardStep', () => {
  it('moves earlier on left and up, later on right and down', () => {
    expect(dashboardStep('left', false)).toBe('earlier');
    expect(dashboardStep('up', false)).toBe('earlier');
    expect(dashboardStep('right', false)).toBe('later');
    expect(dashboardStep('down', false)).toBe('later');
  });

  it('resizes with shift on left and right only', () => {
    expect(dashboardStep('left', true)).toBe('narrower');
    expect(dashboardStep('right', true)).toBe('wider');
    expect(dashboardStep('up', true)).toBeNull();
    expect(dashboardStep('down', true)).toBeNull();
  });
});

describe('calendarStep', () => {
  // Two weeks, Monday first: 1st–7th then 8th–14th.
  const days = Array.from(
    { length: 14 },
    (_unused, day) => `2026-06-${String(day + 1).padStart(2, '0')}`,
  );

  it('moves a day left or right', () => {
    expect(calendarStep(days, '2026-06-03', 'left')).toBe('2026-06-02');
    expect(calendarStep(days, '2026-06-03', 'right')).toBe('2026-06-04');
  });

  it('runs from the end of one week into the start of the next, as a date does', () => {
    expect(calendarStep(days, '2026-06-07', 'right')).toBe('2026-06-08');
    expect(calendarStep(days, '2026-06-08', 'left')).toBe('2026-06-07');
  });

  it('moves a week up or down', () => {
    expect(calendarStep(days, '2026-06-03', 'down')).toBe('2026-06-10');
    expect(calendarStep(days, '2026-06-10', 'up')).toBe('2026-06-03');
  });

  it('stops at the edge of the grid rather than wrapping', () => {
    expect(calendarStep(days, '2026-06-03', 'up')).toBe('2026-06-03');
    expect(calendarStep(days, '2026-06-10', 'down')).toBe('2026-06-10');
    expect(calendarStep(days, '2026-06-01', 'left')).toBe('2026-06-01');
    expect(calendarStep(days, '2026-06-14', 'right')).toBe('2026-06-14');
  });
});

describe('timelineStep', () => {
  it('moves a day either way', () => {
    expect(timelineStep('left', 26)).toBe(-26);
    expect(timelineStep('right', 26)).toBe(26);
  });

  it('does not move up or down: a bar only moves in time', () => {
    expect(timelineStep('up', 26)).toBe(0);
    expect(timelineStep('down', 26)).toBe(0);
  });
});

describe('daysMoved', () => {
  it('counts whole days travelled from the day the bar was grabbed on', () => {
    expect(daysMoved({ grabOffset: 13, deltaX: 52, dayWidth: 26 })).toBe(2);
    expect(daysMoved({ grabOffset: 13, deltaX: -26, dayWidth: 26 })).toBe(-1);
  });

  it('crosses into the next day at the day line, not after a whole day width', () => {
    // Grabbed 2px before the end of day 0; 3px to the right is day 1.
    expect(daysMoved({ grabOffset: 24, deltaX: 3, dayWidth: 26 })).toBe(1);
    // Grabbed at the start of day 0; the same 3px stays in day 0.
    expect(daysMoved({ grabOffset: 0, deltaX: 3, dayWidth: 26 })).toBe(0);
  });

  it('is nothing when the bar has not left its day', () => {
    expect(daysMoved({ grabOffset: 13, deltaX: 5, dayWidth: 26 })).toBe(0);
  });
});

describe('grabOffset', () => {
  it('is where the pointer pressed, measured from the start of the chart', () => {
    // A bar three days in, pressed 40px from its own left edge.
    expect(grabOffset({ clientX: 540, barLeft: 500, offset: 3, dayWidth: 26 })).toBe(118);
  });

  it('is the middle of the first day for a keyboard pick-up', () => {
    expect(grabOffset({ clientX: null, barLeft: 500, offset: 3, dayWidth: 26 })).toBe(91);
  });

  it('makes each keyboard step exactly one day, whole days only', () => {
    const grab = grabOffset({ clientX: null, barLeft: 0, offset: 3, dayWidth: 26 });
    expect(daysMoved({ grabOffset: grab, deltaX: 26, dayWidth: 26 })).toBe(1);
    expect(daysMoved({ grabOffset: grab, deltaX: -78, dayWidth: 26 })).toBe(-3);
  });
});

describe('centredOn', () => {
  it('places the centre of the moving box on the centre of the target', () => {
    const target = { left: 300, top: 0, width: 280, height: 600 };
    const moving = { left: 10, top: 60, width: 260, height: 60 };
    expect(centredOn(target, moving)).toEqual({ x: 310, y: 270 });
  });
});

describe('boxContaining', () => {
  const boxes = new Map([
    ['backlog', { left: 0, top: 0, width: 280, height: 600 }],
    ['doing', { left: 300, top: 0, width: 280, height: 600 }],
  ]);

  it('finds the box a point lies in', () => {
    expect(boxContaining({ x: 440, y: 90 }, boxes)).toBe('doing');
    expect(boxContaining({ x: 10, y: 90 }, boxes)).toBe('backlog');
  });

  it('finds none in the gap between boxes', () => {
    expect(boxContaining({ x: 290, y: 90 }, boxes)).toBeNull();
  });
});
