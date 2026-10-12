import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { AFTER_A_MEETING_PRESET } from './presets.ts';
import { noteRunsHeldUntil } from './automation-due.ts';
import { emptyLedger } from './handled-ledger.ts';
import { handledVersions } from './note-trigger.ts';
import {
  appendLogEntry,
  formatLogEntry,
  lastUndoableRun,
  logEntrySummary,
  parseRunLog,
  type LogEntry,
} from './run-log.ts';
import { loggedActionProblem } from './undo-check.ts';

const MEETING = createVaultPath('Inbox/Meetings/2026-10-06 Standup.md');
const PROPOSAL = createVaultPath('Inbox/Proposals/Send Mara the file.md');

const RAN: LogEntry = {
  kind: 'run',
  at: '2026-10-08T09:00:00',
  trigger: 'note',
  done: [
    { kind: 'corrected', path: MEETING, count: 2 },
    { kind: 'linked', path: MEETING, count: 3 },
    { kind: 'proposed', path: PROPOSAL },
  ],
  left: [],
  capped: false,
  versions: [{ path: MEETING, digest: '1a2b3c4d', wrote: false }],
  claude: { model: 'claude-opus-5-5', ms: 4210, asks: 2 },
  steps: {
    note: MEETING,
    records: [
      { step: 'correct-terms', outcome: 'done', said: 'Corrected 2 misheard spellings.' },
      {
        step: 'link-meeting',
        outcome: 'done',
        said: 'Linked Mara Quill; proposed 1 in the Inbox.',
      },
      {
        step: 'claude meeting-items',
        outcome: 'done',
        said: 'Asked Claude 1 time: made 1 proposal.',
      },
      {
        step: 'claude term-suggestions',
        outcome: 'nothing',
        said: 'Asked Claude 1 time: suggested no terms.',
      },
    ],
  },
};

const FAILED: LogEntry = {
  kind: 'failed',
  at: '2026-10-08T09:00:05',
  trigger: 'note',
  problem:
    'Step 3 of 4 stopped it. Ask Claude (meeting-extraction) for meeting-items failed: The model fell over. What the steps before it did stays.',
  done: [{ kind: 'corrected', path: MEETING, count: 2 }],
  claude: { model: 'claude-opus-5-5', ms: 120, asks: 1 },
  steps: {
    note: MEETING,
    records: [
      { step: 'correct-terms', outcome: 'done', said: 'Corrected 2 misheard spellings.' },
      {
        step: 'link-meeting',
        outcome: 'already',
        said: 'Already linked when it arrived; not linked again.',
      },
      {
        step: 'claude meeting-items',
        outcome: 'failed',
        said: 'Ask Claude (meeting-extraction) for meeting-items failed: The model fell over.',
      },
      {
        step: 'claude term-suggestions',
        outcome: 'skipped',
        said: 'Ask Claude (term-suggestions) for term-suggestions: not run, because an earlier step failed.',
      },
    ],
  },
};

