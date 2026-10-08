import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  appendLogEntry,
  formatLogEntry,
  lastRunOf,
  lastScheduleMark,
  lastUndoableRun,
  logEntrySummary,
  logPathFor,
  newLogText,
  parseRunLog,
  stillAsLeft,
  type LogEntry,
} from './run-log.ts';

const p = createVaultPath;
const NOW = '2026-10-01T00:00:00';

const RUN: LogEntry = {
  kind: 'run',
  at: '2026-09-27T03:00:12',
  trigger: 'schedule',
  done: [
    { kind: 'archived', from: p('Tasks/A.md'), to: p('Archive/Tasks/A.md') },
    {
      kind: 'set',
      path: p('Tasks/B.md'),
      key: 'status',
      before: { value: 'todo' },
      after: { value: 'done' },
    },
    {
      kind: 'set',
      path: p('Tasks/B.md'),
      key: 'flag',
      before: { absent: true },
      after: { value: true },
    },
  ],
  left: [{ path: p('Tasks/C.md'), reason: 'It is open in Atlas with unsaved typing.' }],
  capped: false,
};

const UNDO: LogEntry = {
  kind: 'undo',
  at: '2026-09-27T09:15:00',
  of: RUN.at,
  done: [{ kind: 'unarchived', from: p('Archive/Tasks/A.md'), to: p('Tasks/A.md') }],
  left: [],
};

describe('formatLogEntry', () => {
  it('writes an entry a person can read', () => {
    expect(formatLogEntry(RUN)).toBe(
      [
        '## 2026-09-27 03:00:12 · Ran on schedule',
        '',
        'Archived 1 note. Changed 1 note. Left 1 alone.',
        '',
        '- archived `"Tasks/A.md"` → `"Archive/Tasks/A.md"`',
        '- set `"Tasks/B.md"` `"status"`: `"todo"` → `"done"`',
        '- set `"Tasks/B.md"` `"flag"`: nothing → `true`',
        '- left `"Tasks/C.md"`: It is open in Atlas with unsaved typing.',
        '',
      ].join('\n'),
    );
  });

  it('heads an undo, a failure and a turning on with what they were', () => {
    expect(formatLogEntry(UNDO)).toMatch(
      /^## 2026-09-27 09:15:00 · Undid the run of 2026-09-27 03:00:12\n\nPut back 1 note\./,
    );
    expect(
      formatLogEntry({ kind: 'failed', at: RUN.at, trigger: 'hand', problem: 'No\ntype task.' }),
    ).toBe('## 2026-09-27 03:00:12 · Ran by hand, and could not\n\nNo type task.\n');
    expect(formatLogEntry({ kind: 'turnedOn', at: RUN.at })).toContain('· Turned on');
  });
});

describe('parseRunLog', () => {
  it('reads back every entry exactly as it was written', () => {
    const entries: LogEntry[] = [
      { kind: 'turnedOn', at: '2026-09-26T10:00:00' },
      RUN,
      UNDO,
      { kind: 'failed', at: '2026-09-28T03:00:00', trigger: 'open', problem: 'No type task.' },
      {
        kind: 'run',
        at: '2026-09-29T03:00:00',
        trigger: 'hand',
        done: [],
        left: [],
        capped: false,
      },
    ];
    expect(parseRunLog(newLogText('Tidy', entries))).toEqual(entries);
  });

  it('reads back the versions a note-triggered run handled and wrote', () => {
    const noted: LogEntry = {
      kind: 'run',
      at: '2026-10-08T09:00:00',
      trigger: 'note',
      done: [
        {
          kind: 'set',
          path: p('Inbox/Meetings/Standup "daily".md'),
          key: 'status',
          before: { absent: true },
          after: { value: 'new' },
        },
      ],
      left: [],
      capped: false,
      versions: [
        { path: p('Inbox/Meetings/Standup "daily".md'), digest: '1a2b3c4d', wrote: false },
        { path: p('Inbox/Meetings/Standup "daily".md'), digest: '5e6f7a8b', wrote: true },
      ],
    };
    const text = newLogText('Mark', [noted]);
    expect(text).toContain('## 2026-10-08 09:00:00 · Ran when a note appeared or changed');
    expect(text).toContain(
      '- triggered by `"Inbox/Meetings/Standup \\"daily\\".md"` at `"1a2b3c4d"`',
    );
    expect(text).toContain('- wrote `"Inbox/Meetings/Standup \\"daily\\".md"` at `"5e6f7a8b"`');
    expect(parseRunLog(text)).toEqual([noted]);
  });

  it('reads back the notes a run says went', () => {
    const forgot: LogEntry = {
      kind: 'run',
      at: '2026-10-08T09:00:00',
      trigger: 'note',
      done: [],
      left: [],
      capped: false,
      went: [p('Inbox/Meetings/Standup.md')],
    };
    const text = newLogText('Mark', [forgot]);
    expect(text).toContain('- went `"Inbox/Meetings/Standup.md"`');
    expect(parseRunLog(text)).toEqual([forgot]);
    const edited = text.replace('`"Inbox/Meetings/Standup.md"`', '`{broken`');
    expect(parseRunLog(edited)[0]).toMatchObject({ kind: 'run', trigger: 'note' });
    expect(parseRunLog(edited)[0]).not.toHaveProperty('went');
  });

  it('leaves out a version line edited into one that does not read', () => {
    const text = [
      '## 2026-10-08 09:00:00 · Ran when a note appeared or changed',
      '',
      'Nothing to do.',
      '',
      '- triggered by `"A.md"` at `"good"`',
      '- triggered by `"B.md"` at `{broken`',
      '- wrote `"C.md"` at `7`',
      '- wrote `"/outside.md"` at `"abc"`',
    ].join('\n');
    const [entry] = parseRunLog(text);
    expect(entry?.kind === 'run' && entry.versions).toEqual([
      { path: 'A.md', digest: 'good', wrote: false },
    ]);
  });

  it('reads back paths and values that would break a looser format', () => {
    const awkward: LogEntry = {
      kind: 'run',
      at: '2026-09-27T03:00:00',
      trigger: 'hand',
      done: [
        { kind: 'archived', from: p('a `b` → c.md'), to: p('Archive/a `b` → c.md') },
        {
          kind: 'set',
          path: p('x.md'),
          key: 'note',
          before: { value: ['`tick`', { deep: 'a" → b' }] },
          after: { value: '`' },
        },
      ],
      left: [],
      capped: true,
    };
    expect(parseRunLog(newLogText('Tidy', [awkward]))).toEqual([awkward]);
  });

  it('leaves out what a person edited into something that does not read', () => {
    const text = [
      newLogText('Tidy', [RUN]),
      '## someday · Ran on schedule',
      '',
      '## 2026-09-30 03:00:00 · Ran on a whim',
      '',
    ].join('\n');
    const edited = text
      .replace('- archived `"Tasks/A.md"`', '- archived `{"broken"`')
      .replace('`"status"`', '`42`');
    const [entry, ...rest] = parseRunLog(edited);
    expect(rest).toEqual([]);
    // Both damaged lines are gone; the one that still reads is kept.
    expect(entry?.kind === 'run' && entry.done).toEqual([RUN.done[2]]);
  });

  it('tells a capped run by its line', () => {
    const capped = { ...RUN, capped: true } as LogEntry;
    const [read] = parseRunLog(newLogText('Tidy', [capped]));
    expect(read?.kind === 'run' && read.capped).toBe(true);
    expect(logEntrySummary(capped)).toContain('Stopped at 2, the most one run may do');
  });
});

