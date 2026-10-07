/**
 * Adversarial pass on Phase 25's domain (P25-01/02): rule files as a sync tool
 * or a hand edit leaves them, logs whose clock went wrong, and values typed
 * into the editor. Each test names the one invariant it holds the code to.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { dueTrigger } from './automation-due.ts';
import { parseAutomationRule, setValueFromInput, type AutomationRule } from './automation-rule.ts';
import { lastUndoableRun, type LogEntry } from './run-log.ts';

const PATH = createVaultPath('.atlas/automations/Tidy.md');

const FILE = {
  atlas: 'automation',
  name: 'Tidy',
  enabled: true,
  when: 'daily at 03:00',
  which: 'FROM task WHERE status = done',
  do: 'archive',
};

const RULE: AutomationRule = {
  id: 'Tidy',
  path: PATH,
  name: 'Tidy',
  enabled: true,
  when: { kind: 'daily', at: '03:00' },
  which: 'FROM task',
  olderThanDays: null,
  action: { kind: 'archive' },
};

describe('rule files as a sync tool writes them', () => {
  it.each(['true', 'yes', 1])(
    'never reads enabled: %j as a silent "off" — it is on, or the file is listed as broken',
    (enabled) => {
      const read = parseAutomationRule(PATH, { ...FILE, enabled });
      const silentlyOff = 'rule' in read && !read.rule.enabled;
      expect(silentlyOff).toBe(false);
    },
  );

  it('never accepts a set rule that, once read, sets nothing (a __proto__ key)', () => {
    const set = JSON.parse('{"__proto__": "done"}') as Record<string, unknown>;
    const read = parseAutomationRule(PATH, { ...FILE, do: 'set', set });
    const setsNothing =
      'rule' in read &&
      read.rule.action.kind === 'set' &&
      Object.keys(read.rule.action.values).length === 0;
    expect(setsNothing).toBe(false);
  });
});

describe('undo after the clock repeats a second', () => {
  it('keeps a new run undoable when an older, undone run has the same timestamp', () => {
    const at = '2026-09-27T03:00:00';
    const archived = (name: string) => ({
      kind: 'archived' as const,
      from: createVaultPath(`Tasks/${name}.md`),
      to: createVaultPath(`Archive/Tasks/${name}.md`),
    });
    const log: LogEntry[] = [
      { kind: 'run', at, trigger: 'hand', done: [archived('A')], left: [], capped: false },
      { kind: 'undo', at, of: at, done: [], left: [] },
      { kind: 'run', at, trigger: 'hand', done: [archived('B')], left: [], capped: false },
    ];
    expect(lastUndoableRun(log)?.done).toEqual([archived('B')]);
  });
});

describe('a schedule mark from a clock that ran ahead', () => {
  it('does not hold a daily rule back for a month once the clock is put right', () => {
    // The machine's clock was a month fast when it last ran; it has since been corrected.
    const log: LogEntry[] = [
      {
        kind: 'run',
        at: '2026-10-27T03:00:05',
        trigger: 'schedule',
        done: [],
        left: [],
        capped: false,
      },
    ];
    const trigger = dueTrigger({
      rule: RULE,
      log,
      now: '2026-09-29T03:00:30',
      watchingSince: '2026-09-29T02:00:00',
      opening: false,
    });
    expect(trigger).toBe('schedule');
  });
});

describe('values typed into the editor', () => {
  it.each(['02134', '007'])('keeps %j as the text typed, leading zeros and all', (typed) => {
    expect(String(setValueFromInput(typed))).toBe(typed);
  });
});
