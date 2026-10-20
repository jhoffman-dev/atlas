/**
 * #300: a cell committed in a view's table writes the note's property, typed
 * as its editor committed it, and only while the row still shows what the
 * cell showed when its edit began.
 */
import { describe, expect, it } from 'vitest';
import type { StatusProperty } from '@atlas/domain';
import { ChangedSinceError } from '../today/today-actions.ts';
import { cellEditChanges } from './cell-edit.ts';

const STATUS: StatusProperty = {
  key: 'status',
  done: 'done',
  options: ['backlog', 'doing', 'done'],
};

/** The changes as a write would carry them out, against the note's properties. */
function applied(changes: ReturnType<typeof cellEditChanges>, properties = {}) {
  return typeof changes === 'function' ? changes(properties) : changes;
}

describe('cellEditChanges', () => {
  it('writes the value typed as its editor committed it', () => {
    const changes = cellEditChanges({
      edit: { column: 'phase', value: 3, began: { value: 2 } },
      now: { phase: 2 },
      status: null,
    });
    expect(applied(changes)).toEqual({ phase: 3 });
  });

  it('takes an emptied cell out of the note', () => {
    const changes = cellEditChanges({
      edit: { column: 'owner', value: [], began: { value: '[[Mara Quill]]' } },
      now: { owner: '[[Mara Quill]]' },
      status: null,
    });
    expect(applied(changes)).toEqual({ owner: null });
  });

  it('refuses a commit from a row whose cell changed since the edit began, writing nothing', () => {
    expect(() =>
      cellEditChanges({
        edit: { column: 'status', value: 'doing', began: { value: 'backlog' } },
        now: { status: 'done' },
        status: STATUS,
      }),
    ).toThrow(ChangedSinceError);
  });

  it('lets a change to another of the row’s cells through: only the edited cell is judged', () => {
    const changes = cellEditChanges({
      edit: { column: 'phase', value: 3, began: { value: 2 } },
      now: { phase: 2, status: 'done' },
      status: STATUS,
    });
    expect(applied(changes)).toEqual({ phase: 3 });
  });

  it('writes a change that needs no editor open — a box ticked — without judging it', () => {
    const changes = cellEditChanges({
      edit: { column: 'flagged', value: true },
      now: { flagged: 'true' },
      status: null,
    });
    expect(applied(changes)).toEqual({ flagged: true });
  });

  it('writes a row the view no longer shows as the edit asked: there is nothing to judge it by', () => {
    const changes = cellEditChanges({
      edit: { column: 'phase', value: 3, began: { value: 2 } },
      now: null,
      status: null,
    });
    expect(applied(changes)).toEqual({ phase: 3 });
  });

  it('rolls a repeating task on when its status cell is set to done, as a tick does', () => {
    const changes = cellEditChanges({
      edit: { column: 'status', value: 'done', began: { value: 'doing' } },
      now: { status: 'doing' },
      status: STATUS,
    });
    const rolled = applied(changes, {
      status: 'doing',
      due: '2026-01-05',
      recurrence: 'every week',
    });
    expect(rolled).toMatchObject({ status: 'backlog', due: '2026-01-12' });
  });

  it('writes done as done for a task that does not repeat', () => {
    const changes = cellEditChanges({
      edit: { column: 'status', value: 'done', began: { value: 'doing' } },
      now: { status: 'doing' },
      status: STATUS,
    });
    expect(applied(changes, { status: 'doing' })).toEqual({ status: 'done' });
  });
});
