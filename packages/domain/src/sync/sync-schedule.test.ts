import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PULL_INTERVAL_MINUTES,
  DEFAULT_PUSH_DELAY_SECONDS,
  dueSync,
  firstUnsyncedAfterEdit,
  MAX_UNSYNCED_MS,
  pullIntervalMinutes,
  pushDelaySeconds,
  syncAfterLook,
  type SyncTiming,
} from './sync-schedule.ts';
import { syncActivityMessage, syncBadge, type SyncReport } from './sync-state.ts';

/** A fixed clock: seconds past a fixed instant. */
const T0 = Date.UTC(2026, 8, 28, 9, 0, 0);
const at = (seconds: number) => T0 + seconds * 1_000;

/** A vault synced at T0, unchanged since, on defaults: push 30 s after a change, look every minute. */
const timing = (overrides: Partial<SyncTiming> = {}): SyncTiming => ({
  now: at(0),
  paused: false,
  lastSyncAt: at(0),
  lastCheckAt: at(0),
  lastEditAt: null,
  firstUnsyncedEditAt: null,
  pushDelaySeconds: 30,
  pullIntervalMinutes: 1,
  ...overrides,
});

describe('dueSync: sending changes as you work', () => {
  it('sends a change once the vault has been quiet for the push delay, not before', () => {
    const edited = { lastEditAt: at(10), firstUnsyncedEditAt: at(10) };
    expect(dueSync(timing({ ...edited, now: at(39) }))).toBeNull();
    expect(dueSync(timing({ ...edited, now: at(40) }))).toBe('push');
  });

  it('follows the push delay the person set', () => {
    const edited = {
      lastEditAt: at(10),
      firstUnsyncedEditAt: at(10),
      pushDelaySeconds: 120,
      pullIntervalMinutes: 60,
    };
    expect(dueSync(timing({ ...edited, now: at(129) }))).toBeNull();
    expect(dueSync(timing({ ...edited, now: at(130) }))).toBe('push');
  });

  it('sends at least every five minutes while changes keep coming', () => {
    // Typing never stops for 30 s, so the quiet time never passes.
    const typing = (now: number) =>
      dueSync(
        timing({
          now,
          lastEditAt: now - 1_000,
          firstUnsyncedEditAt: at(10),
          pullIntervalMinutes: 60,
        }),
      );
    expect(typing(at(10) + MAX_UNSYNCED_MS - 1)).toBeNull();
    expect(typing(at(10) + MAX_UNSYNCED_MS)).toBe('push');
  });

  it('sends nothing for an edit a sync already took', () => {
    expect(
      dueSync(
        timing({
          now: at(50),
          lastSyncAt: at(20),
          lastEditAt: at(10),
          firstUnsyncedEditAt: at(10),
        }),
      ),
    ).toBeNull();
  });

  it('sends an edit made while a sync ran, in turn', () => {
    expect(
      dueSync(
        timing({
          now: at(60),
          lastSyncAt: at(20),
          lastEditAt: at(20),
          firstUnsyncedEditAt: at(20),
        }),
      ),
    ).toBe('push');
  });

  it('sends at once when the clock was set back past the last edit', () => {
    expect(dueSync(timing({ now: at(5), lastEditAt: at(10), firstUnsyncedEditAt: at(10) }))).toBe(
      'push',
    );
  });

  it('counts from the last edit when the first one is not known', () => {
    expect(dueSync(timing({ now: at(40), lastEditAt: at(10), firstUnsyncedEditAt: null }))).toBe(
      'push',
    );
  });
});

