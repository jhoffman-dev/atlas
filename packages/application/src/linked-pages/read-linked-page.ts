import {
  DEFAULT_LINKED_RANGE,
  groupResultRows,
  inWorkOrder,
  LINKED_SECTION_LIMIT,
  linkedSectionPlans,
  nextActionHint,
  optionLabel,
  resultFields,
  sectionRows,
  toBoardRows,
  WAITED_FIELD,
  withDaysWaited,
  type BoardRow,
  type FieldKind,
  type LinkedRange,
  type LinkedSectionId,
  type LinkedSectionPlan,
  type ObjectType,
  type RowGroup,
} from '@dfai/domain';
import type { IndexPort } from '../index/ports.ts';
import type { Clock } from '../ports.ts';
import { AtlasQueryError, runAtlasQuery, type AtlasQueryAnswer } from '../query/run-atlas-query.ts';

/** A column a section's rows are drawn with, after each note's name. */
export interface LinkedField {
  readonly key: string;
  readonly label: string;
  readonly kind: FieldKind;
}

/** One section of a linked page (P30-06), answered. */
export interface LinkedSection {
  readonly id: LinkedSectionId;
  readonly title: string;
  /** Which of recent and all it holds; null for a section recency means nothing to. */
  readonly range: LinkedRange | null;
  readonly fields: readonly LinkedField[];
  readonly rows: readonly BoardRow[];
  /** The rows under their statuses, what to do next first; empty when it does not group. */
  readonly groups: readonly RowGroup[];
  /** Whether more notes matched than the section holds. */
  readonly truncated: boolean;
  /** Said over the rows: a project with open work and nothing moving. */
  readonly hint: string | null;
  /** Why the section could not be answered, in place of its rows; null when it was. */
  readonly problem: string | null;
}

/** Which of recent and all each section of a page type was last left on, on this Mac. */
export interface LinkedRangeStore {
  read(pageType: string): Readonly<Partial<Record<LinkedSectionId, LinkedRange>>>;
  write(pageType: string, section: LinkedSectionId, range: LinkedRange): void;
}

const TYPE_KEY = 'type';
const MODIFIED_KEY = 'modified';

/**
 * What a Person, Company, Project, Area or Meeting page shows about itself,
 * and a Task or Decision of its meeting (P30-06): each section the domain
 * plans for the page's type, asked of the index as one bounded DFAI query in
 * which `this` is the page — never one per row — all at once. Nothing is read
 * from the note and nothing is written to it. A section that cannot be
 * answered says why and leaves the others standing. No sections for a type
 * that is not a linked page.
 */
export async function readLinkedPage({
  index,
  clock,
  types,
  notePaths,
  notePath,
  typeName,
  projectStatus = null,
  ranges = {},
  only = null,
  asWritten = false,
  recentOn = null,
}: {
  index: IndexPort;
  clock: Pick<Clock, 'today'>;
  types: readonly ObjectType[];
  notePaths: readonly string[];
  /** The page: the note `this` names. */
  notePath: string;
  /** The page's type, as its frontmatter says it. */
  typeName: string | null;
  /** A project page's own `status`, as written, which says whether it should be moving. */
  projectStatus?: string | null;
  /** Recent or all, for the sections last left on one; the rest are recent. */
  ranges?: Readonly<Partial<Record<LinkedSectionId, LinkedRange>>>;
  /** Only these sections, for a caller that needs no others; every section when null. */
  only?: readonly LinkedSectionId[] | null;
  /**
   * Rows as the notes write them — `next-action`, `resource` — for a caller
   * that reads them rather than draws them; as their labels when false.
   */
  asWritten?: boolean;
  /** The day "recent" counts back from, `YYYY-MM-DD`; the index's today when null. */
  recentOn?: string | null;
}): Promise<LinkedSection[]> {
  const plans = linkedSectionPlans(typeName, types).filter(
    (plan) => only === null || only.includes(plan.id),
  );
  const today = clock.today();
  const sections = await Promise.all(
    plans.map((plan) =>
      readSection({
        plan,
        range: rangeOf(plan, ranges),
        asked: { index, types, notePaths, notePath },
        today,
        asWritten,
        recentOn,
      }),
    ),
  );
  const waiting = sections.find(({ section }) => section.id === 'waiting')?.section;
  return sections.map(({ section, groupedBy }, at) =>
    plans[at]?.wantsNextAction === true && groupedBy !== null
      ? withHint({ tasks: section, statusField: groupedBy, waiting, projectStatus })
      : section,
  );
}

/** A section as answered, and the field its rows are grouped by — a task's status — if any. */
interface ReadSection {
  readonly section: LinkedSection;
  readonly groupedBy: string | null;
}

function rangeOf(
  plan: LinkedSectionPlan,
  ranges: Readonly<Partial<Record<LinkedSectionId, LinkedRange>>>,
): LinkedRange | null {
  return plan.recentQuery === null ? null : (ranges[plan.id] ?? DEFAULT_LINKED_RANGE);
}

