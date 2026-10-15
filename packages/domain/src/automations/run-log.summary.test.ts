import { describe, expect, it } from 'vitest';
import { automationEntryReport } from '../activity/activity-reports.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import type { ClaudeAction } from './claude-step.ts';
import {
  formatLogEntry,
  lastUndoableRun,
  logEntrySummary,
  newLogText,
  parseRunLog,
  type LogEntry,
} from './run-log.ts';
import { loggedActionProblem } from './undo-check.ts';

/**
 * #185: what the declared step's run leaves on record when it writes a
 * meeting's summary — in its rule's log and in Activity — and what of it
 * undo may take back: the summary block, and the tasks it made while they
 * are unchanged.
 */

const MEETING = createVaultPath('Meetings/2026-10/2026-10-14 Platform weekly sync.md');
const TASK = createVaultPath('Tasks/Write the rollout note.md');
const PROPOSAL = createVaultPath('Inbox/Proposals/Flag the new cache.md');

const RAN: LogEntry = {
  kind: 'run',
  at: '2026-10-14T09:00:00',
  trigger: 'note',
  done: [
    { kind: 'created', path: TASK, digest: 'a1b2c3d4' },
    { kind: 'proposed', path: PROPOSAL },
    { kind: 'summarised', path: MEETING, digest: '0f0e0d0c' },
  ],
  left: [],
  capped: false,
  claude: {
    model: 'claude-sonnet-5-5',
    ms: 41_200,
    asks: 1,
    meetings: [{ path: MEETING, tasks: 1, proposals: 1, listed: 3, summary: 'written' }],
  },
};

const DECLARED: ClaudeAction = {
  kind: 'claude',
  prompt: '.atlas/prompts/after-a-meeting.md',
  tools: [],
  output: { kind: 'proposals', schema: 'meeting-digest' },
  apply: 'mine',
};

describe('a run that wrote a meeting’s summary, in its log', () => {
  it('says what it wrote, by whom and how long it took, then what it made', () => {
    expect(logEntrySummary(RAN)).toBe(
      'Summary written by claude-sonnet-5-5 in 41 s for 2026-10-14 Platform weekly sync; 1 task made, 3 items listed, 1 proposal.',
    );
  });

  it('says when it left a summary as the person has it, or had none that read', () => {
    const kept = (summary: 'kept' | 'dropped'): LogEntry => ({
      ...RAN,
      done: [],
      claude: { ...RAN.claude!, meetings: [{ ...RAN.claude!.meetings![0]!, summary, tasks: 0 }] },
    });
    expect(logEntrySummary(kept('kept'))).toBe(
      'Summary of 2026-10-14 Platform weekly sync left as you have it; 0 tasks made, 3 items listed, 1 proposal.',
    );
    expect(logEntrySummary(kept('dropped'))).toMatch(
      /^No summary for 2026-10-14 Platform weekly sync: Claude’s did not read; /,
    );
  });

  it('writes its lines and reads them back as they were', () => {
    const text = newLogText('After a meeting', [RAN]);
    expect(text).toContain(`- created \`"${TASK}"\` at \`"a1b2c3d4"\``);
    expect(text).toContain(`- summarised \`"${MEETING}"\` at \`"0f0e0d0c"\``);
    expect(text).toContain(
      `- meeting \`"${MEETING}"\`: tasks \`1\`, proposals \`1\`, listed \`3\`, summary \`"written"\``,
    );
    expect(parseRunLog(text)).toEqual([RAN]);
  });

  it('reads an older meeting line, with no summary, as it always has', () => {
    const older: LogEntry = {
      ...RAN,
      done: [{ kind: 'created', path: TASK }],
      claude: {
        model: 'claude-sonnet-5-5',
        ms: 1000,
        meetings: [{ path: MEETING, tasks: 1, proposals: 0 }],
      },
    };
    expect(parseRunLog(newLogText('After a meeting', [older]))).toEqual([older]);
    expect(logEntrySummary(older)).toBe(
      'Made 1 task from 2026-10-14 Platform weekly sync, 0 proposals.',
    );
  });

  it('leaves out a line edited into something it never writes', () => {
    const text = newLogText('After a meeting', [RAN])
      .replace('summary `"written"`', 'summary `"rewritten"`')
      .replace('at `"0f0e0d0c"`', 'at `0`');
    const [entry] = parseRunLog(text);
    expect(entry?.kind === 'run' && entry.done.map((action) => action.kind)).toEqual([
      'created',
      'proposed',
    ]);
    expect(entry?.kind === 'run' && entry.claude?.meetings).toEqual([
      { path: MEETING, tasks: 1, proposals: 1 },
    ]);
  });

  it('says it in Activity too', () => {
    const report = automationEntryReport(
      { name: 'After a meeting', path: createVaultPath('.atlas/automations/A.md') },
      RAN,
    );
    expect(JSON.stringify(report)).toContain('Summary written by claude-sonnet-5-5 in 41 s');
  });
});

describe('undo of the declared step’s run', () => {
  it('is the run undo takes back: it wrote a summary', () => {
    expect(lastUndoableRun([RAN])).toBe(RAN);
    const proposedOnly: LogEntry = { ...RAN, done: [{ kind: 'proposed', path: PROPOSAL }] };
    expect(lastUndoableRun([proposedOnly])).toBeNull();
  });

  it('trusts the summary and the tasks it made, by the declared rule only', () => {
    const [task, proposal, summary] = (RAN as Extract<LogEntry, { kind: 'run' }>).done;
    expect(loggedActionProblem(DECLARED, summary!)).toBeNull();
    expect(loggedActionProblem(DECLARED, task!)).toBeNull();
    expect(loggedActionProblem(DECLARED, proposal!)).toMatch(/answered in the Inbox/);
    const { apply: _declared, ...proposalsOnly } = DECLARED;
    expect(_declared).toBe('mine');
    expect(loggedActionProblem(proposalsOnly, summary!)).toMatch(/Only the rule that makes/);
    expect(loggedActionProblem(proposalsOnly, task!)).toMatch(/answered in the Inbox/);
    // A task logged with no digest cannot be told unchanged: undo leaves it.
    expect(loggedActionProblem(DECLARED, { kind: 'created', path: TASK })).toMatch(
      /answered in the Inbox/,
    );
    expect(
      loggedActionProblem(DECLARED, {
        kind: 'summarised',
        path: createVaultPath('.atlas/settings.md'),
        digest: 'x',
      }),
    ).toMatch(/Atlas keeps its own files/);
    expect(
      loggedActionProblem(DECLARED, {
        kind: 'created',
        path: createVaultPath('.atlas/x.md'),
        digest: 'x',
      }),
    ).toMatch(/Atlas keeps its own files/);
  });

  it('writes what undo did, and reads it back', () => {
    const undo: LogEntry = {
      kind: 'undo',
      at: '2026-10-14T10:00:00',
      of: RAN.at,
      done: [
        { kind: 'trashed', path: TASK },
        { kind: 'unsummarised', path: MEETING },
      ],
      left: [],
    };
    expect(formatLogEntry(undo)).toContain('Trashed 1 note. Took the summary off 1 meeting.');
    expect(parseRunLog(newLogText('After a meeting', [RAN, undo]))).toEqual([RAN, undo]);
    expect(lastUndoableRun([RAN, undo])).toBeNull();
  });
});
