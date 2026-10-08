import { isAutomationNote } from '../automations/automation-rule.ts';
import { isRecord } from '../query/frontmatter-query.ts';
import { isSavedView, parseQueryView, parseSqlView, QUERY_VIEW_KEY } from '../query/saved-view.ts';
import type { Expression } from '../query-language/ast.ts';
import { parseAtlasQuery } from '../query-language/parse.ts';
import { printValue } from '../query-language/print.ts';
import { isGtdStatus, TASK_KEYS, TASK_TYPE } from './gtd-status.ts';
import { mappedStatus, type StatusMapping } from './status-mapping.ts';

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

/** Comparisons a status can be carried through: what equals `done` equals `archive` after. */
const CARRIED = new Set(['=', '!=', 'is', 'isNot']);

const isStatus = (key: string) => key.trim().toLowerCase() === TASK_KEYS.status;

const moveLine = (from: string, to: string) => `${from} → ${to}`;

/** Why a status compared some other way cannot be carried over. */
const uncarried = (value: string, how: string) =>
  `It compares status with “${value}” using ${how}, which no GTD status can stand in for. Change it by hand.`;

interface Replacement {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Every `status` comparison in a WHERE, depth first. */
function statusComparisons(expression: Expression | null) {
  if (expression === null) return [];
  const found: Extract<Expression, { kind: 'compare' }>[] = [];
  const walk = (part: Expression): void => {
    if (part.kind === 'and' || part.kind === 'or') part.operands.forEach(walk);
    else if (part.kind === 'not') walk(part.operand);
    else if (part.kind === 'compare' && part.field.via === null && isStatus(part.field.name.text))
      found.push(part);
  };
  walk(expression);
  return found;
}

/**
 * An Atlas query with each old status it compares with written as the one it
 * becomes, in place: only the value's own characters change, so the rest of
 * the text — its spacing, its comments' worth of layout — stays as typed.
 *
 * A query that does not read, or lists types other than tasks, is not the
 * migration's to judge, and is left alone.
 */
export function rewrittenQuery({
  text,
  mapping,
}: {
  text: string;
  mapping: StatusMapping;
}): { text: string; moved: readonly string[] } | { problem: string } | null {
  let query;
  try {
    query = parseAtlasQuery(text);
  } catch {
    // A query that does not read cannot be judged; the view already shows why it does not run.
    return null;
  }
  const types = query.from.map((name) => name.text.trim().toLowerCase());
  if (!types.includes(TASK_TYPE)) return null;

  const replacements: Replacement[] = [];
  const moved: string[] = [];
  for (const { op, value } of statusComparisons(query.where)) {
    if (value.kind !== 'text' || isGtdStatus(value.text)) continue;
    if (!CARRIED.has(op)) return { problem: uncarried(value.text, op) };
    const to = mappedStatus(mapping, value.text);
    replacements.push({ ...value.span, text: printValue({ ...value, text: to }) });
    moved.push(moveLine(value.text, to));
  }
  if (replacements.length === 0) return null;
  const rewritten = replacements
    .sort((left, right) => right.start - left.start)
    .reduce((at, { start, end, text: put }) => at.slice(0, start) + put + at.slice(end), text);
  return { text: rewritten, moved };
}

/** A view's `filters:` list with each old status it filters by moved on. */
function rewrittenFilters(filters: readonly unknown[], mapping: StatusMapping): StatusRewrite {
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
    const operator = String(filter['operator'] ?? '');
    if (!CARRIED.has(operator)) return { problem: uncarried(value, operator) };
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
export function viewStatusRewrite(frontmatter: Properties, mapping: StatusMapping): StatusRewrite {
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
    const rewritten = rewrittenQuery({ text: query, mapping });
    if (rewritten === null || 'problem' in rewritten) return rewritten;
    return { changes: { [QUERY_VIEW_KEY]: rewritten.text }, moved: rewritten.moved };
  }
  const type = String(frontmatter['type'] ?? '')
    .trim()
    .toLowerCase();
  const filters = frontmatter['filters'];
  if (type !== TASK_TYPE || !Array.isArray(filters)) return null;
  return rewrittenFilters(filters, mapping);
}

/**
 * What the migration does to an automation: the old statuses in `which:`
 * moved on, and a status it sets, when it sets one on tasks.
 */
export function automationStatusRewrite(
  frontmatter: Properties,
  mapping: StatusMapping,
): StatusRewrite {
  if (!isAutomationNote(frontmatter)) return null;
  const which = typeof frontmatter['which'] === 'string' ? frontmatter['which'] : '';
  const query = rewrittenQuery({ text: which, mapping });
  if (query !== null && 'problem' in query) return query;
  const changes: Record<string, unknown> = query === null ? {} : { which: query.text };
  const moved = [...(query?.moved ?? [])];

  const set = frontmatter['set'];
  const setStatus = isRecord(set) ? set[TASK_KEYS.status] : undefined;
  if (
    isRecord(set) &&
    setsTasks(which) &&
    typeof setStatus === 'string' &&
    !isGtdStatus(setStatus)
  ) {
    const to = mappedStatus(mapping, setStatus);
    changes['set'] = { ...set, [TASK_KEYS.status]: to };
    moved.push(`sets ${moveLine(setStatus, to)}`);
  }
  return moved.length === 0 ? null : { changes, moved };
}

/** Whether a rule's notes are tasks: its query reads, and lists tasks. */
function setsTasks(which: string): boolean {
  try {
    const types = parseAtlasQuery(which).from.map((name) => name.text.trim().toLowerCase());
    return types.includes(TASK_TYPE);
  } catch {
    // A rule whose query does not read never runs, so what it sets moves nothing.
    return false;
  }
}
