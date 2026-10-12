import { describe, expect, it } from 'vitest';
import { automationEntryReport } from './activity-reports.ts';
import { MAX_ACTIVITY_DETAILS, MAX_ACTIVITY_MESSAGE, activityEvent } from './activity-event.ts';
import { activityLine, parseActivityLog } from './activity-file.ts';
import { EVERY_ACTIVITY, activityMatches, activityRepeatKey } from './activity-query.ts';
import type { LogEntry } from '../automations/run-log.ts';
import { createVaultPath } from '../vault/vault-path.ts';

const AT = Date.UTC(2026, 9, 8, 9, 0);
const MEETING = createVaultPath('Inbox/Meetings/2026-10-06 Standup.md');
const RULE = { name: 'After a meeting', path: createVaultPath('.atlas/automations/After a meeting.md') };

const line = (details?: readonly string[]) =>
  activityEvent({
    at: AT,
    level: 'info',
    kind: 'automation',
    message: 'After a meeting · Standup: ran its 4 steps.',
    subject: { kind: 'note', path: MEETING },
    ...(details !== undefined && { details }),
  });

/** P29-06: a line may sum up several steps, which the page shows under it when it is opened. */
describe('an Activity line with details', () => {
  it('keeps each detail in order, and has no such key when there are none', () => {
    expect(line(['1. Corrected 2 misheard spellings.', '2. Linked Mara Quill.']).details).toEqual([
      '1. Corrected 2 misheard spellings.',
      '2. Linked Mara Quill.',
    ]);
    expect('details' in line()).toBe(false);
    expect('details' in line([])).toBe(false);
    expect('details' in line(['  ', ''])).toBe(false);
  });

  it('holds every detail to what a message is held to: one line, no machine path, no longer than a line', () => {
    const [path, long, lines] = line([
      'Could not read /Users/someone/Vault/secret.md',
      'x'.repeat(MAX_ACTIVITY_MESSAGE + 50),
      'two\nlines',
    ]).details!;
    expect(path).not.toContain('/Users/someone');
    expect(long).toHaveLength(MAX_ACTIVITY_MESSAGE);
    expect(lines).toBe('two lines');
  });

  it('keeps at most twelve, the first ones', () => {
    const many = Array.from({ length: MAX_ACTIVITY_DETAILS + 5 }, (_, at) => `step ${at + 1}`);
    expect(line(many).details).toEqual(many.slice(0, MAX_ACTIVITY_DETAILS));
  });

  it('is written to the file and read back, and a line without any is written as it always was', () => {
    const detailed = line(['1. Corrected 2 misheard spellings.']);
    expect(parseActivityLog(activityLine(detailed))).toEqual([detailed]);
    expect(activityLine(line())).not.toContain('details');
    expect(parseActivityLog(activityLine(line()))).toEqual([line()]);
  });

  it('drops details that are not text when a file was edited by hand', () => {
    const edited = activityLine(line(['kept'])).replace('["kept"]', '["kept", 7, null, {"a":1}]');
    expect(parseActivityLog(edited)[0]?.details).toEqual(['kept']);
    const notAList = activityLine(line(['kept'])).replace('["kept"]', '"kept"');
    expect('details' in parseActivityLog(notAList)[0]!).toBe(false);
  });

  it('is found by words in its details, and is a different line when its details differ', () => {
    const detailed = line(['3. Asked Claude 1 time: made 4 proposals.']);
    expect(activityMatches(detailed, { ...EVERY_ACTIVITY, text: 'proposals claude' })).toBe(true);
    expect(activityMatches(line(), { ...EVERY_ACTIVITY, text: 'proposals' })).toBe(false);
    expect(activityRepeatKey(detailed)).not.toBe(activityRepeatKey(line(['3. Failed.'])));
    expect(activityRepeatKey(line(['a']))).toBe(activityRepeatKey(line(['a'])));
  });
});

const records = [
  { step: 'correct-terms', outcome: 'already', said: 'Already corrected when it arrived (2 misheard spellings); not corrected again.' },
  { step: 'link-meeting', outcome: 'done', said: 'Linked Mara Quill; proposed 1 in the Inbox.' },
  { step: 'claude meeting-items', outcome: 'done', said: 'Asked Claude 2 times: made 4 proposals (1 left out).' },
  { step: 'claude term-suggestions', outcome: 'done', said: 'Asked Claude 1 time: suggested 1 term.' },
] as const;

describe('one meeting’s run of a rule of several steps, in Activity', () => {
  const ran: LogEntry = {
    kind: 'run',
    at: '2026-10-08T09:00:00',
    trigger: 'note',
    done: [],
    left: [],
    capped: false,
    claude: { model: 'claude-opus-5-5', ms: 4200, asks: 3 },
    steps: { note: MEETING, records: [...records] },
  };

  it('is one line about the meeting that opens to each step in order', () => {
    expect(automationEntryReport(RULE, ran)).toEqual({
      level: 'info',
      kind: 'automation',
      message:
        'After a meeting · 2026-10-06 Standup: ran its 4 steps. Asked claude-opus-5-5, 4.2 s.',
      subject: { kind: 'note', path: MEETING },
      details: [
        '1. Already corrected when it arrived (2 misheard spellings); not corrected again.',
        '2. Linked Mara Quill; proposed 1 in the Inbox.',
        '3. Asked Claude 2 times: made 4 proposals (1 left out).',
        '4. Asked Claude 1 time: suggested 1 term.',
      ],
    });
  });

  it('is an error that says where it stopped and why, with the steps before and after still listed', () => {
    const failed: LogEntry = {
      kind: 'failed',
      at: '2026-10-08T09:00:00',
      trigger: 'note',
      problem: 'Step 3 of 4 stopped it.',
      steps: {
        note: MEETING,
        records: [
          records[0],
          records[1],
          { step: 'claude meeting-items', outcome: 'failed', said: 'Extraction failed: no answer.' },
          { step: 'claude term-suggestions', outcome: 'skipped', said: 'Not run.' },
        ],
      },
    };
    const report = automationEntryReport(RULE, failed);
    expect(report?.level).toBe('error');
    expect(report?.message).toBe(
      'After a meeting · 2026-10-06 Standup: stopped at step 3 of 4. Extraction failed: no answer.',
    );
    expect(report?.details).toHaveLength(4);
    expect(report?.details?.[3]).toBe('4. Not run.');
  });

  it('is a warning when the run left something alone', () => {
    const left: LogEntry = { ...ran, left: [{ path: MEETING, reason: 'It was busy.' }] };
    expect(automationEntryReport(RULE, left)?.level).toBe('warning');
  });

  it('leaves a run without steps as the one line it always was', () => {
    const plain: LogEntry = { kind: 'run', at: ran.at, trigger: 'schedule', done: [], left: [], capped: false };
    const report = automationEntryReport(RULE, plain);
    expect(report?.subject).toEqual({ kind: 'rule', path: RULE.path });
    expect(report !== null && 'details' in report).toBe(false);
  });
});
