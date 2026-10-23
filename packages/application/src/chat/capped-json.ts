/**
 * A tool's answer as JSON no longer than `limit` characters, and still JSON
 * when it had to be cut — a model handed half a value cannot read any of it.
 *
 * An answer that is too long is nearly always a long list (hits, rows, views),
 * so whole items are dropped from the end of its longest list, and a `cut`
 * says how many were kept of how many. The list may be one the answer wraps
 * (`{ brief: { openTasks: […] } }`, as the assistant's tools answer): the
 * object that holds a cut list and has a `truncated` flag has it set. When
 * the longest list cut to nothing is still too long, the next longest is cut
 * too; those after the first are named in `alsoCut`. An answer with no list
 * to shorten, or one whose other fields alone are too long, comes back as the
 * start of its text, held in a JSON string beside a `cut` that says how long
 * it was.
 */

const NOTE = 'The answer was too long and was cut: ask for fewer results.';

type Fields = Readonly<Record<string, unknown>>;

/** How many objects deep a list may sit in an answer and still be cut by its items. */
const LIST_DEPTH = 2;

export function cappedJson(body: unknown, limit: number): string {
  const whole = JSON.stringify(body);
  if (whole.length <= limit) return whole;
  return (isFields(body) && fewerItems(body, limit)) || startOf(whole, limit);
}

/** A list somewhere in the answer: the keys leading to it, and what it holds. */
interface ListAt {
  readonly path: readonly string[];
  readonly items: readonly unknown[];
}

/** What was left of one cut list. */
interface Cut {
  readonly list: string;
  readonly shown: number;
  readonly of: number;
}

/** The body with its longest lists cut to as many whole items as fit, or null when none can. */
function fewerItems(body: Fields, limit: number): string | null {
  const cuts: Cut[] = [];
  let current: Fields = body;
  for (;;) {
    const longest = listsIn(current)
      .filter((list) => list.items.length > 0)
      .sort((left, right) => sizeOf(right.items) - sizeOf(left.items))[0];
    if (longest === undefined) return null;
    const cutTo = (count: number) => {
      const next = withItems(current, longest, count);
      const made = [
        ...cuts,
        { list: longest.path.join('.'), shown: count, of: longest.items.length },
      ];
      return { next, text: JSON.stringify(withCuts(next, made)) };
    };
    const count = mostThatFit(longest.items.length, (n) => cutTo(n).text.length <= limit);
    const cut = cutTo(count ?? 0);
    if (count !== null) return cut.text;
    // Not even this list emptied is short enough: it goes, and the next longest is cut.
    current = cut.next;
    cuts.push({ list: longest.path.join('.'), shown: 0, of: longest.items.length });
  }
}

const sizeOf = (value: unknown): number => JSON.stringify(value).length;

/** Every list in the answer, in the objects it is wrapped in down to {@link LIST_DEPTH}. */
function listsIn(body: Fields, path: readonly string[] = []): ListAt[] {
  return Object.entries(body).flatMap(([key, value]): ListAt[] => {
    if (Array.isArray(value)) return [{ path: [...path, key], items: value }];
    return isFields(value) && path.length < LIST_DEPTH ? listsIn(value, [...path, key]) : [];
  });
}

/** The body with the list at `at` cut to `count` items, and `truncated` set on the object that holds it. */
function withItems(body: Fields, at: ListAt, count: number): Fields {
  const [key, ...rest] = at.path;
  if (key === undefined) return body;
  if (rest.length === 0) {
    const flagged = 'truncated' in body ? { truncated: true } : {};
    return { ...body, ...flagged, [key]: at.items.slice(0, count) };
  }
  return { ...body, [key]: withItems(body[key] as Fields, { ...at, path: rest }, count) };
}

/** The body with its cuts said: the first as `cut`, any others as `alsoCut`. */
function withCuts(body: Fields, cuts: readonly Cut[]): Fields {
  const [first, ...others] = cuts;
  if (first === undefined) return body;
  return {
    ...body,
    cut: { ...first, note: NOTE },
    ...(others.length > 0 && { alsoCut: others }),
  };
}

/** The start of the text, as a JSON string, as much of it as fits. */
function startOf(whole: string, limit: number): string {
  // One value cannot be asked for in fewer results: say it was cut, and how big it was.
  const note = `The answer was ${whole.length.toLocaleString('en-US')} characters, too long for one answer, and was cut to its start.`;
  const keeping = (count: number) =>
    JSON.stringify({ cut: { note }, start: whole.slice(0, count) });
  return keeping(mostThatFit(whole.length, (n) => keeping(n).length <= limit) ?? 0);
}

/** The largest count from 0 to `most` that fits, by halving; null when not even 0 does. */
export function mostThatFit(most: number, fits: (count: number) => boolean): number | null {
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
