import { describe, expect, it } from 'vitest';
import {
  AFTER_A_MEETING_PRESET,
  createVaultPath,
  planAutomation,
  type AutomationRule,
  type LogEntry,
} from '@atlas/domain';
import {
  automationRows,
  dryRunView,
  logViews,
  meetingAssistantView,
  shownTime,
} from './automation-rows.ts';

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

describe('logViews of a Claude step (P29-03)', () => {
  it('names each proposal and note it made, and offers no undo', () => {
    const asked: LogEntry = {
      kind: 'run',
      at: '2026-10-11T09:00:00',
      trigger: 'hand',
      done: [
        { kind: 'proposed', path: createVaultPath('Inbox/Proposals/Send the file.md') },
        { kind: 'created', path: createVaultPath('Briefs/Brief.md') },
      ],
      left: [],
      capped: false,
      claude: { model: 'claude-opus-5-5', ms: 1200 },
    };
    const [view] = logViews([asked]);
    expect(view?.summary).toBe('Made 1 proposal. Made 1 note.');
    expect(view?.lines).toEqual([
      { kind: 'done', text: 'Proposed Send the file (Inbox/Proposals/Send the file.md)' },
      { kind: 'done', text: 'Made Brief (Briefs/Brief.md)' },
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

/** P29-06: a rule of several steps, as its log and the meeting assistant's switch show it. */
describe('a rule of several steps', () => {
  const MEETING = p('Inbox/Meetings/2026-10-06 Standup.md');
  const STEPS: LogEntry = {
    kind: 'failed',
    at: '2026-10-08T09:00:00',
    trigger: 'note',
    problem: 'Step 2 of 3 stopped it.',
    done: [
      { kind: 'corrected', path: MEETING, count: 2 },
      { kind: 'linked', path: MEETING, count: 1 },
    ],
    steps: {
      note: MEETING,
      records: [
        { step: 'correct-terms', outcome: 'done', said: 'Corrected 2 misheard spellings.' },
        { step: 'claude meeting-items', outcome: 'failed', said: 'Extraction failed: no answer.' },
        { step: 'claude term-suggestions', outcome: 'skipped', said: 'Not run.' },
      ],
    },
  };

  it('lists each step in order, numbered, a failed or skipped one marked as left', () => {
    expect(logViews([STEPS])[0]?.lines).toEqual([
      { kind: 'done', text: 'Step 1 · Corrected 2 misheard spellings.' },
      { kind: 'left', text: 'Step 2 · Extraction failed: no answer.' },
      { kind: 'left', text: 'Step 3 · Not run.' },
      { kind: 'done', text: 'Corrected 2 spellings in 2026-10-06 Standup' },
      { kind: 'done', text: 'Linked or proposed 1 link for 2026-10-06 Standup' },
    ]);
  });

  it('says what an undo of it took back', () => {
    const undo: LogEntry = {
      kind: 'undo',
      at: '2026-10-08T09:05:00',
      of: STEPS.at,
      done: [
        { kind: 'uncorrected', path: MEETING, count: 1 },
        { kind: 'unlinked', path: MEETING, count: 3 },
      ],
      left: [],
    };
    expect(logViews([undo])[0]?.lines).toEqual([
      { kind: 'done', text: 'Put back 1 spelling in 2026-10-06 Standup' },
      { kind: 'done', text: 'Took back 3 links for 2026-10-06 Standup' },
    ]);
  });

  it('can be undone when its last run corrected or linked, even one that failed part-way', () => {
    const rule: AutomationRule = { ...RULE, action: AFTER_A_MEETING_PRESET.action };
    const [row] = automationRows(
      { automations: [{ rule, log: [STEPS], ledger: null, idWritten: true }], broken: [] },
      CLOCK,
    );
    expect(row?.canUndo).toBe(true);
    expect(row?.action).toBe(
      'Correct its terms → Link its people and companies → Ask Claude (meeting-extraction) for meeting-items → Ask Claude (term-suggestions) for term-suggestions',
    );
  });
});

describe('meetingAssistantView', () => {
  const rule: AutomationRule = {
    ...RULE,
    name: 'After a meeting',
    action: AFTER_A_MEETING_PRESET.action,
  };

  it('is off, with the ready-made steps, in a vault that has no such rule yet', () => {
    expect(meetingAssistantView({ loaded: null, broken: null })).toEqual({
      on: false,
      steps: [
        'Correct its terms',
        'Link its people and companies',
        'Ask Claude (meeting-extraction) for meeting-items',
        'Ask Claude (term-suggestions) for term-suggestions',
      ],
      lastRun: null,
      problem: null,
    });
  });

  it('is the rule’s own on and off, its own steps, and when it last ran', () => {
    const steps = { kind: 'steps', steps: [{ kind: 'correct-terms' }] } as const;
    const on = meetingAssistantView({
      loaded: { rule: { ...rule, action: steps }, log: [RUN], ledger: null, idWritten: true },
      broken: null,
    });
    expect(on).toMatchObject({ on: true, steps: ['Correct its terms'] });
    expect(on.lastRun).toBe('27 Sep 2026, 03:00 · Archived 1 note. Left 1 alone.');
    const off = meetingAssistantView({
      loaded: { rule: { ...rule, enabled: false }, log: [], ledger: null, idWritten: true },
      broken: null,
    });
    expect(off).toMatchObject({ on: false, lastRun: null });
  });

  it('says why it is off when the rule’s file cannot be read', () => {
    const view = meetingAssistantView({
      loaded: null,
      broken: {
        path: rule.path,
        name: 'After a meeting',
        problem: 'Write enabled: true or false.',
      },
    });
    expect(view.problem).toBe(
      'Its rule’s file cannot be read, so it is off: Write enabled: true or false.',
    );
    expect(view.on).toBe(false);
  });
});
