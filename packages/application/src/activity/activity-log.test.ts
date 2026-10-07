import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_MAX_AGE_MS,
  ACTIVITY_MAX_BYTES,
  ACTIVITY_REPEAT_MS,
  ACTIVITY_TRIM_TO_BYTES,
  activityText,
  parseActivityLog,
  utf8Length,
  type ActivityReport,
} from '@atlas/domain';
import { createActivityLog } from './activity-log.ts';
import type { ActivityStore } from './ports.ts';

const START = Date.UTC(2026, 8, 28, 9);
const VAULT = '/Users/j/Vault';
const OTHER = '/Users/j/Other';

const report = (message: string, level: ActivityReport['level'] = 'info'): ActivityReport => ({
  level,
  kind: 'app',
  message,
  subject: null,
});

/** A store in memory that counts what it is asked to do, as the host's file would be. */
function memoryStore(files = new Map<string, string>()) {
  const calls = { append: 0, replace: 0, read: 0 };
  let failNext: string | null = null;
  const store: ActivityStore = {
    async append({ vault, text }) {
      calls.append += 1;
      if (failNext !== null) {
        const message = failNext;
        failNext = null;
        throw new Error(message);
      }
      const next = (files.get(vault) ?? '') + text;
      files.set(vault, next);
      return utf8Length(next);
    },
    async read({ vault }) {
      calls.read += 1;
      return files.get(vault) ?? '';
    },
    async replace({ vault, text }) {
      calls.replace += 1;
      files.set(vault, text);
    },
  };
  return { store, files, calls, failNextAppend: (message: string) => (failNext = message) };
}

function setUp(files?: Map<string, string>) {
  const memory = memoryStore(files);
  let now = START;
  let vault: string | null = VAULT;
  const scheduled: Array<() => void> = [];
  const errors: unknown[] = [];
  const log = createActivityLog({
    store: memory.store,
    clock: { now: () => now },
    vault: () => vault,
    schedule: (write) => void scheduled.push(write),
    onError: (cause) => void errors.push(cause),
  });
  return {
    ...memory,
    log,
    scheduled,
    errors,
    tick: (ms: number) => (now += ms),
    open: (next: string | null) => (vault = next),
    kept: (at = VAULT) => parseActivityLog(memory.files.get(at) ?? ''),
  };
}

