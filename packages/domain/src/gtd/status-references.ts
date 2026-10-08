import { isAutomationNote } from '../automations/automation-rule.ts';
import { isRecord } from '../query/frontmatter-query.ts';
import { isSavedView, parseQueryView, parseSqlView, QUERY_VIEW_KEY } from '../query/saved-view.ts';
import type { Expression } from '../query-language/ast.ts';
import { parseAtlasQuery } from '../query-language/parse.ts';
import { printValue } from '../query-language/print.ts';
import { isGtdStatus, TASK_KEYS, TASK_TYPE, WAITING_STATUS } from './gtd-status.ts';
import { isInboxFallback, mappedStatus, type StatusMapping } from './status-mapping.ts';

/**
 * What the migration does to a view or an automation that names an old
 * status (ADR-0029): the frontmatter it writes, with one line per status it
 * changes, or why it cannot be rewritten and is listed for James instead.
 * Null when it names no status the migration moves.
 */
export type StatusRewrite =
  | { readonly changes: Readonly<Record<string, unknown>>; readonly moved: readonly string[] }
  | { readonly problem: string }
  | null;

type Properties = Readonly<Record<string, unknown>>;

/** The statuses the vault's tasks hold now, as the index reads them. */
export type StatusesInUse = ReadonlySet<string>;

const NONE_IN_USE: StatusesInUse = new Set();

/** Comparisons a status can be carried through: what equals `done` equals `archive` after. */
const CARRIED = new Set(['=', '!=', 'is', 'isNot']);

/** Comparisons that leave a status out rather than pick it. */
const EXCLUDING = new Set(['!=', 'isNot']);

const isStatus = (key: string) => key.trim().toLowerCase() === TASK_KEYS.status;

const moveLine = (from: string, to: string) => `${from} → ${to}`;

/** Why a status compared some other way cannot be carried over. */
const uncarried = (value: string, how: string) =>
  `It compares status with “${value}” using ${how}, which no GTD status can stand in for. Change it by hand.`;

/** Why a query over tasks and other types is left: their statuses are not the tasks'. */
const MIXED =
  'It lists other types beside tasks, whose statuses do not move with the tasks’. Change it by hand.';

/**
 * Why a comparison with an old status cannot simply say the status it
 * becomes, or null when it can.
 *
 * Picking a status (`=`) carries over: what was `review` is `in-progress`.
 * Leaving one out (`!=`, or `=` under NOT) carries over only when no other
 * old status becomes the same one, and no task holds it already — leaving
 * out `in-progress` for what was `review` would leave out what was `doing`
 * too, and the tasks already In Progress. A status no one knew, which
 * goes to the Inbox with every other such status, is never carried: the
 * Inbox is not what the view meant.
 */
function carryProblem({
  value,
  how,
  excluding,
  mapping,
  inUse,
}: {
  value: string;
  how: string;
  excluding: boolean;
  mapping: StatusMapping;
  inUse: StatusesInUse;
}): string | null {
  if (!CARRIED.has(how)) return uncarried(value, how);
  const to = mappedStatus(mapping, value);
  if (isInboxFallback(mapping, value)) {
    return `It names “${value}”, which is no status GTD knows and goes to the Inbox with anything else unknown. Change it by hand.`;
  }
  const alongside = [...mapping]
    .filter(([from, becomes]) => becomes === to && from !== value)
    .map(([from]) => `“${from}”`);
  if (excluding && alongside.length > 0) {
    return `It leaves out “${value}”, which becomes ${to} along with ${alongside.join(', ')}: leaving out ${to} would leave those out too. Change it by hand.`;
  }
  if (excluding && inUse.has(to)) {
    return `It leaves out “${value}”, which becomes ${to} — a status tasks already hold: leaving out ${to} would leave them out too. Change it by hand.`;
  }
  return null;
}

