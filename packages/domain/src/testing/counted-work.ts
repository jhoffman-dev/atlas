/**
 * Work counted rather than timed, for tests that hold a rule to a growth rate:
 * a count is the same on every machine however loaded it is, where a clock on
 * a busy CI runner is not (#385). A test compares the work of two sizes of
 * input, never a count against a number of milliseconds.
 *
 * While `run` runs, the built-ins that read through a text or a collection
 * add what they read:
 * - a regex execution, from where it started to the end of its match, or of
 *   the text when it found none — a global `replace`, `match` or `matchAll`
 *   is so counted once over the text;
 * - `indexOf` and `includes` on a string or an array, up to what they found;
 *   `startsWith` the text it compared; `slice` what it copied; `split` the
 *   text it split, and `join` the text it made;
 * - an array pass (`filter`, `map`, `find`, `some`, …), the array's length;
 * - a sort, each comparison; a `Map` or `Set` lookup or insertion, one.
 *
 * What it cannot see: a hand-written loop that reads by index, string
 * concatenation, and backtracking inside one regex execution.
 */
export function countedWork(run: () => unknown): number {
  const counting = startCounting();
  try {
    run();
  } finally {
    counting.stop();
  }
  return counting.work();
}

/**
 * {@link countedWork} for a use-case that awaits: counted until it settles.
 * Only for work whose awaits are answered at once (fake ports), so nothing
 * but its own continuations runs while the built-ins are counted.
 */
export async function countedWorkAsync(run: () => Promise<unknown>): Promise<number> {
  const counting = startCounting();
  try {
    await run();
  } finally {
    counting.stop();
  }
  return counting.work();
}

/** Wraps the counted built-ins until `stop`. */
function startCounting(): { work: () => number; stop: () => void } {
  let work = 0;
  // Plain loops, not array methods: those are wrapped as this goes, and would count.
  const restores: (() => void)[] = [];
  for (const { owner, names, cost } of COUNTED) {
    for (const name of names) {
      const methods = owner as Record<string, Method>;
      const original = methods[name] as Method;
      methods[name] = function (this: unknown, ...args: unknown[]) {
        const result = original.apply(this, args);
        work += cost(this, args, result);
        return result;
      };
      restores.push(() => {
        methods[name] = original;
      });
    }
  }
  const { exec } = RegExp.prototype;
  const { sort } = Array.prototype;
  RegExp.prototype.exec = function (this: RegExp, input: string) {
    const from = this.global || this.sticky ? this.lastIndex : 0;
    const match = exec.call(this, input);
    work += (match === null ? String(input).length : match.index + match[0].length) - from;
    return match;
  };
  Array.prototype.sort = function <T>(this: T[], compare?: (left: T, right: T) => number) {
    if (compare === undefined) {
      work += this.length;
      return sort.call(this);
    }
    return sort.call(this, (left: T, right: T) => {
      work += 1;
      return compare(left, right);
    });
  };
  return {
    work: () => work,
    stop: () => {
      RegExp.prototype.exec = exec;
      Array.prototype.sort = sort;
      for (const restore of restores) restore();
    },
  };
}

type Method = (this: unknown, ...args: unknown[]) => unknown;

interface Counted {
  readonly owner: object;
  readonly names: readonly string[];
  /** What one call read, from what it was called on, with and gave back. */
  readonly cost: (self: unknown, args: readonly unknown[], result: unknown) => number;
}

const lengthOf = (value: unknown): number => (value as { length: number }).length;

/** From the search's start to the end of what it found, or to the end when nothing. */
const searched = (self: unknown, args: readonly unknown[], result: unknown): number => {
  const from = typeof args[1] === 'number' ? Math.max(0, args[1]) : 0;
  const found = typeof result === 'number' ? result : -1;
  const width = typeof args[0] === 'string' ? args[0].length : 1;
  return Math.max(0, (found === -1 ? lengthOf(self) : found + width) - from);
};

// Taken before any is counted, so measuring an `includes` adds no `indexOf` of its own.
const STRING_INDEX_OF = String.prototype.indexOf as Method;
const ARRAY_INDEX_OF = Array.prototype.indexOf as Method;

/** `includes` read as far as `indexOf` would have. */
const included = (self: unknown, args: readonly unknown[]): number => {
  const indexOf = typeof self === 'string' ? STRING_INDEX_OF : ARRAY_INDEX_OF;
  return searched(self, args, indexOf.apply(self, [...args]));
};

const COUNTED: readonly Counted[] = [
  { owner: String.prototype, names: ['indexOf'], cost: searched },
  { owner: String.prototype, names: ['includes'], cost: included },
  { owner: String.prototype, names: ['startsWith'], cost: (_, args) => lengthOf(args[0]) },
  { owner: String.prototype, names: ['slice'], cost: (_, __, result) => lengthOf(result) },
  { owner: String.prototype, names: ['split'], cost: lengthOf },
  { owner: Array.prototype, names: ['indexOf'], cost: searched },
  { owner: Array.prototype, names: ['includes'], cost: included },
  { owner: Array.prototype, names: ['slice', 'join'], cost: (_, __, result) => lengthOf(result) },
  {
    owner: Array.prototype,
    names: ['filter', 'map', 'flatMap', 'find', 'findIndex', 'some', 'every', 'forEach', 'reduce'],
    cost: lengthOf,
  },
  { owner: Map.prototype, names: ['get', 'has', 'set'], cost: () => 1 },
  { owner: Set.prototype, names: ['has', 'add'], cost: () => 1 },
];

/**
 * The source of every pattern made with `RegExp` while `run` runs. A rule
 * whose patterns are the same whatever it is given has none that grow with
 * it, which counting cannot show: one pattern of a thousand alternatives is
 * one regex execution, however long it takes.
 */
export function patternsMadeIn(run: () => unknown): string[] {
  const made: string[] = [];
  const Original = globalThis.RegExp;
  globalThis.RegExp = new Proxy(Original, {
    construct: (target, args: [string | RegExp, string?]) => {
      made.push(String(args[0] instanceof Original ? args[0].source : args[0]));
      return Reflect.construct(target, args) as RegExp;
    },
    apply: (target, _, args: [string | RegExp, string?]) => {
      made.push(String(args[0] instanceof Original ? args[0].source : args[0]));
      return Reflect.apply(target, undefined, args) as RegExp;
    },
  });
  try {
    run();
  } finally {
    globalThis.RegExp = Original;
  }
  return made;
}