describe('createActivityLog', () => {
  it('dates a line by its clock and keeps it for the open vault', async () => {
    const t = setUp();
    t.log.record(report('Ran'));
    await t.log.flush();
    expect(t.kept()).toEqual([
      { at: START, level: 'info', kind: 'app', message: 'Ran', subject: null },
    ]);
  });

  it('writes nothing until the scheduled write runs, then all of it in one append', async () => {
    const t = setUp();
    t.log.record(report('one'));
    t.tick(1);
    t.log.record(report('two'));
    expect(t.calls.append).toBe(0);
    // Recording asks for one write, however many lines wait for it.
    expect(t.scheduled).toHaveLength(1);
    t.scheduled[0]?.();
    await t.log.flush();
    expect(t.calls.append).toBe(1);
    expect(t.kept().map((event) => event.message)).toEqual(['one', 'two']);
  });

  it('schedules again once the last batch was taken', async () => {
    const t = setUp();
    t.log.record(report('one'));
    await t.log.flush();
    t.log.record(report('two'));
    expect(t.scheduled).toHaveLength(2);
  });

  it('makes a line safe before it is kept', async () => {
    const t = setUp();
    t.log.record(report('could not open /Users/j/Vault/.atlas/index.sqlite with token=abc123'));
    await t.log.flush();
    expect(t.files.get(VAULT)).not.toContain('/Users/j');
    expect(t.files.get(VAULT)).not.toContain('abc123');
  });

  it('leaves out the same line again within a minute, and keeps it after', async () => {
    const t = setUp();
    t.log.record(report('Could not save', 'error'));
    t.tick(ACTIVITY_REPEAT_MS - 1);
    t.log.record(report('Could not save', 'error'));
    t.tick(1);
    t.log.record(report('Could not save', 'error'));
    await t.log.flush();
    expect(t.kept().map((event) => event.at)).toEqual([START, START + ACTIVITY_REPEAT_MS]);
  });

  it('keeps a line for the vault it was recorded in, even written after a switch', async () => {
    const t = setUp();
    t.log.record(report('in the first'));
    t.open(OTHER);
    t.log.record(report('in the second'));
    await t.log.flush();
    expect(t.kept(VAULT).map((event) => event.message)).toEqual(['in the first']);
    expect(t.kept(OTHER).map((event) => event.message)).toEqual(['in the second']);
  });

  it('keeps nothing while no vault is open', async () => {
    const t = setUp();
    t.open(null);
    t.log.record(report('nowhere'));
    await t.log.flush();
    expect(t.calls.append).toBe(0);
    expect(t.scheduled).toHaveLength(0);
    await expect(t.log.read()).resolves.toEqual([]);
  });

  it('reads the open vault newest first, through the query', async () => {
    const t = setUp();
    t.log.record(report('old'));
    t.tick(1000);
    t.log.record(report('broke', 'error'));
    // Read writes what waits first, so nothing recorded is missing from it.
    expect((await t.log.read()).map((event) => event.message)).toEqual(['broke', 'old']);
    const errors = await t.log.read({ level: 'errors', kinds: [], text: '' });
    expect(errors.map((event) => event.message)).toEqual(['broke']);
  });

  it('tells its listeners once lines are kept', async () => {
    const t = setUp();
    let told = 0;
    const stop = t.log.subscribe(() => (told += 1));
    t.log.record(report('one'));
    await t.log.flush();
    expect(told).toBe(1);
    stop();
    t.log.record(report('two'));
    await t.log.flush();
    expect(told).toBe(1);
  });

  it('says so when its file cannot be written, and goes on', async () => {
    const t = setUp();
    t.failNextAppend('disk full');
    t.log.record(report('lost'));
    await t.log.flush();
    expect(t.errors).toEqual([new Error('disk full')]);
    t.log.record(report('kept'));
    await t.log.flush();
    expect(t.kept().map((event) => event.message)).toEqual(['kept']);
  });

  it('cuts the file back when an append leaves it over its bound, oldest first', async () => {
    const line = (at: number) => ({
      at: START - 100_000 + at,
      level: 'info' as const,
      kind: 'app' as const,
      message: 'x'.repeat(250),
      subject: null,
    });
    // Enough that the file is over its bound once the next line is added.
    const count = Math.ceil(ACTIVITY_MAX_BYTES / utf8Length(activityText([line(0)])));
    const lines = Array.from({ length: count }, (_, at) => line(at));
    const t = setUp(new Map([[VAULT, activityText(lines)]]));
    t.log.record(report('newest'));
    await t.log.flush();
    expect(t.calls.replace).toBe(1);
    const text = t.files.get(VAULT) ?? '';
    expect(utf8Length(text)).toBeLessThanOrEqual(ACTIVITY_TRIM_TO_BYTES);
    expect(t.kept().at(-1)?.message).toBe('newest');
    expect(t.kept()[0]?.at).toBeGreaterThan(lines[0]?.at ?? 0);
  });

  it('leaves a file under its bound alone', async () => {
    const t = setUp();
    t.log.record(report('one'));
    await t.log.flush();
    expect(t.calls.replace).toBe(0);
  });

  it('drops lines older than a month when it reads them', async () => {
    const old = {
      at: START - ACTIVITY_MAX_AGE_MS - 1,
      level: 'info',
      kind: 'app',
      message: 'old',
      subject: null,
    } as const;
    // Age is measured from the newest line (A28-01): dated now, so the clock is the reference.
    const fresh = { ...old, at: START, message: 'fresh' };
    const t = setUp(new Map([[VAULT, activityText([old, fresh])]]));
    expect((await t.log.read()).map((event) => event.message)).toEqual(['fresh']);
    expect(t.kept().map((event) => event.message)).toEqual(['fresh']);
    await t.log.read();
    // Nothing more had expired: the file is not written again.
    expect(t.calls.replace).toBe(1);
  });

  it('passes on a failed read', async () => {
    const t = setUp();
    t.store.read = () => Promise.reject(new Error('unreadable'));
    await expect(t.log.read()).rejects.toThrow('unreadable');
    // And the next write still goes ahead.
    t.log.record(report('after'));
    await t.log.flush();
    expect(t.calls.append).toBe(1);
  });
});