interface Replacement {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

type Comparison = Extract<Expression, { kind: 'compare' }>;

/** Every `status` comparison in a WHERE, depth first, with whether a NOT turns it round. */
function statusComparisons(expression: Expression | null) {
  if (expression === null) return [];
  const found: { comparison: Comparison; negated: boolean }[] = [];
  const walk = (part: Expression, negated: boolean): void => {
    if (part.kind === 'and' || part.kind === 'or')
      part.operands.forEach((operand) => walk(operand, negated));
    else if (part.kind === 'not') walk(part.operand, !negated);
    else if (part.kind === 'compare' && part.field.via === null && isStatus(part.field.name.text))
      found.push({ comparison: part, negated });
  };
  walk(expression, false);
  return found;
}

const foldedType = (name: string) => name.trim().toLowerCase();

/**
 * An Atlas query with each old status it compares with written as the one it
 * becomes, in place: only the value's own characters change, so the rest of
 * the text — its spacing, its comments' worth of layout — stays as typed.
 *
 * Only a query of tasks alone is rewritten. One that lists another type as
 * well, and names an old status, is listed: a project's `done` is not a
 * task's. A query that does not read, or lists no tasks, is not the
 * migration's to judge, and is left alone.
 */
export function rewrittenQuery({
  text,
  mapping,
  inUse = NONE_IN_USE,
}: {
  text: string;
  mapping: StatusMapping;
  /** The statuses tasks already hold, which leaving one out would leave out too. */
  inUse?: StatusesInUse;
}): { text: string; moved: readonly string[] } | { problem: string } | null {
  let query;
  try {
    query = parseAtlasQuery(text);
  } catch {
    // A query that does not read cannot be judged; the view already shows why it does not run.
    return null;
  }
  const types = query.from.map((name) => foldedType(name.text));
  if (!types.includes(TASK_TYPE)) return null;
  const old = statusComparisons(query.where).filter(
    ({ comparison: { value } }) => value.kind === 'text' && !isGtdStatus(value.text),
  );
  if (old.length === 0) return null;
  if (types.some((type) => type !== TASK_TYPE)) return { problem: MIXED };

  const replacements: Replacement[] = [];
  const moved: string[] = [];
  for (const { comparison, negated } of old) {
    const { op, value } = comparison;
    if (value.kind !== 'text') continue;
    const excluding = EXCLUDING.has(op) !== negated;
    const problem = carryProblem({ value: value.text, how: op, excluding, mapping, inUse });
    if (problem !== null) return { problem };
    const to = mappedStatus(mapping, value.text);
    replacements.push({ ...value.span, text: printValue({ ...value, text: to }) });
    moved.push(moveLine(value.text, to));
  }
  const rewritten = replacements
    .sort((left, right) => right.start - left.start)
    .reduce((at, { start, end, text: put }) => at.slice(0, start) + put + at.slice(end), text);
  return { text: rewritten, moved };
}

/** A view's `filters:` list with each old status it filters by moved on. */
function rewrittenFilters(
  filters: readonly unknown[],
  mapping: StatusMapping,
  inUse: StatusesInUse,
): StatusRewrite {
  const moved: string[] = [];
  const next: unknown[] = [];
  for (const filter of filters) {
    const value = isRecord(filter) ? filter['value'] : undefined;
    if (
      !isRecord(filter) ||
      !isStatus(String(filter['key'] ?? '')) ||
      typeof value !== 'string' ||
      isGtdStatus(value)
    ) {
      next.push(filter);
      continue;
    }
    const how = String(filter['operator'] ?? '');
    const problem = carryProblem({ value, how, excluding: EXCLUDING.has(how), mapping, inUse });
    if (problem !== null) return { problem };
    const to = mappedStatus(mapping, value);
    next.push({ ...filter, value: to });
    moved.push(moveLine(value, to));
  }
  return moved.length === 0 ? null : { changes: { filters: next }, moved };
}

/**
 * What the migration does to a saved view: a query view's text, or a table
 * view's `filters:`, moved on. A SQL view that mentions status is listed —
 * SQL is James's own, and Atlas does not rewrite it.
 */
export function viewStatusRewrite(
  frontmatter: Properties,
  mapping: StatusMapping,
  inUse: StatusesInUse = NONE_IN_USE,
): StatusRewrite {
  if (!isSavedView(frontmatter)) return null;
  const sql = parseSqlView(frontmatter);
  if (sql !== null) {
    return /\bstatus\b/i.test(sql)
      ? {
          problem:
            'It is a SQL view that reads status. Atlas does not rewrite SQL: check it by hand.',
        }
      : null;
  }
  const query = parseQueryView(frontmatter);
  if (query !== null) {
    const rewritten = rewrittenQuery({ text: query, mapping, inUse });
    if (rewritten === null || 'problem' in rewritten) return rewritten;
    return { changes: { [QUERY_VIEW_KEY]: rewritten.text }, moved: rewritten.moved };
  }
  const type = String(frontmatter['type'] ?? '')
    .trim()
    .toLowerCase();
  const filters = frontmatter['filters'];
  if (type !== TASK_TYPE || !Array.isArray(filters)) return null;
  return rewrittenFilters(filters, mapping, inUse);
}

/**
 * What the migration does to an automation: the old statuses in `which:`
 * moved on, and a status it sets, when it sets one on tasks alone. A rule
 * over tasks and other types that sets an old status, or one that would set
 * a status no one knew or Waiting — which needs someone, task by task — is
 * listed instead.
 */
export function automationStatusRewrite(
  frontmatter: Properties,
  mapping: StatusMapping,
  inUse: StatusesInUse = NONE_IN_USE,
): StatusRewrite {
  if (!isAutomationNote(frontmatter)) return null;
  const which = typeof frontmatter['which'] === 'string' ? frontmatter['which'] : '';
  const query = rewrittenQuery({ text: which, mapping, inUse });
  if (query !== null && 'problem' in query) return query;
  const changes: Record<string, unknown> = query === null ? {} : { which: query.text };
  const moved = [...(query?.moved ?? [])];

  const set = frontmatter['set'];
  const setStatus = isRecord(set) ? set[TASK_KEYS.status] : undefined;
  const types = typesOf(which);
  if (
    isRecord(set) &&
    types.includes(TASK_TYPE) &&
    typeof setStatus === 'string' &&
    !isGtdStatus(setStatus)
  ) {
    const problem = setProblem({ types, value: setStatus, mapping });
    if (problem !== null) return { problem };
    const to = mappedStatus(mapping, setStatus);
    changes['set'] = { ...set, [TASK_KEYS.status]: to };
    moved.push(`sets ${moveLine(setStatus, to)}`);
  }
  return moved.length === 0 ? null : { changes, moved };
}

/** Why a rule's `set: status` cannot simply say the status it becomes, or null when it can. */
function setProblem({
  types,
  value,
  mapping,
}: {
  types: readonly string[];
  value: string;
  mapping: StatusMapping;
}): string | null {
  if (types.some((type) => type !== TASK_TYPE)) return MIXED;
  if (isInboxFallback(mapping, value)) {
    return `It sets “${value}”, which is no status GTD knows. Change it by hand.`;
  }
  if (mappedStatus(mapping, value) === WAITING_STATUS) {
    return 'It would set Waiting, which needs someone to wait on, task by task. Change it by hand.';
  }
  return null;
}

/** The types a rule's query lists: none when it does not read, as such a rule never runs. */
function typesOf(which: string): string[] {
  try {
    return parseAtlasQuery(which).from.map((name) => foldedType(name.text));
  } catch {
    // A rule whose query does not read never runs, so what it sets moves nothing.
    return [];
  }
}
