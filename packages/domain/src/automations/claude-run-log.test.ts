import { describe, expect, it } from 'vitest';
import { automationEntryReport } from '../activity/activity-reports.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { parseAutomationRule } from './automation-rule.ts';
import {
  CLAUDE_STEP_QUESTION,
  CLAUDE_TOTAL_NOTE_CHARACTERS,
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
  it('says a note it read only the start of, in its lines and its summary, and reads it back', () => {
    const cut = [{ path: createVaultPath('Meetings/Standup.md'), shown: 19874, of: 48211 }];
    const partly: LogEntry = { ...RAN, claude: { ...RAN.claude!, cut } };
    const text = formatLogEntry(partly);

    expect(text).toContain('- cut `"Meetings/Standup.md"`: read `19874` of `48211` characters');
    expect(logEntrySummary(partly)).toBe(
      'Made 1 proposal. 1 note was too long to read whole: Claude saw only the start.',
    );
    expect(logEntrySummary(RAN)).toBe('Made 1 proposal.');
    const failed: LogEntry = { ...FAILED, claude: { ...FAILED.claude!, cut: [...cut, ...cut] } };
    expect(parseRunLog(newLogText('Meeting actions', [partly, RAN, failed]))).toEqual([
      partly,
      RAN,
      failed,
    ]);
    const two: LogEntry = { ...RAN, claude: { ...RAN.claude!, cut: [...cut, ...cut] } };
    expect(logEntrySummary(two)).toContain('2 notes were too long to read whole');
  });

  it('leaves out a cut line a person edited into something that does not read', () => {
    const text = newLogText('Meeting actions', [RAN]).replace(
      /(- claude .*)\n/,
      '$1\n- cut `"Meetings/Standup.md"`: read `"some"` of `48211` characters\n- cut `"../x.md"`: read `1` of `2` characters\n',
    );
    expect(parseRunLog(text)).toEqual([RAN]);
  });

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

describe('a Claude step cut off, or held to ten notes', () => {
  it('writes what a half-written run made under its failure, and reads both back', () => {
    const cut: LogEntry = {
      ...FAILED,
      problem: 'Made 1 of 3 notes, then the write failed: the disk is full',
      done: [{ kind: 'proposed', path: PROPOSAL }],
    };
    expect(formatLogEntry(cut)).toContain(
      '- proposed `"Inbox/Proposals/Send the payroll file.md"`',
    );
    expect(parseRunLog(newLogText('M', [cut]))).toEqual([cut]);
    expect(parseRunLog(newLogText('M', [FAILED]))[0]).not.toHaveProperty('done');
  });

  it('bounds the model’s words in a failure, in the log and in Activity', () => {
    const long: LogEntry = { ...FAILED, problem: `It named ${'x'.repeat(10_000)}` };
    expect(logEntrySummary(long).length).toBeLessThanOrEqual(600);
    expect(formatLogEntry(long).length).toBeLessThan(900);
    expect(automationEntryReport(RULE, long)?.message.length).toBeLessThan(900);
  });

  it('bounds a reason a note was left alone for', () => {
    const left = { path: createVaultPath('A.md'), reason: 'y'.repeat(10_000) };
    expect(formatLogEntry({ ...RAN, left: [left] }).length).toBeLessThan(1_500);
  });

  it('says a Claude run read only its first ten notes and the rest wait for a run by hand', () => {
    const capped: LogEntry = { ...RAN, capped: true };
    expect(logEntrySummary(capped)).toBe(
      'Made 1 proposal. Read the first 10 notes, the most one Claude run takes; run it by hand for the rest.',
    );
    expect(parseRunLog(newLogText('M', [capped]))[0]).toMatchObject({ capped: true });
    expect(parseRunLog(newLogText('M', [RAN]))[0]).toMatchObject({ capped: false });
  });

  it('keeps saying the rest wait for the next run for a rule that moves or sets', () => {
    const plain = Object.fromEntries(Object.entries(RAN).filter(([key]) => key !== 'claude'));
    const capped = { ...(plain as LogEntry), capped: true, done: [] } as LogEntry;
    expect(logEntrySummary(capped)).toContain('the rest wait for the next run');
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
  const system = (notes: { path: ReturnType<typeof createVaultPath>; text: string }[]) =>
    claudeStepSystem({ today: '2026-10-11', prompt: 'Find.', answer: 'Answer.', notes });

  it('fences each note as data in the system prompt, cutting a long one', () => {
    const long = 'x'.repeat(CLAUDE_NOTE_CHARACTERS + 5);
    const told = system([
      { path: createVaultPath('Meetings/A.md'), text: 'Short. ^b1' },
      { path: createVaultPath('Meetings/B.md'), text: long },
    ]);
    expect(told).toContain('<vault_data note="Meetings/A.md">\nShort. ^b1\n</vault_data>');
    expect(told).toContain('… (cut)');
    expect(told).not.toContain(long);
  });

  it('gives each note an equal share when all of them would not fit whole', () => {
    const text = 'y'.repeat(CLAUDE_NOTE_CHARACTERS);
    const notes = Array.from({ length: 10 }, (_, at) => ({
      path: createVaultPath(`Meetings/${at}.md`),
      text,
    }));
    const told = system(notes);
    expect(told.length).toBeLessThan(CLAUDE_TOTAL_NOTE_CHARACTERS + 5_000);
    expect(told.match(/… \(cut\)/g)).toHaveLength(10);
  });

  it('keeps the notes out of the question, which a provider may rewrite', () => {
    expect(CLAUDE_STEP_QUESTION).not.toContain('vault_data');
  });

  it('says it cannot change a note, and carries the rule’s prompt and the answer it needs', () => {
    const told = claudeStepSystem({
      today: '2026-10-11',
      prompt: '  Find the action items.  ',
      answer: 'Answer with JSON only.',
      notes: [],
    });
    expect(told).toContain('You cannot change any note');
    expect(told).toContain('<rule_prompt>\nFind the action items.\n</rule_prompt>');
    expect(told).toContain('Answer with JSON only.');
    expect(told).toContain('Today is 2026-10-11.');
  });
});
