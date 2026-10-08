import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  dueTrigger,
  nextRunOf,
  NOTE_RUNS_PER_HOUR,
  noteRunsCapped,
  noteRunsCappedProblem,
} from './automation-due.ts';
import type { AutomationRule } from './automation-rule.ts';
import type { LogEntry } from './run-log.ts';

const RULE: AutomationRule = {
  id: 'Tidy',
  path: createVaultPath('.atlas/automations/Tidy.md'),
  name: 'Tidy',
  enabled: true,
  when: { kind: 'daily', at: '03:00' },
  which: 'FROM task',
  olderThanDays: null,
  action: { kind: 'archive' },
};

const ranAt = (at: string): LogEntry => ({
  kind: 'run',
  at,
  trigger: 'schedule',
  done: [],
  left: [],
  capped: false,
});

const WATCHING = '2026-09-27T09:00:00';

describe('dueTrigger', () => {
  it('runs a scheduled rule once its time has come since its last run', () => {
    const log = [ranAt('2026-09-27T03:00:00')];
    const at = (now: string) =>
      dueTrigger({ rule: RULE, log, now, watchingSince: WATCHING, opening: false });
    expect(at('2026-09-28T02:59:00')).toBeNull();
    expect(at('2026-09-28T03:00:00')).toBe('schedule');
  });

  it('catches up a missed run when the vault opens, then not again', () => {
    const missed = [ranAt('2026-09-20T03:00:00')];
    const opened = '2026-09-27T09:00:00';
    expect(
      dueTrigger({ rule: RULE, log: missed, now: opened, watchingSince: opened, opening: true }),
    ).toBe('schedule');
    const caughtUp = [...missed, ranAt(opened)];
    expect(
      dueTrigger({
        rule: RULE,
        log: caughtUp,
        now: '2026-09-27T09:05:00',
        watchingSince: opened,
        opening: false,
      }),
    ).toBeNull();
  });

  it('counts a rule never run from when it was turned on, or else from when Atlas began watching', () => {
    const turnedOn: LogEntry[] = [{ kind: 'turnedOn', at: '2026-09-26T14:00:00' }];
    const now = '2026-09-27T09:00:00';
    expect(dueTrigger({ rule: RULE, log: turnedOn, now, watchingSince: now, opening: true })).toBe(
      'schedule',
    );
    expect(dueTrigger({ rule: RULE, log: [], now, watchingSince: now, opening: true })).toBeNull();
  });

  it('runs an on-opening rule only on opening', () => {
    const rule = { ...RULE, when: { kind: 'open' } } as AutomationRule;
    const clock = { rule, log: [], now: '2026-09-27T12:00:00', watchingSince: WATCHING };
    expect(dueTrigger({ ...clock, opening: true })).toBe('open');
    expect(dueTrigger({ ...clock, opening: false })).toBeNull();
  });

  it('never runs a rule that is off, or one run by hand', () => {
    const long = { log: [], now: '2027-01-01T00:00:00', watchingSince: '2026-01-01T00:00:00' };
    expect(dueTrigger({ rule: { ...RULE, enabled: false }, ...long, opening: true })).toBeNull();
    const manual = { ...RULE, when: { kind: 'manual' } } as AutomationRule;
    expect(dueTrigger({ rule: manual, ...long, opening: true })).toBeNull();
  });
});

describe('a rule a note sets off', () => {
  const NOTE_RULE: AutomationRule = {
    ...RULE,
    when: { kind: 'note', type: 'meeting', on: ['created'] },
    which: 'FROM meeting',
  };
  const NOW = '2026-10-08T12:00:00';
  const noteRun = (at: string, kind: 'run' | 'failed' = 'run'): LogEntry =>
    kind === 'run'
      ? { kind, at, trigger: 'note', done: [], left: [], capped: false }
      : { kind, at, trigger: 'note', problem: 'No.' };

  it('is never run by the clock, on opening or after any time, and has no next run', () => {
    const long = { log: [], now: '2027-01-01T00:00:00', watchingSince: '2026-01-01T00:00:00' };
    expect(dueTrigger({ rule: NOTE_RULE, ...long, opening: true })).toBeNull();
    expect(dueTrigger({ rule: NOTE_RULE, ...long, opening: false })).toBeNull();
    expect(nextRunOf({ rule: NOTE_RULE, ...long })).toBeNull();
  });

  it('is held once it has run as often in the last hour as one may', () => {
    const recent = Array.from({ length: NOTE_RUNS_PER_HOUR }, (_, at) =>
      noteRun(`2026-10-08T11:${String(10 + at).padStart(2, '0')}:00`),
    );
    expect(noteRunsCapped(recent, NOW)).toBe(true);
    expect(noteRunsCapped(recent.slice(1), NOW)).toBe(false);
  });

  it('counts runs whose query did not read, so a broken rule is held too', () => {
    const failing = Array.from({ length: NOTE_RUNS_PER_HOUR }, () =>
      noteRun('2026-10-08T11:30:00', 'failed'),
    );
    expect(noteRunsCapped(failing, NOW)).toBe(true);
  });

  it('counts only note runs inside the hour, not other runs, nor ones an hour old or ahead', () => {
    const outside = [
      ...Array.from({ length: NOTE_RUNS_PER_HOUR }, () => noteRun('2026-10-08T11:00:00')),
      ...Array.from({ length: NOTE_RUNS_PER_HOUR }, () => noteRun('2026-10-08T12:00:01')),
      ...Array.from({ length: NOTE_RUNS_PER_HOUR }, () => ranAt('2026-10-08T11:30:00')),
    ];
    expect(noteRunsCapped(outside, NOW)).toBe(false);
    expect(noteRunsCapped([...outside, noteRun('2026-10-08T11:00:01')], NOW)).toBe(false);
    const justInside = Array.from({ length: NOTE_RUNS_PER_HOUR }, () =>
      noteRun('2026-10-08T11:00:01'),
    );
    expect(noteRunsCapped(justInside, NOW)).toBe(true);
  });

  it('says why it is held, and what waits', () => {
    expect(noteRunsCappedProblem()).toBe(
      `It has run ${NOTE_RUNS_PER_HOUR} times in the last hour, the most a rule may. ` +
        'Notes that change meanwhile wait for a run by hand.',
    );
  });
});

describe('nextRunOf', () => {
  it('is the next time after the last run, and none for a rule that is off', () => {
    const log = [ranAt('2026-09-27T03:00:00')];
    expect(
      nextRunOf({ rule: RULE, log, watchingSince: WATCHING, now: '2026-09-27T12:00:00' }),
    ).toBe('2026-09-28T03:00:00');
    expect(
      nextRunOf({
        rule: { ...RULE, enabled: false },
        log,
        watchingSince: WATCHING,
        now: '2026-09-27T12:00:00',
      }),
    ).toBeNull();
  });
});
