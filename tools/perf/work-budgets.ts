/*
 * The work budgets (`tools/perf/budgets.json`): how much one action may make
 * the app do, as counts — React commits, component renders, host commands by
 * name — so the gate fails when the app does more than it did, and a count on
 * one machine is the count on every machine. Time is too noisy on a CI runner
 * to fail on; it is reported beside the counts and never gated.
 *
 * Pure: the harness (`budgets.spec.ts`) measures, this compares and words it.
 */

/** What one action made the app do, from its input until the app went quiet. */
export interface Work {
  readonly commits: number;
  /** Each component's renders, mounts included, by name. */
  readonly renders: Readonly<Record<string, number>>;
  /** Each host command sent, by name. */
  readonly calls: Readonly<Record<string, number>>;
}

/** The most one action may do. A host command not listed may not be sent at all. */
export interface ActionBudget {
  readonly commits: number;
  /** Every component render, summed. */
  readonly renders: number;
  readonly calls: Readonly<Record<string, number>>;
  /**
   * Hard rules, never given headroom: the most times these components (a
   * list's rows) may render. Ticking one row draws that row, not the list.
   */
  readonly rows?: Readonly<Record<string, number>>;
}

/** `budgets.json`: a note for the reader, and each action's budget by name. */
export interface BudgetsFile {
  readonly $comment: readonly string[];
  readonly actions: Readonly<Record<string, ActionBudget>>;
}

/** One count over its budget. */
export interface Breach {
  readonly count: string;
  readonly budget: number;
  readonly actual: number;
}

/**
 * A measured count with room to vary: 10% or 2, whichever is more. Work that
 * is not done today (0) gets none — it must not start.
 */
export function withHeadroom(measured: number): number {
  if (measured === 0) return 0;
  return measured + Math.max(2, Math.ceil(measured * 0.1));
}

const sum = (counts: Readonly<Record<string, number>>) =>
  Object.values(counts).reduce((total, count) => total + count, 0);

/** Every count in `work` that is over `budget`, rows first, then commits, renders and commands. */
export function breachesOf(work: Work, budget: ActionBudget): Breach[] {
  const breaches: Breach[] = [];
  const over = (count: string, limit: number, actual: number) => {
    if (actual > limit) breaches.push({ count, budget: limit, actual });
  };
  for (const [row, limit] of Object.entries(budget.rows ?? {})) {
    over(`${row} renders (hard rule)`, limit, work.renders[row] ?? 0);
  }
  over('React commits', budget.commits, work.commits);
  over('component renders', budget.renders, sum(work.renders));
  for (const [command, actual] of Object.entries(work.calls)) {
    over(`host calls to ${command}`, budget.calls[command] ?? 0, actual);
  }
  return breaches;
}

/** The `limit` largest entries of a count, as `name×count`, most first. */
export function topOf(counts: Readonly<Record<string, number>>, limit = 5): string {
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (ranked.length === 0) return 'none';
  return ranked
    .slice(0, limit)
    .map(([name, count]) => `${name}×${count}`)
    .join(', ');
}

/** What the gate prints when an action is over its budget: which counts, by how much, and who did it. */
export function describeBreaches(action: string, work: Work, breaches: readonly Breach[]): string {
  const lines = breaches.map(
    ({ count, budget, actual }) =>
      `  ${count}: budget ${budget}, actual ${actual} (+${actual - budget})`,
  );
  return [
    `"${action}" did more work than its budget (tools/perf/budgets.json):`,
    ...lines,
    `  most rendered: ${topOf(work.renders)}`,
    `  most called:   ${topOf(work.calls)}`,
  ].join('\n');
}

/** The budget an action measured at `work` gets: its counts, with headroom; rows keep their rules. */
export function budgetFor(work: Work, rows?: ActionBudget['rows']): ActionBudget {
  return {
    commits: withHeadroom(work.commits),
    renders: withHeadroom(sum(work.renders)),
    calls: Object.fromEntries(
      Object.entries(work.calls)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([command, count]) => [command, withHeadroom(count)]),
    ),
    ...(rows === undefined ? {} : { rows }),
  };
}

/**
 * `was`, lowered wherever `now` is under it, and never raised: each count is
 * the lesser of the two. An action with no budget yet takes `now` whole.
 */
export function lowered(was: ActionBudget | undefined, now: ActionBudget): ActionBudget {
  if (was === undefined) return now;
  const commands = Object.keys(was.calls).filter((command) => command in now.calls);
  return {
    commits: Math.min(was.commits, now.commits),
    renders: Math.min(was.renders, now.renders),
    calls: Object.fromEntries(
      commands.map((command) => [
        command,
        Math.min(was.calls[command] ?? 0, now.calls[command] ?? 0),
      ]),
    ),
    ...(was.rows === undefined ? {} : { rows: was.rows }),
  };
}

/** One action as the run measured it, for the report. */
export interface Measurement {
  readonly action: string;
  readonly work: Work;
  readonly budget: ActionBudget | undefined;
  /** Reported, never gated: milliseconds from the input to the page being ready. */
  readonly inputToReady: number;
  /** Reported, never gated: the longest the main thread went without a frame. */
  readonly longestFrame: number;
}

const against = (actual: number, limit: number | undefined) =>
  limit === undefined ? `${actual} / none` : `${actual} / ${limit}${actual > limit ? ' ✗' : ''}`;

/**
 * The run as a Markdown table, for the CI log and the job summary: each
 * count beside its budget, and the times, which are there to watch, not to fail on.
 */
export function reportTable(measured: readonly Measurement[]): string {
  const head = [
    '| Action | Commits / budget | Renders / budget | Host calls / budget | Most called | Input→ready (ms) | Longest frame (ms) |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  const rows = measured.map(({ action, work, budget, inputToReady, longestFrame }) => {
    const calls = sum(work.calls);
    const allowed = budget === undefined ? undefined : sum(budget.calls);
    return `| ${action} | ${against(work.commits, budget?.commits)} | ${against(sum(work.renders), budget?.renders)} | ${against(calls, allowed)} | ${topOf(work.calls, 3)} | ${Math.round(inputToReady)} | ${Math.round(longestFrame)} |`;
  });
  return [...head, ...rows].join('\n');
}

/** Every count that differs between two runs of one action, as `count: first → second`. */
export function differencesBetween(first: Work, second: Work): string[] {
  const differ: string[] = [];
  const compare = (count: string, a: number, b: number) => {
    if (a !== b) differ.push(`${count}: ${a} → ${b}`);
  };
  compare('React commits', first.commits, second.commits);
  for (const [kind, a, b] of [
    ['renders of', first.renders, second.renders],
    ['host calls to', first.calls, second.calls],
  ] as const) {
    for (const name of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      compare(`${kind} ${name}`, a[name] ?? 0, b[name] ?? 0);
    }
  }
  return differ;
}
