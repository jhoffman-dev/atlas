import {
  NO_SPAN,
  type AtlasQuery,
  type Expression,
  type QueryValue,
} from '../query-language/ast.ts';
import { MAX_QUERY_LIMIT } from '../query/view-query.ts';
import { addMonths, countedDay } from '../query-language/moving-date.ts';
import { addDays } from '../timeline/timeline.ts';
import type { AutomationAction } from './automation-rule.ts';

/**
 * The most a single run may do (P25-02). A rule whose query matches more does
 * this many and says how many it left for the next run, so a query written
 * wrong cannot empty a vault in one go.
 */
export const MAX_ACTIONS_PER_RUN = 500;

/**
 * The query an automation asks, on the day it runs.
 *
 * The index answers `@today` with its own clock; an automation must answer it
 * with the one it is handed, so what a rule would do is the same whenever it
 * is asked about the same day. So every moving date is pinned to that day's
 * date first. The rule's age filter — "not modified in the last 30 days",
 * which the query language cannot write — is added as one more condition on
 * `modified`.
 *
 * With no `LIMIT` of its own, it asks for as many notes as a query may return
 * — far more than a run may touch — so notes the run would leave as they are
 * can be left out before the cap is counted, rather than taking the places of
 * the ones still to do. An archive rule never asks for archived notes, even
 * with `INCLUDE ARCHIVED`: it cannot archive them again.
 */
export function automationQuery({
  query,
  today,
  olderThanDays,
  action,
}: {
  query: AtlasQuery;
  /** `YYYY-MM-DD`, from the injected clock. */
  today: string;
  /** Only notes not modified in this many days; null for any. */
  olderThanDays: number | null;
  action: AutomationAction;
}): AtlasQuery {
  const pinned = query.where === null ? null : pinExpression(query.where, today);
  const age = olderThanDays === null ? null : modifiedBefore(addDays(today, -olderThanDays)!);
  return {
    ...query,
    where: both(pinned, age),
    includeArchived: query.includeArchived && action.kind !== 'archive',
    limit: query.limit ?? MAX_QUERY_LIMIT,
  };
}

/** The day a moving date means, on `today`; null for a name there is no date for. */
export function movingDate(name: string, today: string): string | null {
  switch (name) {
    case 'today':
      return today;
    case 'yesterday':
      return addDays(today, -1);
    case 'tomorrow':
      return addDays(today, 1);
    case 'weekAgo':
      return addDays(today, -7);
    case 'weekAhead':
      return addDays(today, 7);
    case 'monthAhead':
      return addMonths(today, 1);
    default:
      return countedDay(name, today);
  }
}

function pinExpression(expression: Expression, today: string): Expression {
  switch (expression.kind) {
    case 'and':
    case 'or':
      return {
        ...expression,
        operands: expression.operands.map((operand) => pinExpression(operand, today)),
      };
    case 'not':
      return { ...expression, operand: pinExpression(expression.operand, today) };
    case 'compare':
      return { ...expression, value: pinValue(expression.value, today) };
    case 'empty':
      return expression;
  }
}

/** A moving date as the day it is; a name that is no date is left for the check to refuse. */
function pinValue(value: QueryValue, today: string): QueryValue {
  if (value.kind !== 'relativeDate') return value;
  const day = movingDate(value.name, today);
  return day === null ? value : { kind: 'text', text: day, span: value.span };
}

function modifiedBefore(day: string): Expression {
  return {
    kind: 'compare',
    field: { via: null, name: { text: 'modified', span: NO_SPAN }, span: NO_SPAN },
    op: '<',
    value: { kind: 'text', text: day, span: NO_SPAN },
    span: NO_SPAN,
  };
}

function both(first: Expression | null, second: Expression | null): Expression | null {
  if (first === null) return second;
  if (second === null) return first;
  return { kind: 'and', operands: [first, second], span: NO_SPAN };
}
