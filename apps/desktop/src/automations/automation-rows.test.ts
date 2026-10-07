import { describe, expect, it } from 'vitest';
import { createVaultPath, planAutomation, type AutomationRule, type LogEntry } from '@atlas/domain';
import { automationRows, dryRunView, logViews, shownTime } from './automation-rows.ts';

const p = createVaultPath;
const CLOCK = {
  watchingSince: '2026-09-27T09:00:00',
  now: '2026-09-27T09:00:00',
  pauses: new Map(),
};

const RULE: AutomationRule = {
  id: 'Tidy',
  path: p('.atlas/automations/Tidy.md'),
  name: 'Tidy',
  enabled: true,
  when: { kind: 'daily', at: '03:00' },
  which: 'FROM task',
  olderThanDays: 30,
  action: { kind: 'archive' },
};

const RUN: LogEntry = {
  kind: 'run',
  at: '2026-09-27T03:00:05',
  trigger: 'schedule',
  done: [{ kind: 'archived', from: p('Tasks/Old.md'), to: p('Archive/Tasks/Old.md') }],
  left: [{ path: p('Tasks/Busy.md'), reason: 'It is open in Atlas with unsaved typing.' }],
  capped: false,
};

describe('shownTime', () => {
  it('writes a wall-clock time as the page shows it', () => {
    expect(shownTime('2026-09-07T03:00:05')).toBe('7 Sep 2026, 03:00');
    expect(shownTime('2026-12-31T23:59:59', { seconds: true })).toBe('31 Dec 2026, 23:59:59');
  });
});

describe('automationRows', () => {
  it('says when a rule last ran and what it did, and when it runs next', () => {
    const [row] = automationRows(
      { automations: [{ rule: RULE, log: [RUN], idWritten: true }], broken: [] },
      CLOCK,
    );
    expect(row).toEqual({
      id: RULE.path,
      name: 'Tidy',
      enabled: true,
      schedule: 'Every day at 03:00',
      action: 'Archive',
      lastRun: '27 Sep 2026, 03:00 · Archived 1 note. Left 1 alone.',
      nextRun: '28 Sep 2026, 03:00',
      canUndo: true,
      problem: null,
      notice: null,
    });
  });

  it('lists a never-run rule, and a broken one with why', () => {
    const rows = automationRows(
      {
        automations: [{ rule: { ...RULE, enabled: false }, log: [], idWritten: true }],
        broken: [
          { path: p('.atlas/automations/Bad.md'), name: 'Bad', problem: 'Say when it runs.' },
        ],
      },
      CLOCK,
    );
    expect(
      rows.map((row) => [row.name, row.lastRun, row.nextRun, row.canUndo, row.problem]),
    ).toEqual([
      ['Tidy', null, null, false, null],
      ['Bad', null, null, false, 'This rule’s file cannot be read: Say when it runs.'],
    ]);
  });
});

describe('logViews', () => {
  it('lists the log newest first, each thing done and each note left in words', () => {
    const undo: LogEntry = {
      kind: 'undo',
      at: '2026-09-27T09:00:00',
      of: RUN.at,
      done: [
        { kind: 'unarchived', from: p('Archive/Tasks/Old.md'), to: p('Tasks/Old.md') },
        {
          kind: 'restored',
          path: p('Tasks/B.md'),
          key: 'status',
          before: { value: 'done' },
          after: { absent: true },
        },
      ],
      left: [],
    };
    const [first, second] = logViews([RUN, undo]);
    expect(first?.heading).toBe('27 Sep 2026, 09:00:00 · Undid the run of 2026-09-27 03:00:05');
    expect(first?.lines.map((line) => line.text)).toEqual([
      'Put back Old (Tasks/Old.md)',
      'Restored status on B: "done" → nothing',
    ]);
    expect(second?.lines).toEqual([
      { kind: 'done', text: 'Archived Old (Tasks/Old.md)' },
      { kind: 'left', text: 'Left Busy: It is open in Atlas with unsaved typing.' },
    ]);
  });
});

describe('dryRunView', () => {
  it('names each note the plan would take, and each it would leave', () => {
    const plan = planAutomation({
      action: { kind: 'archive' },
      matched: [p('Tasks/A.md'), p('Archive/B.md')],
    });
    expect(dryRunView(plan)).toEqual({
      kind: 'plan',
      summary: 'Would archive 1 note.',
      notes: [{ path: 'Tasks/A.md', title: 'A' }],
      passedOver: [{ title: 'B', reason: 'It is already archived.' }],
    });
  });
});
