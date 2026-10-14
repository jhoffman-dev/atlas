import { describe, expect, it } from 'vitest';
import { pulledSinceLastSleep } from './pull-freshness.ts';

/**
 * A fake of the host's counter: the time asleep since boot, which a test
 * moves only by "sleeping" the Mac. The wall clock is not in it at all.
 */
function fakeMac(asleepMs = 457_335_000) {
  let asleep = asleepMs;
  return {
    read: () => asleep,
    sleep: (ms: number) => {
      asleep += ms;
    },
  };
}

describe('pulledSinceLastSleep (SPIKE #172)', () => {
  it('is false at launch, before any pull has completed', () => {
    const mac = fakeMac();
    expect(pulledSinceLastSleep({ lastCompletedPull: null, asleepNowMs: mac.read() })).toBe(false);
  });

  it('is true once a pull started and completed with the Mac awake throughout', () => {
    const mac = fakeMac();
    const pull = { startedAsleepMs: mac.read() };
    expect(pulledSinceLastSleep({ lastCompletedPull: pull, asleepNowMs: mac.read() })).toBe(true);
  });

  it('is false after the Mac sleeps, however long ago the pull was', () => {
    const mac = fakeMac();
    const pull = { startedAsleepMs: mac.read() };
    mac.sleep(8 * 60 * 60 * 1000);
    expect(pulledSinceLastSleep({ lastCompletedPull: pull, asleepNowMs: mac.read() })).toBe(false);
  });

  it('is false after a dark wake, which the did-wake notification never reports', () => {
    const mac = fakeMac();
    const pull = { startedAsleepMs: mac.read() };
    mac.sleep(991_000);
    expect(pulledSinceLastSleep({ lastCompletedPull: pull, asleepNowMs: mac.read() })).toBe(false);
  });

  it('does not count a pull that started before a sleep and completed after it', () => {
    const mac = fakeMac();
    const straddling = { startedAsleepMs: mac.read() };
    mac.sleep(60_000);
    expect(pulledSinceLastSleep({ lastCompletedPull: straddling, asleepNowMs: mac.read() })).toBe(
      false,
    );
  });

  it('is true again once a pull started after the wake has completed', () => {
    const mac = fakeMac();
    mac.sleep(60_000);
    const afterWake = { startedAsleepMs: mac.read() };
    expect(pulledSinceLastSleep({ lastCompletedPull: afterWake, asleepNowMs: mac.read() })).toBe(
      true,
    );
  });

  it('is false when the host could not read the counter: it never guesses', () => {
    const mac = fakeMac();
    const pull = { startedAsleepMs: mac.read() };
    expect(pulledSinceLastSleep({ lastCompletedPull: pull, asleepNowMs: null })).toBe(false);
  });
});
