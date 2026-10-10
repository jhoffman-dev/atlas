const MINUTES_PER_HOUR = 60;

/**
 * The longest estimate read: a hundred years of minutes. Anything longer is a
 * slip of the keyboard, not a plan, and is read as no estimate.
 */
export const LONGEST_ESTIMATE_MINUTES = 100 * 366 * 24 * MINUTES_PER_HOUR;

/** `2h`, `30m`, `1h30m`, `1.5h`, `45 min`: hours, minutes, or both, in that order. */
const HOURS_AND_MINUTES =
  /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?)?$/i;

/**
 * A task's estimate in whole minutes, or null when it does not say one.
 *
 * GTD's Task type keeps `estimate` as a number of minutes (ADR-0029). A vault
 * that kept its own text estimate may write `2h` or `1h30m`, and those are
 * read too. A day or a week (`1d`, `1w`) is not: how many minutes of work a
 * day holds is the person's to say, and a guess would schedule wrongly. Nor
 * is one longer than {@link LONGEST_ESTIMATE_MINUTES}.
 */
export function estimateMinutes(value: unknown): number | null {
  if (typeof value === 'number') return wholeMinutes(value);
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '') return null;
  const plain = Number(text);
  if (Number.isFinite(plain)) return wholeMinutes(plain);
  const match = HOURS_AND_MINUTES.exec(text);
  if (match === null) return null;
  const [, hours, minutes] = match;
  return wholeMinutes(Number(hours ?? 0) * MINUTES_PER_HOUR + Number(minutes ?? 0));
}

function wholeMinutes(minutes: number): number | null {
  return Number.isFinite(minutes) && minutes >= 0 && minutes <= LONGEST_ESTIMATE_MINUTES
    ? Math.round(minutes)
    : null;
}

/** "2h", "1h 30m", "20m", "0m": minutes as a schedule shows them. */
export function durationLabel(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / MINUTES_PER_HOUR);
  const rest = whole % MINUTES_PER_HOUR;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
