import { invoke } from '@tauri-apps/api/core';
import type { SleepClockPort } from '@dfai/application';

/** How long this Mac has slept since it booted, as the host reads it (`sleep_clock.rs`, #172). */
export const tauriSleepClock: SleepClockPort = {
  async asleepMs() {
    let answer: unknown;
    try {
      answer = await invoke<unknown>('host_asleep_ms');
    } catch (cause) {
      throw cause instanceof Error ? cause : new Error(String(cause), { cause });
    }
    if (typeof answer !== 'number' || !Number.isFinite(answer) || answer < 0) {
      throw new Error(
        `the host answered the time asleep with ${String(answer)}: not a number of milliseconds`,
      );
    }
    return answer;
  },
};
