/**
 * Attacks on the timeline's dates.
 *
 * The module's own rule is that a date it cannot read is counted as undated
 * rather than guessed at — `2026-13-45` already is. These tests hold it to that
 * for dates that look plausible and are not real days.
 */

import { describe, expect, it } from 'vitest';
import { addDays, buildTimeline } from './timeline.ts';

const dayOf = (value: string) =>
  buildTimeline({
    rows: [{ path: 'a.md', title: 'A', values: { scheduled: value, due: value } }],
    startKey: 'scheduled',
    endKey: 'due',
  });

describe('buildTimeline on a date that is not a real day', () => {
  it.each(['2026-02-30', '2026-02-29', '2026-04-31', '2026-06-31'])(
    'does not silently move a task written as %s to another day',
    (written) => {
      const built = dayOf(written);
      // Either it is undated, like 2026-13-45, or it stays where it was
      // written. What it may not do is quietly land two days later.
      expect(built.entries[0]?.start ?? written).toBe(written);
    },
  );

  it('counts 2026-02-30 as undated, the way it counts 2026-13-45', () => {
    expect(dayOf('2026-02-30').undated).toBe(dayOf('2026-13-45').undated);
  });
});

describe('buildTimeline at the edges of the calendar', () => {
  it('keeps a leap day that does exist', () => {
    expect(dayOf('2028-02-29').entries[0]?.start).toBe('2028-02-29');
  });

  it('keeps the first day there is', () => {
    expect(dayOf('0000-01-01').entries[0]?.start).toBe('0000-01-01');
  });
});

describe('addDays', () => {
  it('returns a date it can write, or null, and never an expanded year', () => {
    expect(addDays('9999-12-30', 1)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(addDays('9999-12-31', 1)).toBeNull();
  });

  it('does not throw when the answer falls off the end of time', () => {
    expect(() => addDays('2026-09-20', 1e12)).not.toThrow();
  });
});
