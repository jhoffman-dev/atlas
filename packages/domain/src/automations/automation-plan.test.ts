import { describe, expect, it } from 'vitest';
import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import { describePlan, planAutomation } from './automation-plan.ts';

const paths = (...raw: string[]): VaultPath[] => raw.map(createVaultPath);
const ARCHIVE = { kind: 'archive' } as const;
const SET = { kind: 'set', values: { status: 'done' } } as const;

describe('planAutomation', () => {
  it('plans every matched note, in the query’s order', () => {
    const plan = planAutomation({ action: ARCHIVE, matched: paths('b.md', 'a.md') });
    expect(plan.paths).toEqual(['b.md', 'a.md']);
    expect(plan.passedOver).toEqual([]);
    expect(plan.capped).toBe(false);
  });

  it('passes over what the archive refuses, and says why', () => {
    const plan = planAutomation({
      action: ARCHIVE,
      matched: paths('a.md', 'Archive/b.md', '.atlas/templates/Task.md'),
    });
    expect(plan.paths).toEqual(['a.md']);
    expect(plan.passedOver).toEqual([
      { path: 'Archive/b.md', reason: 'It is already archived.' },
      { path: '.atlas/templates/Task.md', reason: 'Atlas keeps its own files where they are.' },
    ]);
  });

  it('never sets a property on Atlas’s own files, but may on an archived note', () => {
    const plan = planAutomation({
      action: SET,
      matched: paths('.atlas/types/task.md', 'Archive/b.md'),
    });
    expect(plan.paths).toEqual(['Archive/b.md']);
    expect(plan.passedOver).toHaveLength(1);
  });

  it('plans a note matched twice once', () => {
    expect(planAutomation({ action: ARCHIVE, matched: paths('a.md', 'a.md') }).paths).toEqual([
      'a.md',
    ]);
  });

  it('stops at the cap and says there were more', () => {
    const matched = paths('a.md', 'b.md', 'c.md', 'd.md');
    const plan = planAutomation({ action: ARCHIVE, matched, cap: 3 });
    expect(plan.paths).toEqual(['a.md', 'b.md', 'c.md']);
    expect(plan.capped).toBe(true);
    expect(planAutomation({ action: ARCHIVE, matched, cap: 4 }).capped).toBe(false);
  });

  it('counts the cap after the refusals, so refused notes do not use it up', () => {
    const plan = planAutomation({
      action: ARCHIVE,
      matched: paths('Archive/x.md', 'Archive/y.md', 'a.md', 'b.md'),
      cap: 2,
    });
    expect(plan.paths).toEqual(['a.md', 'b.md']);
    expect(plan.capped).toBe(false);
  });
});

describe('describePlan', () => {
  it('says what a dry run would do', () => {
    expect(describePlan(planAutomation({ action: ARCHIVE, matched: paths('a.md', 'b.md') }))).toBe(
      'Would archive 2 notes.',
    );
    expect(describePlan(planAutomation({ action: SET, matched: paths('a.md') }))).toBe(
      'Would change 1 note.',
    );
    expect(describePlan(planAutomation({ action: ARCHIVE, matched: [] }))).toBe(
      'Nothing to do right now.',
    );
    expect(
      describePlan(planAutomation({ action: ARCHIVE, matched: paths('a.md', 'b.md'), cap: 1 })),
    ).toBe(
      'Would archive 1 note. Stopped at 1, the most one run may do; the rest wait for the next run.',
    );
  });
});