describe('dueSync: looking for other Macs’ changes', () => {
  it('looks at GitHub once the pull interval has passed since the last look', () => {
    expect(dueSync(timing({ now: at(59) }))).toBeNull();
    expect(dueSync(timing({ now: at(60) }))).toBe('check');
  });

  it('counts a sync as a look', () => {
    expect(dueSync(timing({ now: at(90), lastSyncAt: at(50), lastCheckAt: at(0) }))).toBeNull();
  });

  it('follows the pull interval the person set', () => {
    expect(dueSync(timing({ now: at(299), pullIntervalMinutes: 5 }))).toBeNull();
    expect(dueSync(timing({ now: at(300), pullIntervalMinutes: 5 }))).toBe('check');
  });

  it('looks at once when nothing has been looked at this session, or the clock was set back', () => {
    expect(dueSync(timing({ lastSyncAt: null, lastCheckAt: null }))).toBe('check');
    expect(dueSync(timing({ now: at(0), lastCheckAt: at(30), lastSyncAt: at(30) }))).toBe('check');
  });

  it('sends before it looks: a sync looks too', () => {
    expect(dueSync(timing({ now: at(120), lastEditAt: at(10), firstUnsyncedEditAt: at(10) }))).toBe(
      'push',
    );
  });
});

describe('dueSync: paused', () => {
  it('runs nothing by itself while sync is paused on this Mac', () => {
    const due = timing({
      now: at(600),
      paused: true,
      lastEditAt: at(10),
      firstUnsyncedEditAt: at(10),
    });
    expect(dueSync(due)).toBeNull();
    expect(dueSync({ ...due, paused: false })).toBe('push');
  });
});

describe('firstUnsyncedAfterEdit', () => {
  it('starts the wait at the first change after a sync', () => {
    expect(
      firstUnsyncedAfterEdit({ now: at(40), firstUnsyncedEditAt: null, lastSyncAt: at(0) }),
    ).toBe(at(40));
    expect(
      firstUnsyncedAfterEdit({ now: at(40), firstUnsyncedEditAt: at(-10), lastSyncAt: at(0) }),
    ).toBe(at(40));
  });

  it('keeps it while changes keep coming', () => {
    expect(
      firstUnsyncedAfterEdit({ now: at(90), firstUnsyncedEditAt: at(40), lastSyncAt: at(0) }),
    ).toBe(at(40));
    expect(
      firstUnsyncedAfterEdit({ now: at(90), firstUnsyncedEditAt: at(40), lastSyncAt: null }),
    ).toBe(at(40));
  });
});

describe('the intervals a setting asks for', () => {
  it.each([
    [undefined, DEFAULT_PULL_INTERVAL_MINUTES],
    ['often', DEFAULT_PULL_INTERVAL_MINUTES],
    [2.5, DEFAULT_PULL_INTERVAL_MINUTES],
    [5, 5],
    ['15', 15],
    [0, 1],
    [1_000, 120],
  ])('reads a pull interval of %j as %d minutes', (value, minutes) => {
    expect(pullIntervalMinutes(value)).toBe(minutes);
  });

  it.each([
    [undefined, DEFAULT_PUSH_DELAY_SECONDS],
    ['soon', DEFAULT_PUSH_DELAY_SECONDS],
    [60, 60],
    ['120', 120],
    [1, 5],
    [100_000, 600],
  ])('reads a push delay of %j as %d seconds', (value, seconds) => {
    expect(pushDelaySeconds(value)).toBe(seconds);
  });
});

const report = (overrides: Partial<SyncReport> = {}): SyncReport => ({
  at: T0,
  committed: false,
  pulled: false,
  pushed: false,
  conflicts: [],
  notSynced: [],
  ignored: [],
  ...overrides,
});

