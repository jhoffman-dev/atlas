/**
 * A tool's answer as JSON no longer than `limit` characters, and still JSON
 * when it had to be cut — a model handed half a value cannot read any of it.
 *
 * An answer that is too long is nearly always a long list (hits, rows, views),
 * so whole items are dropped from the end of its longest list, and a `cut`
 * says how many were kept of how many. An answer with no list to shorten, or
 * one whose other fields alone are too long, comes back as the start of its
 * text, held in a JSON string beside the same `cut`.
 */

const NOTE = 'The answer was too long and was cut: ask for fewer results.';

type Fields = Readonly<Record<string, unknown>>;

export function cappedJson(body: unknown, limit: number): string {
  const whole = JSON.stringify(body);
  if (whole.length <= limit) return whole;
  return (isFields(body) && fewerItems(body, limit)) || startOf(whole, limit);
}

/** The body with its longest list cut to as many whole items as fit, or null when none can. */
function fewerItems(body: Fields, limit: number): string | null {
  const list = longestList(body);
  if (list === null) return null;
  const items = body[list] as readonly unknown[];
  const keeping = (count: number) =>
    JSON.stringify({
      ...body,
      [list]: items.slice(0, count),
      cut: { list, shown: count, of: items.length, note: NOTE },
    });
  const count = mostThatFit(items.length, (n) => keeping(n).length <= limit);
  return count === null ? null : keeping(count);
}

/** The start of the text, as a JSON string, as much of it as fits. */
function startOf(whole: string, limit: number): string {
  const keeping = (count: number) =>
    JSON.stringify({ cut: { note: NOTE }, start: whole.slice(0, count) });
  return keeping(mostThatFit(whole.length, (n) => keeping(n).length <= limit) ?? 0);
}

function longestList(body: Fields): string | null {
  let longest: string | null = null;
  let length = -1;
  for (const [key, value] of Object.entries(body)) {
    if (!Array.isArray(value)) continue;
    const size = JSON.stringify(value).length;
    if (size > length) [longest, length] = [key, size];
  }
  return longest;
}

/** The largest count from 0 to `most` that fits, by halving; null when not even 0 does. */
function mostThatFit(most: number, fits: (count: number) => boolean): number | null {
  if (!fits(0)) return null;
  let [low, high] = [0, most];
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  return low;
}

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