describe('appendLogEntry', () => {
  it('starts a log with its heading', () => {
    const text = appendLogEntry({ text: null, ruleName: 'Tidy', entry: RUN });
    expect(text.startsWith('---\natlas: automation-log\n---\n\n# Tidy — run log\n\n## ')).toBe(
      true,
    );
  });

  it('adds at the end, keeping what came before the first entry as it was', () => {
    const start = '---\natlas: automation-log\n---\n\n# Tidy\n\nMy own words.\n';
    const once = appendLogEntry({ text: start, ruleName: 'Tidy', entry: RUN });
    const twice = appendLogEntry({ text: once, ruleName: 'Tidy', entry: UNDO });
    expect(twice.startsWith(`${start}\n## 2026-09-27 03:00:12`)).toBe(true);
    expect(parseRunLog(twice)).toEqual([RUN, UNDO]);
  });

  it('drops the oldest entries past what a log keeps', () => {
    let text: string | null = null;
    for (let hour = 10; hour < 15; hour += 1) {
      const entry: LogEntry = { kind: 'turnedOn', at: `2026-09-27T${hour}:00:00` };
      text = appendLogEntry({ text, ruleName: 'Tidy', entry, keep: 3 });
    }
    expect(parseRunLog(text!).map((entry) => entry.at)).toEqual([
      '2026-09-27T12:00:00',
      '2026-09-27T13:00:00',
      '2026-09-27T14:00:00',
    ]);
    expect(text!.startsWith('---\natlas: automation-log\n---\n\n# Tidy — run log\n\n')).toBe(true);
  });
});

describe('lastUndoableRun', () => {
  const empty: LogEntry = { ...RUN, at: '2026-09-28T03:00:00', done: [] } as LogEntry;

  it('is the newest run that did something', () => {
    expect(lastUndoableRun([RUN, empty])).toBe(RUN);
  });

  it('is nothing once that run has been undone, and never reaches further back', () => {
    const older = { ...RUN, at: '2026-09-20T03:00:00' } as LogEntry;
    expect(lastUndoableRun([older, RUN, UNDO])).toBeNull();
    expect(lastUndoableRun([{ kind: 'turnedOn', at: RUN.at }])).toBeNull();
  });
});

describe('lastScheduleMark and lastRunOf', () => {
  it('counts the next run from the latest run, failure or turning on — not from an undo', () => {
    const failed: LogEntry = {
      kind: 'failed',
      at: '2026-09-27T05:00:00',
      trigger: 'open',
      problem: 'x',
    };
    expect(lastScheduleMark([RUN, UNDO], NOW)).toBe(RUN.at);
    expect(lastScheduleMark([RUN, failed, UNDO], NOW)).toBe(failed.at);
    expect(lastScheduleMark([{ kind: 'turnedOn', at: '2026-09-30T00:00:00' }, RUN], NOW)).toBe(
      '2026-09-30T00:00:00',
    );
    expect(lastScheduleMark([], NOW)).toBeNull();
    expect(lastRunOf([RUN, failed, UNDO])).toBe(failed);
    expect(lastRunOf([UNDO])).toBeNull();
  });
});

describe('stillAsLeft', () => {
  it('compares values as they are, and absence with absence', () => {
    expect(stillAsLeft({ value: 'done' }, { value: 'done' })).toBe(true);
    expect(stillAsLeft({ value: 'done' }, { value: 'doing' })).toBe(false);
    expect(stillAsLeft({ value: 3 }, { value: '3' })).toBe(false);
    expect(stillAsLeft({ absent: true }, { absent: true })).toBe(true);
    expect(stillAsLeft({ absent: true }, { value: 'x' })).toBe(false);
    expect(stillAsLeft({ value: 'x' }, { absent: true })).toBe(false);
  });
});

describe('logPathFor', () => {
  it('names the log after the rule’s id, under log/', () => {
    expect(logPathFor('Tidy up')).toBe('.atlas/automations/log/Tidy up.md');
  });
});
