import { describe, expect, it } from 'vitest';
import { doneChange } from './tick-done.ts';

const status = { key: 'status', done: 'done', options: ['backlog', 'doing', 'done'] };

/** A change as the write would make it, against the note's current properties. */
const applied = (
  change: ReturnType<typeof doneChange>,
  properties: Record<string, unknown> = {},
) => (typeof change === 'function' ? change(properties) : change);

describe('doneChange', () => {
  it('sets the done option when ticked', () => {
    expect(
      applied(doneChange({ status, done: true, previous: null }), { status: 'doing' }),
    ).toEqual({
      status: 'done',
    });
  });

  it('rolls a repeating task on instead of leaving it finished', () => {
    const change = doneChange({ status, done: true, previous: null });
    const next = applied(change, { status: 'doing', due: '2026-09-23', recurrence: 'weekly' });
    expect(next).toMatchObject({ status: 'backlog', due: '2026-09-30' });
  });

  it('puts back the status it held before, when unticked', () => {
    expect(applied(doneChange({ status, done: false, previous: 'doing' }))).toEqual({
      status: 'doing',
    });
  });

  it('starts over when the earlier status is not known', () => {
    expect(applied(doneChange({ status, done: false, previous: null }))).toEqual({
      status: 'backlog',
    });
  });
});
