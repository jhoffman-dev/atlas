import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { tauriSleepClock } = await import('./tauri-sleep-clock.ts');

describe('tauriSleepClock', () => {
  beforeEach(() => invoke.mockReset());

  it('reads how long this Mac has slept from the host', async () => {
    invoke.mockResolvedValueOnce(457_335_000);
    await expect(tauriSleepClock.asleepMs()).resolves.toBe(457_335_000);
    expect(invoke).toHaveBeenCalledWith('host_asleep_ms');
  });

  it('rejects with the host’s words when it cannot read the clocks', async () => {
    invoke.mockRejectedValueOnce('the time this computer has slept is only read on macOS');
    await expect(tauriSleepClock.asleepMs()).rejects.toThrow('only read on macOS');
  });

  it('rejects an answer that is not a number of milliseconds, rather than handing it on', async () => {
    for (const answer of [undefined, null, '457335000', -1, Number.NaN]) {
      invoke.mockResolvedValueOnce(answer);
      await expect(tauriSleepClock.asleepMs()).rejects.toThrow('not a number of milliseconds');
    }
  });
});
