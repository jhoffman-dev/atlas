/** What a test needs of a SQLite connection to read a statement's plan: `node:sqlite`'s shape. */
export interface PlannedDatabase {
  prepare(sql: string): { all(...parameters: never[]): unknown[] };
}

interface PlanStep {
  readonly id: number;
  readonly parent: number;
  readonly detail: string;
}

/**
 * How each correlated subquery in `sql`'s plan finds its rows, as the planner
 * chose: every table SEARCH or SCAN under a `CORRELATED` step, as SQLite
 * words it. A subquery that seeks by the outer row's path reads that note's
 * rows alone; one that seeks by `key` reads every note holding the key, once
 * per row asked about. The plan decides that, so a test asserts it rather
 * than the time the statement takes (#385).
 */
export function correlatedReads(
  database: PlannedDatabase,
  { sql, parameters }: { sql: string; parameters: readonly unknown[] },
): string[] {
  const plan = database
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...(parameters as never[])) as PlanStep[];
  const correlated = new Set<number>();
  for (const step of plan) {
    if (step.detail.startsWith('CORRELATED') || correlated.has(step.parent)) {
      correlated.add(step.id);
    }
  }
  return plan
    .filter(
      (step) => correlated.has(step.parent) && /^(SEARCH|SCAN) (?!\(subquery)/.test(step.detail),
    )
    .map((step) => step.detail);
}
