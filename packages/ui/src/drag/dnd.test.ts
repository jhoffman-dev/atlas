import { describe, expect, it } from 'vitest';
import type { ClientRect, CollisionDetection, DroppableContainer } from '@dnd-kit/core';
import { dropTargetWithin } from './dnd.ts';

type Args = Parameters<CollisionDetection>[0];

const rect = (top: number, height = 30): ClientRect => ({
  top,
  left: 0,
  width: 200,
  height,
  right: 200,
  bottom: top + height,
});

/** Two folders' rows: one under where the heading sticks (0–24), one below it. */
const droppableRects = new Map([
  ['hidden', rect(10)],
  ['shown', rect(60)],
]);

function args(pointer: { x: number; y: number } | null, held = rect(300)): Args {
  return {
    active: {
      id: 'note',
      data: { current: undefined },
      rect: { current: { initial: null, translated: null } },
    },
    collisionRect: held,
    droppableRects,
    droppableContainers: [...droppableRects.keys()].map(
      (id) => ({ id, disabled: false }) as unknown as DroppableContainer,
    ),
    pointerCoordinates: pointer,
  };
}

/** The scroller's visible part, below a 24px sticky heading. */
const shown = () => rect(24, 400);

describe('dropTargetWithin', () => {
  const detect = dropTargetWithin(shown);
  const ids = (found: ReturnType<CollisionDetection>) => found.map((each) => each.id);

  it('finds the target under the pointer where the scroller shows it', () => {
    expect(ids(detect(args({ x: 50, y: 70 })))).toEqual(['shown']);
  });

  it('finds nothing under a pointer on the sticky heading, though a row lies under it', () => {
    expect(ids(detect(args({ x: 50, y: 15 })))).toEqual([]);
  });

  it('finds nothing past the bottom of the scroller', () => {
    expect(ids(detect(args({ x: 50, y: 430 })))).toEqual([]);
  });

  it('leaves a keyboard drag, which has no pointer, to the centre of what it holds', () => {
    expect(ids(detect(args(null, rect(5))))).toEqual(['hidden']);
  });

  it('is plain pointer-within when nothing says what is shown', () => {
    expect(ids(dropTargetWithin(() => null)(args({ x: 50, y: 15 })))).toEqual(['hidden']);
  });
});