async function readSection({
  plan,
  range,
  asked,
  today,
  asWritten,
  recentOn,
}: {
  plan: LinkedSectionPlan;
  range: LinkedRange | null;
  asked: {
    index: IndexPort;
    types: readonly ObjectType[];
    notePaths: readonly string[];
    notePath: string;
  };
  today: string;
  asWritten: boolean;
  recentOn: string | null;
}): Promise<ReadSection> {
  const head = { id: plan.id, title: plan.title, range, hint: null };
  const text = queryText({ plan, range, recentOn });
  try {
    const answer = await runAtlasQuery({ ...asked, text, thisNote: asked.notePath });
    const types = asWritten ? null : asked.types;
    const drawn = shaped({ plan, answer, today, types, page: asked.notePath });
    return {
      section: { ...head, ...drawn, problem: null },
      groupedBy: answer.compiled.groups[0]?.text ?? null,
    };
  } catch (cause) {
    // Only a query that could not be answered is the section's to say; anything else is a bug.
    if (!(cause instanceof AtlasQueryError)) throw cause;
    const unanswered = { fields: [], rows: [], groups: [], truncated: false };
    return { section: { ...head, ...unanswered, problem: cause.message }, groupedBy: null };
  }
}

/** The query for the range: the whole list, or the recent part counted from `recentOn` when given. */
function queryText({
  plan,
  range,
  recentOn,
}: {
  plan: LinkedSectionPlan;
  range: LinkedRange | null;
  recentOn: string | null;
}): string {
  if (range !== 'recent' || plan.recentQuery === null) return plan.query;
  return recentOn !== null && plan.recentQueryOn !== null
    ? plan.recentQueryOn(recentOn)
    : plan.recentQuery;
}

/** The answer as the section draws it: its rows, the columns worth a glance, and its groups. */
function shaped({
  plan,
  answer,
  today,
  types,
  page,
}: {
  plan: LinkedSectionPlan;
  answer: AtlasQueryAnswer;
  today: string;
  /** The types a row's labels are read from; null for rows as written. */
  types: readonly ObjectType[] | null;
  page: string;
}): Pick<LinkedSection, 'fields' | 'rows' | 'groups' | 'truncated'> {
  const held = sectionRows({
    rows: toBoardRows(answer.result),
    page,
    limit: LINKED_SECTION_LIMIT,
  });
  const grouped = new Set(answer.compiled.groups.map((group) => group.text));
  const shown = resultFields(answer.compiled);
  // A choice reads as its pill does — "Next Action" — except where the rows are grouped by it.
  const choices = shown
    .filter((field) => field.kind === 'select' && !grouped.has(field.key))
    .map((field) => field.key);
  const read =
    types === null
      ? held.rows
      : held.rows.map((row) => withLabels(withTypeLabel(row, types), choices));
  const rows = plan.waited ? withDaysWaited(read, today) : read;
  const fields = shown
    // A group's field is its heading; a waiting-for's `modified` is drawn as its age.
    .filter((field) => !grouped.has(field.key) && field.key !== MODIFIED_KEY)
    .filter((field) => field.key !== TYPE_KEY || plan.showsType);
  return {
    fields: plan.waited ? [...fields, WAITED_FIELD] : fields,
    rows,
    groups: inWorkOrder(groupResultRows({ rows, groups: answer.compiled.groups })),
    truncated: held.truncated || answer.result.truncated,
  };
}

/** A row with each of its `choices` — select fields — said as the option's label. */
function withLabels(row: BoardRow, choices: readonly string[]): BoardRow {
  const labelled = choices.flatMap((key) => {
    const value = row.values[key];
    return typeof value === 'string' && value !== '' ? [[key, optionLabel(value)] as const] : [];
  });
  return labelled.length === 0
    ? row
    : { ...row, values: { ...row.values, ...Object.fromEntries(labelled) } };
}

/** A row saying its type as the vault labels it — "Resource" — not as files spell it. */
function withTypeLabel(row: BoardRow, types: readonly ObjectType[]): BoardRow {
  const label = types.find((type) => type.name === row.values[TYPE_KEY])?.label;
  return label === undefined ? row : { ...row, values: { ...row.values, [TYPE_KEY]: label } };
}

/** The open tasks section, saying so when the page has open work and none of it is moving. */
function withHint({
  tasks,
  statusField,
  waiting,
  projectStatus,
}: {
  tasks: LinkedSection;
  /** The field the tasks are grouped by: their status. */
  statusField: string;
  /** The page's waiting-fors, when it has such a section. */
  waiting: LinkedSection | undefined;
  projectStatus: string | null;
}): LinkedSection {
  const waitingRead = waiting === undefined || (waiting.problem === null && !waiting.truncated);
  const hint = nextActionHint({
    projectStatus,
    statuses: tasks.rows.map((row) => row.values[statusField]),
    waiting: waiting?.rows.length ?? 0,
    complete: tasks.problem === null && !tasks.truncated && waitingRead,
  });
  return { ...tasks, hint };
}