describe('syncBadge: the sidebar light', () => {
  const quietly = { paused: false, behind: 0 };

  it('shows nothing for a vault that does not sync', () => {
    expect(syncBadge({ kind: 'not-set-up' })).toBeNull();
    expect(syncBadge({ kind: 'unknown' })).toBeNull();
    expect(syncBadge({ kind: 'refused', reason: 'x' })).toBeNull();
  });

  it('shows synced, syncing, failed and not synced yet', () => {
    expect(syncBadge({ kind: 'syncing' }, quietly)).toEqual({ tone: 'busy', label: 'Syncing…' });
    expect(syncBadge({ kind: 'ready' }, quietly)).toEqual({
      tone: 'quiet',
      label: 'Not synced yet',
    });
    expect(syncBadge({ kind: 'failed', reason: 'x', at: T0 }, quietly)).toEqual({
      tone: 'error',
      label: 'Sync failed',
    });
    expect(syncBadge({ kind: 'synced', report: report() }, quietly)).toEqual({
      tone: 'ok',
      label: 'Synced',
    });
  });

  it('shows behind when GitHub has other Macs’ changes not brought in yet', () => {
    expect(syncBadge({ kind: 'synced', report: report() }, { paused: false, behind: 1 })).toEqual({
      tone: 'behind',
      label: '1 change to bring in',
    });
    expect(syncBadge({ kind: 'ready' }, { paused: false, behind: 3 })?.label).toBe(
      '3 changes to bring in',
    );
  });

  it('shows paused over everything but a sync under way: the last failure is old news', () => {
    const paused = { paused: true, behind: 2 };
    expect(syncBadge({ kind: 'synced', report: report() }, paused)).toEqual({
      tone: 'paused',
      label: 'Sync paused',
    });
    expect(syncBadge({ kind: 'syncing' }, paused)?.tone).toBe('busy');
    expect(syncBadge({ kind: 'failed', reason: 'x', at: T0 }, paused)?.label).toBe('Sync paused');
    expect(
      syncBadge({ kind: 'failed', reason: 'x', at: T0 }, { paused: false, behind: 2 })?.tone,
    ).toBe('error');
  });

  it('warns about conflicts, counted', () => {
    const one = [{ path: 'a.md', copy: 'a (conflict from X).md', whose: 'theirs' as const }];
    expect(syncBadge({ kind: 'synced', report: report({ conflicts: one }) }, quietly)).toEqual({
      tone: 'warning',
      label: '1 conflict',
    });
    expect(
      syncBadge({ kind: 'synced', report: report({ conflicts: [...one, ...one] }) }, quietly)
        ?.label,
    ).toBe('2 conflicts');
  });
});

describe('syncActivityMessage', () => {
  it('says what a sync did', () => {
    expect(syncActivityMessage(report())).toBe('Synced: nothing had changed.');
    expect(syncActivityMessage(report({ committed: true, pulled: true, pushed: true }))).toBe(
      'Synced: saved this Mac’s changes, brought in changes from other Macs, sent them to GitHub.',
    );
  });

  it('warns when both Macs changed files', () => {
    const conflicts = [
      { path: 'a.md', copy: 'a (conflict from X).md', whose: 'theirs' as const },
      { path: 'b.md', copy: 'b (conflict from X).md', whose: 'theirs' as const },
    ];
    expect(syncActivityMessage(report({ conflicts }))).toContain('Both Macs changed 2 files');
    expect(syncActivityMessage(report({ conflicts: conflicts.slice(1) }))).toContain(
      'Both Macs changed a file',
    );
  });
});

describe('syncAfterLook', () => {
  const none = { behind: 0, ahead: 0 };

  it('brings other Macs’ changes in at once when this Mac has none waiting', () => {
    expect(syncAfterLook({ ...none, behind: 2, lastSyncAt: at(0), lastEditAt: null })).toBe(true);
    expect(syncAfterLook({ ...none, behind: 1, lastSyncAt: at(30), lastEditAt: at(10) })).toBe(
      true,
    );
  });

  it('sends at once what a sync could not push, with no new edit (review A29-01)', () => {
    expect(syncAfterLook({ ...none, ahead: 1, lastSyncAt: at(0), lastEditAt: null })).toBe(true);
  });

  it('waits for this Mac’s typing to be sent, which does all of it', () => {
    expect(syncAfterLook({ behind: 1, ahead: 1, lastSyncAt: at(0), lastEditAt: at(10) })).toBe(
      false,
    );
    expect(syncAfterLook({ ...none, behind: 1, lastSyncAt: null, lastEditAt: at(10) })).toBe(false);
  });

  it('does nothing when there is nothing to send or bring in', () => {
    expect(syncAfterLook({ ...none, lastSyncAt: at(0), lastEditAt: null })).toBe(false);
  });
});