describe('a log entry of a rule of several steps', () => {
  it('writes the note, each step with how it went, and what the steps changed', () => {
    expect(formatLogEntry(RAN)).toBe(
      [
        '## 2026-10-08 09:00:00 · Ran when a note appeared or changed',
        '',
        '2026-10-06 Standup: Corrected 2 misheard spellings. Linked Mara Quill; proposed 1 in the Inbox. Asked Claude 1 time: made 1 proposal. Asked Claude 1 time: suggested no terms.',
        '',
        '- corrected `"Inbox/Meetings/2026-10-06 Standup.md"` `2`',
        '- linked `"Inbox/Meetings/2026-10-06 Standup.md"` `3`',
        '- proposed `"Inbox/Proposals/Send Mara the file.md"`',
        '- triggered by `"Inbox/Meetings/2026-10-06 Standup.md"` at `"1a2b3c4d"`',
        '- claude `"claude-opus-5-5"` in `4210` ms',
        '- asked `2` times',
        '- on `"Inbox/Meetings/2026-10-06 Standup.md"`',
        '- step `"correct-terms"` `"done"`: Corrected 2 misheard spellings.',
        '- step `"link-meeting"` `"done"`: Linked Mara Quill; proposed 1 in the Inbox.',
        '- step `"claude meeting-items"` `"done"`: Asked Claude 1 time: made 1 proposal.',
        '- step `"claude term-suggestions"` `"nothing"`: Asked Claude 1 time: suggested no terms.',
        '',
      ].join('\n'),
    );
  });

  it('reads back exactly as it was written, a run and one that could not finish', () => {
    const now = Date.parse('2026-10-08T09:00:00Z');
    const first = appendLogEntry({ text: null, ruleName: 'After a meeting', entry: RAN, now });
    const text = appendLogEntry({ text: first, ruleName: 'After a meeting', entry: FAILED, now });
    expect(parseRunLog(text)).toEqual([RAN, FAILED]);
  });

  it('keeps a step’s words on one line, however they were said', () => {
    const multiline: LogEntry = {
      ...RAN,
      steps: {
        note: MEETING,
        records: [
          { step: 'correct-terms', outcome: 'done', said: 'Corrected\n2 spellings.\n- step' },
        ],
      },
    };
    const [read] = parseRunLog(formatLogEntry(multiline));
    expect(read?.kind === 'run' && read.steps?.records).toEqual([
      { step: 'correct-terms', outcome: 'done', said: 'Corrected 2 spellings. - step' },
    ]);
  });

  it('leaves out a step line that does not read, and an entry with no note has no steps', () => {
    const edited = formatLogEntry(RAN)
      .replace('`"done"`: Corrected', '`"splendid"`: Corrected')
      .replace('- step `"link-meeting"`', '- step `link-meeting`');
    const [read] = parseRunLog(edited);
    expect(read?.kind === 'run' && read.steps?.records.map((record) => record.step)).toEqual([
      'claude meeting-items',
      'claude term-suggestions',
    ]);

    const noNote = formatLogEntry(RAN).replace(/^- on .*\n/m, '');
    const [bare] = parseRunLog(noNote);
    expect(bare?.kind === 'run' && bare.steps).toBeUndefined();
  });

  it('leaves out a count that is no whole number, as any line that does not read', () => {
    const edited = formatLogEntry(RAN).replace('.md"` `2`', '.md"` `"two"`');
    const [read] = parseRunLog(edited);
    expect(read?.kind === 'run' && read.done.map((action) => action.kind)).toEqual([
      'linked',
      'proposed',
    ]);
  });

  it('sums a failed run up by its problem, and keeps what the earlier steps did', () => {
    expect(logEntrySummary(FAILED)).toBe(FAILED.kind === 'failed' ? FAILED.problem : '');
    const [read] = parseRunLog(formatLogEntry(FAILED));
    expect(read).toEqual(FAILED);
  });

  it('says a run stopped short, and reads that back', () => {
    const capped: LogEntry = { ...RAN, capped: true };
    expect(logEntrySummary(capped)).toContain(
      'The most one run may do; the rest wait for a run by hand.',
    );
    expect(parseRunLog(formatLogEntry(capped))[0]).toMatchObject({ capped: true });
    expect(parseRunLog(formatLogEntry(RAN))[0]).toMatchObject({ capped: false });
  });

  it('spends what both its Claude steps asked of the hour’s cap, a failed one too', () => {
    const many = Array.from({ length: 9 }, () => RAN);
    // Nine runs of two asks, and a failed one of one: nineteen of the twenty.
    expect(noteRunsHeldUntil([...many, FAILED], '2026-10-08T09:30:00')).toBeNull();
    expect(noteRunsHeldUntil([...many, RAN], '2026-10-08T09:30:00')).toBe('2026-10-08T10:00:00');
  });
});

