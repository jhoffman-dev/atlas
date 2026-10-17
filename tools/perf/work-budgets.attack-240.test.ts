/*
 * Attacks on the work-budget gate (#240): ways a run could pass without
 * holding the app to its budget.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  breachesOf,
  lowered,
  type ActionBudget,
  type BudgetsFile,
  type Work,
} from './work-budgets.ts';

const tick: Work = {
  commits: 57,
  renders: { TaskRow: 1, Icon: 5712 },
  calls: { index_query: 28 },
};

const budget: ActionBudget = {
  commits: 63,
  renders: 26_370,
  calls: { index_query: 31 },
  rows: { TaskRow: 1 },
};

describe('the gate cannot pass vacuously', () => {
  it('fails a hard row rule whose component never rendered under that name (renamed, or a minified build)', () => {
    // `TaskRow` became `TaskItem`, or the build mangled the names: the rule is no longer looked at.
    const renamed: Work = { ...tick, renders: { TaskItem: 400, Icon: 5712 } };

    expect(breachesOf(renamed, budget)).not.toEqual([]);
  });

  it('fails a budget that lost a count, as a hand edit to budgets.json can leave it', () => {
    const edited = JSON.parse('{"renders": 26370, "calls": {"index_query": 31}}') as ActionBudget;
    const tenTimesTheWork: Work = { ...tick, commits: 570 };

    expect(breachesOf(tenTimesTheWork, edited)).not.toEqual([]);
  });

  it('fails an action that counted nothing at all where its budget expects work', () => {
    // What the harness recorded for "One autosave and its watcher echo" with the echo left out:
    // 0 commits, 0 renders, 0 calls, and the run was green.
    const nothing: Work = { commits: 0, renders: {}, calls: {} };

    expect(breachesOf(nothing, budget)).not.toEqual([]);
  });
});

describe('budgets.json', () => {
  const file = JSON.parse(
    readFileSync(new URL('./budgets.json', import.meta.url), 'utf8'),
  ) as BudgetsFile;

  it('counts the autosave’s own write in "One autosave and its watcher echo"', () => {
    // The 1.2 s autosave fires in the uncounted settle before counting starts, so the
    // action counts only the echo: no write_text_file in its budget, nor in any other.
    const autosave = file.actions['One autosave and its watcher echo'];

    expect(autosave?.calls.write_text_file).toBeGreaterThan(0);
  });
});

describe('PERF_BUDGETS=write', () => {
  it('never writes a budget that is not a finite number', () => {
    const edited = JSON.parse('{"renders": 26370, "calls": {}}') as ActionBudget;
    const now: ActionBudget = { commits: 63, renders: 26_370, calls: {} };

    expect(Number.isFinite(lowered(edited, now).commits)).toBe(true);
  });
});
