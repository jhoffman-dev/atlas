import { describe, expect, it } from 'vitest';
import { automationEntryReport } from '../activity/activity-reports.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { parseAutomationRule } from './automation-rule.ts';
import {
  claudeStepQuestion,
  claudeStepSystem,
  CLAUDE_NOTE_CHARACTERS,
} from './claude-step-prompt.ts';
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
 * P29-03: what a Claude step's run leaves on record — in its rule's log and
 * in Activity: the notes it made, the model it asked and how long it took,
 * and why it failed. What it made is answered in the Inbox, never undone.
 */

const PROPOSAL = createVaultPath('Inbox/Proposals/Send the payroll file.md');
const BRIEF = createVaultPath('Briefs/Morning brief.md');
const RULE = { name: 'Meeting actions', path: createVaultPath('.atlas/automations/M.md') };

const RAN: LogEntry = {
  kind: 'run',
  at: '2026-10-11T09:00:00',
  trigger: 'note',
  done: [{ kind: 'proposed', path: PROPOSAL }],
  left: [],
  capped: false,
  versions: [{ path: createVaultPath('Meetings/Standup.md'), digest: 'abc', wrote: false }],
  claude: { model: 'claude-opus-5-5', ms: 4210 },
};
const FAILED: LogEntry = {
  kind: 'failed',
  at: '2026-10-11T09:05:00',
  trigger: 'hand',
  problem: 'Claude Code is installed but not logged in. Fix: claude auth login',
  claude: { model: 'claude-opus-5-5', ms: 120 },
};

describe('a Claude step in its rule’s log', () => {
  it('writes what it made and the model it asked, and reads them back', () => {
    const text = formatLogEntry(RAN);
    expect(text).toContain('- proposed `"Inbox/Proposals/Send the payroll file.md"`');
    expect(text).toContain('- claude `"claude-opus-5-5"` in `4210` ms');
    const created: LogEntry = { ...RAN, done: [{ kind: 'created', path: BRIEF }] };
    expect(parseRunLog(newLogText('Meeting actions', [RAN, FAILED, created]))).toEqual([
      RAN,
      FAILED,
      created,
    ]);
  });

  it('says how many proposals or notes it made, or that it proposed nothing', () => {
    expect(logEntrySummary(RAN)).toBe('Made 1 proposal.');
    const two = { ...RAN, done: [RAN.done[0]!, { kind: 'proposed' as const, path: BRIEF }] };
    expect(logEntrySummary(two)).toBe('Made 2 proposals.');
    expect(logEntrySummary({ ...RAN, done: [{ kind: 'created', path: BRIEF }] })).toBe(
      'Made 1 note.',
    );
    expect(logEntrySummary({ ...RAN, done: [] })).toBe('Claude proposed nothing.');
    const plain = Object.fromEntries(Object.entries(RAN).filter(([key]) => key !== 'claude'));
    expect(logEntrySummary({ ...(plain as LogEntry), done: [] } as LogEntry)).toBe(
      'Nothing to do.',
    );
  });

  it('leaves out a model line edited into something that does not read', () => {
    const text = newLogText('M', [RAN]).replace('`4210`', '`soon`');
    const [read] = parseRunLog(text);
    expect(read).not.toHaveProperty('claude');
    expect(read).toMatchObject({ done: RAN.done });
  });
});

describe('undoing a Claude step', () => {
  const action = (() => {
    const read = parseAutomationRule(RULE.path, {
      atlas: 'automation',
      name: 'M',
      when: 'manually',
      which: 'FROM meeting',
      do: 'claude',
      prompt: 'meeting-actions',
      output: 'proposals',
    });
    if ('broken' in read) throw new Error(read.broken.problem);
    return read.rule.action;
  })();

  it('is never offered: what it made is answered in the Inbox', () => {
    expect(lastUndoableRun([RAN])).toBeNull();
    const archived: LogEntry = {
      ...RAN,
      done: [
        { kind: 'archived', from: BRIEF, to: createVaultPath('Archive/Briefs/Morning brief.md') },
      ],
    };
    expect(lastUndoableRun([archived, RAN])).toBe(archived);
  });

  it('refuses each line a log could hold for it', () => {
    expect(loggedActionProblem(action, { kind: 'proposed', path: PROPOSAL })).toMatch(
      /answered in the Inbox/,
    );
    expect(loggedActionProblem({ kind: 'archive' }, { kind: 'created', path: BRIEF })).toMatch(
      /answered in the Inbox/,
    );
    expect(
      loggedActionProblem(action, {
        kind: 'set',
        path: BRIEF,
        key: 'status',
        before: { absent: true },
        after: { value: 'done' },
      }),
    ).toBe('This rule asks Claude; it never archived a note or set a property.');
  });
});

describe('a Claude step in Activity', () => {
  it('names the model, how long it took and what it made', () => {
    expect(automationEntryReport(RULE, RAN)).toMatchObject({
      level: 'info',
      message:
        'Meeting actions: Ran when a note appeared or changed (Standup). Made 1 proposal. Asked claude-opus-5-5, 4.2 s.',
    });
  });

  it('says why it failed, with the fix, as an error', () => {
    expect(automationEntryReport(RULE, FAILED)).toEqual({
      level: 'error',
      kind: 'automation',
      message:
        'Meeting actions: Ran by hand, and could not. Claude Code is installed but not logged in. Fix: claude auth login. Asked claude-opus-5-5, 0.1 s.',
      subject: { kind: 'rule', path: RULE.path },
    });
  });
});

describe('what a Claude step is told', () => {
  it('fences each note as data, cutting a long one', () => {
    const long = 'x'.repeat(CLAUDE_NOTE_CHARACTERS + 5);
    const question = claudeStepQuestion([
      { path: createVaultPath('Meetings/A.md'), text: 'Short. ^b1' },
      { path: createVaultPath('Meetings/B.md'), text: long },
    ]);
    expect(question).toContain('<vault_data note="Meetings/A.md">\nShort. ^b1\n</vault_data>');
    expect(question).toContain('… (cut)');
    expect(question).not.toContain(long);
  });

  it('says it cannot change a note, and carries the rule’s prompt and the answer it needs', () => {
    const system = claudeStepSystem({
      today: '2026-10-11',
      prompt: '  Find the action items.  ',
      answer: 'Answer with JSON only.',
    });
    expect(system).toContain('You cannot change any note');
    expect(system).toContain('<rule_prompt>\nFind the action items.\n</rule_prompt>');
    expect(system.endsWith('Answer with JSON only.')).toBe(true);
    expect(system).toContain('Today is 2026-10-11.');
  });
});