describe('what "Undo last run" may undo of a rule of steps', () => {
  const action = AFTER_A_MEETING_PRESET.action;

  it('is the newest run that corrected or linked something, a failed one included', () => {
    expect(lastUndoableRun([RAN])).toEqual(RAN);
    expect(lastUndoableRun([RAN, FAILED])).toEqual(FAILED);
  });

  it('is not a run whose steps found everything done already, nor one that only proposed', () => {
    const already: LogEntry = {
      ...RAN,
      done: [{ kind: 'proposed', path: PROPOSAL }],
    };
    const nothing: LogEntry = {
      ...RAN,
      done: [
        { kind: 'corrected', path: MEETING, count: 0 },
        { kind: 'linked', path: MEETING, count: 0 },
      ],
    };
    expect(lastUndoableRun([already])).toBeNull();
    expect(lastUndoableRun([nothing])).toBeNull();
    expect(lastUndoableRun([RAN, already])).toEqual(RAN);
  });

  it('is undone once', () => {
    const undo: LogEntry = {
      kind: 'undo',
      at: '2026-10-08T09:05:00',
      of: RAN.at,
      done: [{ kind: 'uncorrected', path: MEETING, count: 2 }],
      left: [],
    };
    expect(lastUndoableRun([RAN, undo])).toBeNull();
  });

  it('believes a corrected or linked line only for a rule that has that step', () => {
    const corrected = { kind: 'corrected', path: MEETING, count: 2 } as const;
    const linked = { kind: 'linked', path: MEETING, count: 3 } as const;
    expect(loggedActionProblem(action, corrected)).toBeNull();
    expect(loggedActionProblem(action, linked)).toBeNull();
    const onlyLinks = { kind: 'steps', steps: [{ kind: 'link-meeting' }] } as const;
    expect(loggedActionProblem(onlyLinks, corrected)).toBe(
      'This rule has no correct-terms step; it never did that to a meeting.',
    );
    expect(loggedActionProblem({ kind: 'archive' }, linked)).toBe(
      'This rule has no link-meeting step; it never did that to a meeting.',
    );
    expect(
      loggedActionProblem(action, { ...corrected, path: createVaultPath('.atlas/settings.md') }),
    ).toBe('Atlas keeps its own files as they are.');
  });

  it('never undoes an archive or a set line a rule of steps could not have written, nor an undo’s own', () => {
    const archived = {
      kind: 'archived',
      from: createVaultPath('Tasks/A.md'),
      to: createVaultPath('Archive/Tasks/A.md'),
    } as const;
    const set = {
      kind: 'set',
      path: MEETING,
      key: 'status',
      before: { absent: true },
      after: { value: 'done' },
    } as const;
    const wanted = 'This rule runs steps on a meeting; it never archived a note or set a property.';
    expect(loggedActionProblem(action, archived)).toBe(wanted);
    expect(loggedActionProblem(action, set)).toBe(wanted);
    expect(
      loggedActionProblem(action, { kind: 'uncorrected', path: MEETING, count: 2 }),
    ).not.toBeNull();
    expect(loggedActionProblem(action, { kind: 'proposed', path: PROPOSAL })).toMatch(
      /answered in the Inbox/,
    );
  });

  it('sums an undo up by what it took back', () => {
    const undo: LogEntry = {
      kind: 'undo',
      at: '2026-10-08T09:05:00',
      of: RAN.at,
      done: [
        { kind: 'uncorrected', path: MEETING, count: 2 },
        { kind: 'unlinked', path: MEETING, count: 1 },
      ],
      left: [{ path: PROPOSAL, reason: 'It is answered in the Inbox.' }],
    };
    expect(logEntrySummary(undo)).toBe('Put back 2 spellings. Took back 1 link. Left 1 alone.');
    expect(parseRunLog(formatLogEntry(undo))).toEqual([undo]);
  });
});

describe('what a run of steps leaves handled', () => {
  const WROTE: LogEntry = {
    ...RAN,
    versions: [
      { path: MEETING, digest: 'before', wrote: false },
      { path: MEETING, digest: 'after', wrote: true, keys: ['meeting:gemini:g-1:body:9f8e'] },
    ],
  };

  it('counts the version its own step wrote as words Claude answered, wherever they turn up', () => {
    const filed = createVaultPath('Meetings/2026-10-06 Standup.md');
    const handled = handledVersions([WROTE], { ledger: null, holds: () => undefined });
    // The same words, filed out of the Inbox: answered, by the key the wrote version carried.
    expect(
      handled.has({ path: filed, digest: 'other', keys: ['meeting:gemini:g-1:body:9f8e'] }),
    ).toBe(true);
    expect(
      handled.has({ path: filed, digest: 'other', keys: ['meeting:gemini:g-1:body:0000'] }),
    ).toBe(false);
  });

  it('does not count a write as answered for a rule with no steps', () => {
    const { steps: _steps, ...plain } = WROTE as Extract<LogEntry, { kind: 'run' }>;
    void _steps;
    const filed = createVaultPath('Meetings/2026-10-06 Standup.md');
    const handled = handledVersions([plain], { ledger: null, holds: () => undefined });
    expect(
      handled.has({ path: filed, digest: 'other', keys: ['meeting:gemini:g-1:body:9f8e'] }),
    ).toBe(false);
    expect(emptyLedger().answered).toEqual([]);
  });
});
