/**
 * What one card dropped on a board writes (issue #6): the column's property,
 * the lane's, and — only when the type's own status is set to done — a
 * repeating task rolled forward, once.
 */

import { describe, expect, it } from 'vitest';
import type { StatusProperty } from '@atlas/domain';
import { cardMoveChanges, movesToDone } from './card-move.ts';

type Rule = (properties: Record<string, unknown>) => Record<string, unknown>;

const STATUS: StatusProperty = {
  key: 'status',
  done: 'done',
  options: ['backlog', 'doing', 'done'],
};

/** A weekly task in play. */
const REPEATING = { status: 'doing', area: 'home', due: '2026-01-05', recurrence: 'every week' };

/** What the move writes, applied to the note's properties as the file write would. */
const written = (change: ReturnType<typeof cardMoveChanges>) =>
  typeof change === 'function' ? (change as Rule)(REPEATING) : change;

describe('cardMoveChanges', () => {
  it('writes the column and the lane as one change', () => {
    expect(
      cardMoveChanges({
        column: { key: 'area', value: 'work' },
        lane: { key: 'status', value: 'doing' },
        status: STATUS,
        columnOptions: ['home', 'work'],
      }),
    ).toEqual({ area: 'work', status: 'doing' });
  });

  it('does not finish a task by its last column when the type has a status of its own', () => {
    const change = cardMoveChanges({
      column: { key: 'area', value: 'work' },
      lane: null,
      status: STATUS,
      columnOptions: ['home', 'work'],
    });
    expect(written(change)).toEqual({ area: 'work' });
  });

  it('rolls a repeating task forward once when its lane is done, keeping the column it was dropped in', () => {
    const change = cardMoveChanges({
      column: { key: 'area', value: 'work' },
      lane: { key: 'status', value: 'done' },
      status: STATUS,
      columnOptions: ['home', 'work'],
    });
    expect(written(change)).toMatchObject({
      area: 'work',
      status: 'backlog',
      due: '2026-01-12',
    });
  });

  it('rolls a repeating task forward when its status column is done', () => {
    const change = cardMoveChanges({
      column: { key: 'status', value: 'done' },
      lane: { key: 'area', value: 'work' },
      status: STATUS,
      columnOptions: STATUS.options,
    });
    expect(written(change)).toMatchObject({ area: 'work', status: 'backlog', due: '2026-01-12' });
  });

  it('writes done as is for a task that does not repeat', () => {
    const change = cardMoveChanges({
      column: { key: 'status', value: 'done' },
      lane: null,
      status: STATUS,
      columnOptions: STATUS.options,
    });
    expect(typeof change === 'function' ? (change as Rule)({ status: 'doing' }) : change).toEqual({
      status: 'done',
    });
  });

  it('takes the last column as done for a type with no status, as a plain board always has', () => {
    const change = cardMoveChanges({
      column: { key: 'stage', value: 'shipped' },
      lane: null,
      status: null,
      columnOptions: ['idea', 'building', 'shipped'],
    });
    expect(written(change)).toMatchObject({ stage: 'idea', due: '2026-01-12' });
  });

  it('never finishes by a lane when the type has no status', () => {
    const change = cardMoveChanges({
      column: null,
      lane: { key: 'stage', value: 'shipped' },
      status: null,
      columnOptions: ['home', 'work'],
    });
    expect(written(change)).toEqual({ stage: 'shipped' });
  });
});

describe('cardMoveChanges: values typed by their property', () => {
  it('writes a number column as a number and a checkbox lane as a tick, never as text', () => {
    expect(
      cardMoveChanges({
        column: { key: 'points', value: '3', kind: 'number' },
        lane: { key: 'flagged', value: 'true', kind: 'checkbox' },
        status: STATUS,
        columnOptions: [],
      }),
    ).toEqual({ points: 3, flagged: true });
  });

  it('writes the unticked group as false, so a ticked card dropped there loses its tick', () => {
    expect(
      cardMoveChanges({
        column: { key: 'flagged', value: 'false', kind: 'checkbox' },
        lane: null,
        status: STATUS,
        columnOptions: [],
      }),
    ).toEqual({ flagged: false });
  });
});

describe('movesToDone', () => {
  it("says a move finishes the task when it puts the card in its status's done", () => {
    expect(
      movesToDone({
        column: { key: 'area', value: 'work' },
        lane: { key: 'status', value: 'done' },
        status: STATUS,
        columnOptions: ['home', 'work'],
      }),
    ).toBe(true);
  });

  it('says a move elsewhere, or a last column that is not the status, finishes nothing', () => {
    expect(
      movesToDone({
        column: { key: 'area', value: 'work' },
        lane: { key: 'status', value: 'doing' },
        status: STATUS,
        columnOptions: ['home', 'work'],
      }),
    ).toBe(false);
  });

  it('reads a type with no status by its column, as the plain board does', () => {
    expect(
      movesToDone({
        column: { key: 'stage', value: 'shipped' },
        lane: null,
        status: null,
        columnOptions: ['idea', 'shipped'],
      }),
    ).toBe(true);
  });
});