describe('createActivityLog, after review (A28-01)', () => {
  it('keeps what a recorder made for the open vault records there, whenever it records', async () => {
    const t = setUp();
    const inFirst = t.log.inOpenVault();
    t.open(OTHER);
    inFirst.record(report('finished late'));
    await t.log.flush();
    expect(t.kept(VAULT).map((event) => event.message)).toEqual(['finished late']);
    expect(t.kept(OTHER)).toEqual([]);
  });

  it('keeps what a recorder for a named vault records in that vault', async () => {
    const t = setUp();
    t.log.inVault(OTHER).record(report('about the other'));
    await t.log.flush();
    expect(t.kept(OTHER).map((event) => event.message)).toEqual(['about the other']);
    expect(t.kept(VAULT)).toEqual([]);
  });

  it('records nothing through a recorder made while no vault was open', async () => {
    const t = setUp();
    t.open(null);
    const nowhere = t.log.inOpenVault();
    t.open(VAULT);
    nowhere.record(report('nowhere'));
    await t.log.flush();
    expect(t.calls.append).toBe(0);
  });

  it('hands its listeners the lines just kept, by vault, without reading the file again', async () => {
    const t = setUp();
    const told: Array<{ vault: string; messages: string[] }> = [];
    t.log.subscribe(({ vault, events }) =>
      told.push({ vault, messages: events.map((event) => event.message) }),
    );
    t.log.record(report('one'));
    t.log.record(report('two'));
    t.log.inVault(OTHER).record(report('elsewhere'));
    await t.log.flush();
    expect(told).toEqual([
      { vault: VAULT, messages: ['one', 'two'] },
      { vault: OTHER, messages: ['elsewhere'] },
    ]);
    expect(t.calls.read).toBe(0);
  });

  it('does not tell its listeners of lines it could not keep', async () => {
    const t = setUp();
    let told = 0;
    t.log.subscribe(() => (told += 1));
    t.failNextAppend('disk full');
    t.log.record(report('lost'));
    await t.log.flush();
    expect(told).toBe(0);
  });

  it('says so when a listener throws, and still tells the others', async () => {
    const t = setUp();
    const heard: string[] = [];
    t.log.subscribe(() => {
      throw new Error('listener broke');
    });
    t.log.subscribe(({ events }) => heard.push(...events.map((event) => event.message)));
    t.log.record(report('one'));
    await expect(t.log.flush()).resolves.toBeUndefined();
    expect(t.errors).toEqual([new Error('listener broke')]);
    expect(heard).toEqual(['one']);
  });

  it('leaves out a repeat of a line from before a burst of others', async () => {
    const t = setUp();
    t.log.record(report('first'));
    for (let n = 0; n < 1500; n += 1) t.log.record(report(`other ${n}`));
    t.log.record(report('first'));
    await t.log.flush();
    expect(t.kept().filter((event) => event.message === 'first')).toHaveLength(1);
    expect(t.kept()).toHaveLength(1501);
  });

  it('keeps a line again once its minute has passed, even after a burst', async () => {
    const t = setUp();
    t.log.record(report('first'));
    for (let n = 0; n < 1500; n += 1) t.log.record(report(`other ${n}`));
    t.tick(ACTIVITY_REPEAT_MS);
    for (let n = 0; n < 1500; n += 1) t.log.record(report(`later ${n}`));
    t.log.record(report('first'));
    await t.log.flush();
    expect(t.kept().filter((event) => event.message === 'first')).toHaveLength(2);
  });
});
