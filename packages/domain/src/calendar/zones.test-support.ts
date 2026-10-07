import { afterEach, beforeEach } from 'vitest';

/**
 * Zones the calendar rules are run in: either side of the date line, a
 * half-hour daylight-saving shift, and the two changes most people live
 * through. A rule that leaned on the machine's zone would answer differently
 * in one of them.
 */
export const ZONES = [
  'UTC',
  'America/New_York',
  'Europe/London',
  'Australia/Lord_Howe',
  'Pacific/Kiritimati',
  'Pacific/Pago_Pago',
] as const;

/** Runs the enclosing describe's tests with the process in `zone`. Node rereads TZ when it is set. */
export function useZone(zone: string): void {
  const before = process.env['TZ'];
  beforeEach(() => {
    process.env['TZ'] = zone;
  });
  afterEach(() => {
    if (before === undefined) delete process.env['TZ'];
    else process.env['TZ'] = before;
  });
}
