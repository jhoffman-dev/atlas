import { describe, expect, it, vi } from 'vitest';
import { parseActivityLog, repeatsActivity, type ActivityReport } from '@atlas/domain';
import type * as Domain from '@atlas/domain';
import { memoryActivityStore } from '../testing/fake-activity.ts';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { syncIndex } from '../index/sync-index.ts';
import { createActivityLog } from './activity-log.ts';

/**
 * Adversarial (U-28): each line lands in the log of the vault it is about,
 * and leaving out a repeat never hides something that happened again.
 */

// Counted, not replaced: how often the log compares one line with another.
vi.mock('@atlas/domain', async (importOriginal) => {
  const domain = await importOriginal<typeof Domain>();
  return { ...domain, repeatsActivity: vi.fn(domain.repeatsActivity) };
});

const START = Date.UTC(2026, 8, 28, 9);
const VAULT_A = '/Users/j/Vault A';
const VAULT_B = '/Users/j/Vault B';

function setUp() {
  const files = memoryActivityStore();
  let now = START;
  let open: string | null = VAULT_A;
  const log = createActivityLog({
    store: files,
    clock: { now: () => now },
    vault: () => open,
    // Written only when the test flushes.
    schedule: () => undefined,
    onError: (cause) => {
      throw cause;
    },
  });
  const lines = (vault: string) => parseActivityLog(files.files.get(vault) ?? '');
  return {
    log,
    lines,
    switchTo: (vault: string | null) => (open = vault),
    tick: (ms: number) => (now += ms),
  };
}

describe('the Activity log, per vault', () => {
  it('keeps a rebuild started in one vault in that vault’s log, though another opened before it finished', async () => {
    const { log, lines, switchTo } = setUp();
    let finish: () => void = () => undefined;
    const slowStats = new Promise<void>((resolve) => (finish = resolve));
    const rebuilding = syncIndex({
      fs: fakeVaultFs(),
      markdown: fakeMarkdown(),
      fromScratch: true,
      activity: log,
      index: fakeIndexPort({
        stats: async () => {
          await slowStats;
          return { notes: 12, properties: 0, links: 0 };
        },
      }),
    });

    // The person opens vault B while A's index is still being rebuilt.
    await Promise.resolve();
    switchTo(VAULT_B);
    finish();
    await rebuilding;
    await log.flush();

    expect(lines(VAULT_A).map((event) => event.message)).toEqual(['Rebuilt the index: 12 notes.']);
    expect(lines(VAULT_B)).toEqual([]);
  });
});

describe('leaving out repeats', () => {
  const failed: ActivityReport = {
    level: 'error',
    kind: 'index',
    message: 'The index could not be brought up to date. disk I/O error',
    subject: null,
  };

  it('keeps a failure that happens again hours later, after the clock was set back', async () => {
    const { log, lines, tick } = setUp();
    log.record(failed);
    // The Mac's clock is corrected back three hours (it had been set ahead)...
    tick(-3 * 3_600_000);
    // ...and an hour of real time later the same failure happens again.
    tick(3_600_000);
    log.record(failed);
    await log.flush();
    expect(lines(VAULT_A)).toHaveLength(2);
  });

  it('checks a burst of distinct lines for repeats in linear time, not against every line before it', () => {
    // A bulk write into a read-only vault: 2,000 notes refused within the same minute.
    const { log } = setUp();
    vi.mocked(repeatsActivity).mockClear();
    const burst = 2000;
    for (let note = 0; note < burst; note += 1) {
      log.record({ ...failed, kind: 'save', message: `Could not save note ${note}.` });
    }
    // Recording runs on the window's thread; n²/2 comparisons (2 million here) freeze it.
    expect(vi.mocked(repeatsActivity).mock.calls.length).toBeLessThan(burst * 10);
  });
});
