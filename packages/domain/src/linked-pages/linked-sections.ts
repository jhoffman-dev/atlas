import { addDays } from '../timeline/timeline.ts';
import { TASK_KEYS, TASK_TYPE, WAITING_STATUS } from '../gtd/gtd-status.ts';
import { MEETING_TYPE } from '../meetings/meeting-header.ts';
import { COMPANY_TYPE } from '../people/company.ts';
import { PERSON_TYPE } from '../people/person.ts';
import { DECISION_TYPE, PROPOSAL_TYPE } from '../proposals/proposal.ts';
import { NO_SPAN } from '../query-language/ast.ts';
import { printValue } from '../query-language/print.ts';
import { AREA_TYPE, PROJECT_TYPE } from '../types/para.ts';
import { relationTypes, type ObjectType, type PropertyDef } from '../types/property-def.ts';
import { statusOf } from '../types/status-property.ts';

/*
 * Linked pages (P30-06): what a Person, Company, Project, Area or Meeting
 * page shows about itself without a word being written into it — its
 * meetings, its open tasks, who it is waiting on, its decisions and the notes
 * linked with it — and what a Task or Decision shows of the meeting it came
 * from.
 *
 * Each section is a DFAI query (ADR-0019) in which `this` is the page,
 * written here from the vault's own types: a section names only fields the
 * types declare, so a vault whose Meeting has no `people` still gets its
 * meetings (by any link), and one with no Decision type gets no Decisions
 * section rather than a query that cannot be checked.
 */

/** Whether a section lists everything, or only the last {@link RECENT_DAYS} days. */
export type LinkedRange = 'recent' | 'all';

export const LINKED_RANGES: readonly LinkedRange[] = ['recent', 'all'];

/** What a section with a date shows until it is asked for everything. */
export const DEFAULT_LINKED_RANGE: LinkedRange = 'recent';

/** How far back "recent" reaches. */
export const RECENT_DAYS = 30;

/**
 * The most notes one section holds: a person in hundreds of meetings costs
 * one bounded query, and the heading says there are more.
 */
export const LINKED_SECTION_LIMIT = 200;

/**
 * How many rows a section's query asks for: two past what it holds. One may
 * be the page itself, which a relation can name and no section lists; the
 * other says whether there are more, since the index only says so past its
 * own, far larger, cap.
 */
export const LINKED_FETCH_LIMIT = LINKED_SECTION_LIMIT + 2;

/** How many rows a section draws before **Show more**. */
export const LINKED_ROWS_SHOWN = 8;

export type LinkedSectionId =
  'people' | 'companies' | 'projects' | 'meetings' | 'waiting' | 'tasks' | 'decisions' | 'notes';

/** One section of a linked page, as a query to run with `this` naming the page. */
export interface LinkedSectionPlan {
  readonly id: LinkedSectionId;
  readonly title: string;
  /** The query for everything the section can hold. */
  readonly query: string;
  /** The same, kept to the last {@link RECENT_DAYS} days; null where recency means nothing. */
  readonly recentQuery: string | null;
  /**
   * The same, kept to the {@link RECENT_DAYS} days up to and including `day`
   * rather than up to the index's today; null where recency means nothing.
   */
  readonly recentQueryOn: ((day: string) => string) | null;
  /** Its rows are waiting-fors: each says how long it has waited, read from `modified`. */
  readonly waited: boolean;
  /** Its rows are a project's open tasks, which should hold a next action while it is active. */
  readonly wantsNextAction: boolean;
  /** Whether a row says what type of note it is: only where the section mixes types. */
  readonly showsType: boolean;
}

/** A field or type name a query can spell bare. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Whether a property key is one the query language can name: the only keys a linked page reads. */
export function isQueryIdentifier(key: string): boolean {
  return IDENTIFIER.test(key);
}

const THIS_PAGE = 'CONNECTED TO this';

type Types = readonly ObjectType[];

/** The vault's type of that name — in any case, as built-ins are known — when a query can name it. */
function typeNamed(types: Types, name: string): ObjectType | null {
  const found = types.find((type) => type.name.trim().toLowerCase() === name);
  return found !== undefined && IDENTIFIER.test(found.name) ? found : null;
}

function property(type: ObjectType, key: string, kind: PropertyDef['kind']): PropertyDef | null {
  return type.properties.find((own) => own.key === key && own.kind === kind) ?? null;
}

/** The relations of `type` that may point at a note of type `target`, by key. */
function relationKeys(type: ObjectType, target: string): string[] {
  return type.properties
    .filter(
      (own) =>
        own.kind === 'relation' && IDENTIFIER.test(own.key) && relationTypes(own).includes(target),
    )
    .map((own) => own.key);
}

const anyOf = (conditions: readonly string[]): string =>
  conditions.length === 1 ? (conditions[0] ?? '') : `(${conditions.join(' OR ')})`;

/** How a type's notes belong to the page: the condition, and the relations it compares. */
interface Joined {
  readonly where: string;
  /** The type's own relations the condition names; none when any link joins them. */
  readonly keys: readonly string[];
}

const ANY_LINK: Joined = { where: THIS_PAGE, keys: [] };

/**
 * `type`'s notes that point at the page through a relation made for it —
 * `people = this` — or, when the type declares none, through any link at all.
 */
function pointsAtPage(type: ObjectType, page: ObjectType): Joined {
  const keys = relationKeys(type, page.name);
  if (keys.length === 0) return ANY_LINK;
  return { where: anyOf(keys.map((key) => `${key} = this`)), keys };
}

const present = (words: readonly (string | null)[]): string[] =>
  words.filter((said): said is string => said !== null);

const word = (text: string): string => printValue({ kind: 'text', text, span: NO_SPAN });

/** The date a type's notes are dated by: its own `date`, or when the file last changed. */
function dateField(type: ObjectType): string {
  return property(type, 'date', 'date') === null ? 'modified' : 'date';
}

/** The fields of `wanted` the type declares, as a `SHOW`; `title` — nothing more — when none. */
function show(
  type: ObjectType,
  wanted: readonly (string | null)[],
  extra: readonly string[] = [],
): string {
  const declared = present(wanted).filter((key) => type.properties.some((own) => own.key === key));
  const shown = [...declared, ...extra];
  return `SHOW ${shown.length === 0 ? 'title' : shown.join(', ')}`;
}

interface Section {
  readonly id: LinkedSectionId;
  readonly title: string;
  readonly from: readonly string[];
  readonly where: readonly string[];
  /** The field recency is judged by; left out where the section has no recent. */
  readonly recentBy?: string;
  readonly rest: string;
  readonly waited?: boolean;
  readonly wantsNextAction?: boolean;
  readonly showsType?: boolean;
}

/**
 * Recent: dated within {@link RECENT_DAYS} days — or, for a note's own
 * `date`, not dated at all. A meeting nobody dated is not an old one, and
 * hidden until All is pressed it would look as if it were not there.
 */
function recently(field: string): string {
  const within = `${field} >= @-${RECENT_DAYS}d`;
  return field === 'modified' ? within : `(${within} OR ${field} IS EMPTY)`;
}

/** `recently`, counted back from a day the caller names rather than the index's today. */
function recentlyOn(field: string, day: string): string {
  const since = addDays(day, -RECENT_DAYS);
  const within = `${field} >= ${since}`;
  return field === 'modified'
    ? `${within} AND ${field} < ${addDays(day, 1)}`
    : `(${within} OR ${field} IS EMPTY)`;
}

function plan(section: Section): LinkedSectionPlan {
  const text = (where: readonly string[]) =>
    `FROM ${section.from.join(', ')} WHERE ${where.join(' AND ')} ${section.rest} LIMIT ${LINKED_FETCH_LIMIT}`;
  const { recentBy } = section;
  return {
    id: section.id,
    title: section.title,
    query: text(section.where),
    recentQuery: recentBy === undefined ? null : text([...section.where, recently(recentBy)]),
    recentQueryOn:
      recentBy === undefined ? null : (day) => text([...section.where, recentlyOn(recentBy, day)]),
    waited: section.waited ?? false,
    wantsNextAction: section.wantsNextAction ?? false,
    showsType: section.showsType ?? false,
  };
}

/** The dated notes of `type` joined to the page, newest first, the undated last. */
function dated(
  section: Pick<Section, 'id' | 'title'>,
  type: ObjectType | null,
  joined: Joined,
): LinkedSectionPlan[] {
  if (type === null) return [];
  const date = dateField(type);
  return [
    plan({
      ...section,
      from: [type.name],
      where: [joined.where],
      recentBy: date,
      rest: `SORT BY ${date} DESC ${date === 'date' ? 'SHOW date' : 'SHOW title'}`,
    }),
  ];
}

/** What the Task type says of open work and of waiting, as conditions a query can hold. */
interface TaskWords {
  readonly type: ObjectType;
  /** `status != archive`, or null when nothing in the type means finished. */
  readonly open: string | null;
  /** `status = waiting`, or null when the type has no such status or nobody to wait on. */
  readonly waiting: string | null;
  /** The status the tasks are grouped by, or null. */
  readonly status: string | null;
}

function taskWords(types: Types): TaskWords | null {
  const type = typeNamed(types, TASK_TYPE);
  if (type === null) return null;
  const done = statusOf(type);
  const status = done !== null && IDENTIFIER.test(done.key) ? done : null;
  const waits =
    status !== null &&
    status.options.includes(WAITING_STATUS) &&
    property(type, TASK_KEYS.waitingOn, 'relation') !== null;
  return {
    type,
    open: status === null ? null : `${status.key} != ${word(status.done)}`,
    waiting: waits && status !== null ? `${status.key} = ${WAITING_STATUS}` : null,
    status: status?.key ?? null,
  };
}

/**
 * Which waiting-fors are a page's own: those waiting `on` someone the page
 * names, every one `filed` under it whoever it waits on, or `none`.
 */
type WaitingFors =
  | { readonly kind: 'on'; readonly who: string }
  | { readonly kind: 'filed' }
  | { readonly kind: 'none' };

/** Tasks with a day they are due come first, soonest first; then by name. */
function taskOrder(type: ObjectType): string {
  return property(type, TASK_KEYS.due, 'date') === null
    ? 'SORT BY title'
    : `SORT BY ${TASK_KEYS.due}, title`;
}

/**
 * A page's waiting-fors, longest untouched first, and its other open tasks
 * under their statuses. A waiting-for is listed once: where the page has a
 * waiting section, the open tasks leave those out.
 */
function taskSections({
  task,
  joined,
  waitingFors,
  wantsNextAction = false,
}: {
  task: TaskWords | null;
  /** How a task belongs to the page. */
  joined: string;
  waitingFors: WaitingFors;
  wantsNextAction?: boolean;
}): LinkedSectionPlan[] {
  if (task === null) return [];
  const { type } = task;
  const waits = task.waiting === null || waitingFors.kind === 'none' ? null : task.waiting;
  const onWhom = waitingFors.kind === 'on' ? waitingFors.who : null;
  const mine = waits === null ? null : present([waits, onWhom]).join(' AND ');
  const waiting =
    mine === null
      ? []
      : [
          plan({
            id: 'waiting',
            title: 'Waiting for',
            from: [type.name],
            where: onWhom === null ? [joined, mine] : [mine],
            rest: `SORT BY modified ASC ${show(type, [onWhom === null ? TASK_KEYS.waitingOn : 'project'], ['modified'])}`,
            waited: true,
          }),
        ];
  const group = task.status === null ? '' : ` GROUP BY ${task.status}`;
  const tasks = plan({
    id: 'tasks',
    title: 'Open tasks',
    from: [type.name],
    where: present([joined, task.open, mine === null ? null : `NOT (${mine})`]),
    rest: `${taskOrder(type)}${group} ${show(type, [TASK_KEYS.due])}`,
    wantsNextAction,
  });
  return [...waiting, tasks];
}

/** A type with a section of its own on the page, and how its notes belong there. */
interface Listed {
  readonly type: ObjectType | null;
  readonly joined: Joined;
}

/**
 * The listed types whose notes can also be linked with the page some other
 * way than the relation their section asks — a meeting that names a person
 * only in its text — so those are not dropped: they go under Linked notes.
 *
 * A key two types declare is one field in a query, as the first declares it
 * (ADR-0019), so a type is taken only when each relation its section
 * compares is a relation to the first type here that declares the key.
 * Otherwise it is left out, as a type joined by any link already is: every
 * linked note of it is in its own section.
 */
function alsoLinked(listed: readonly Listed[]): { type: ObjectType; where: string }[] {
  const taken: { type: ObjectType; where: string }[] = [];
  for (const { type, joined } of listed) {
    if (type === null || joined.keys.length === 0) continue;
    const before = taken.map((one) => one.type);
    const asDeclared = joined.keys.every((key) => {
      const first = [...before, type].find((one) => one.properties.some((own) => own.key === key));
      return first?.properties.find((own) => own.key === key)?.kind === 'relation';
    });
    if (asDeclared) taken.push({ type, where: joined.where });
  }
  return taken;
}

/**
 * Every note linked with the page that no section above lists, most recently
 * changed first: the types with no section of their own, and the notes of a
 * listed type that link the page outside its section's relation.
 */
function noteSection(types: Types, listed: readonly Listed[]): LinkedSectionPlan[] {
  const sectioned = new Set(listed.map((one) => one.type?.name));
  const others = types.filter(
    (type) =>
      IDENTIFIER.test(type.name) &&
      !sectioned.has(type.name) &&
      type.name.trim().toLowerCase() !== PROPOSAL_TYPE,
  );
  const also = alsoLinked(listed);
  if (others.length === 0 && also.length === 0) return [];
  const elsewhere = also.map(({ type, where }) => `NOT (type = ${word(type.name)} AND ${where})`);
  return [
    plan({
      id: 'notes',
      title: 'Linked notes',
      from: [...also.map((one) => one.type.name), ...others.map((type) => type.name)],
      where: [THIS_PAGE, ...elsewhere],
      recentBy: 'modified',
      rest: 'SORT BY modified DESC SHOW title',
      showsType: true,
    }),
  ];
}

/** Notes of `type` joined to the page by `where`, by name. */
function named({
  section,
  type,
  where,
  shows,
}: {
  section: Pick<Section, 'id' | 'title'>;
  type: ObjectType | null;
  where: string;
  shows: readonly string[];
}): LinkedSectionPlan[] {
  if (type === null) return [];
  return [
    plan({
      ...section,
      from: [type.name],
      where: [where],
      rest: `SORT BY title ${show(type, shows)}`,
    }),
  ];
}

interface Vault {
  readonly types: Types;
  readonly page: ObjectType;
  readonly person: ObjectType | null;
  readonly company: ObjectType | null;
  readonly project: ObjectType | null;
  readonly meeting: ObjectType | null;
  readonly decision: ObjectType | null;
  readonly task: TaskWords | null;
}

const MEETINGS = { id: 'meetings', title: 'Meetings' } as const;
const DECISIONS = { id: 'decisions', title: 'Decisions' } as const;
const PEOPLE = { id: 'people', title: 'People' } as const;
const PROJECTS = { id: 'projects', title: 'Projects' } as const;

const anyLink = (type: ObjectType | null): Listed => ({ type, joined: ANY_LINK });

function personSections(vault: Vault): LinkedSectionPlan[] {
  const { page, task, meeting } = vault;
  const attended = meeting === null ? ANY_LINK : pointsAtPage(meeting, page);
  return [
    ...dated(MEETINGS, meeting, attended),
    ...taskSections({
      task,
      joined: THIS_PAGE,
      waitingFors: { kind: 'on', who: `${TASK_KEYS.waitingOn} = this` },
    }),
    ...dated(DECISIONS, vault.decision, ANY_LINK),
    ...noteSection(vault.types, [
      { type: meeting, joined: attended },
      anyLink(task?.type ?? null),
      anyLink(vault.decision),
    ]),
  ];
}

/**
 * A company's page. Its people are the people linked with it whichever note
 * holds the link — a person's `company`, or the company's own `employees` —
 * and what is waited on from any of them is the company's.
 */
function companySections(vault: Vault): LinkedSectionPlan[] {
  const { page, task, person, meeting } = vault;
  const onPeople = task === null || person === null ? [] : relationKeys(task.type, person.name);
  const theirs = onPeople.map((key) => `${key} ${THIS_PAGE}`);
  const waitedOn = onPeople.includes(TASK_KEYS.waitingOn)
    ? `${TASK_KEYS.waitingOn} ${THIS_PAGE}`
    : null;
  const held = meeting === null ? ANY_LINK : pointsAtPage(meeting, page);
  return [
    ...named({ section: PEOPLE, type: person, where: THIS_PAGE, shows: ['role'] }),
    ...dated(MEETINGS, meeting, held),
    ...taskSections({
      task,
      joined: anyOf([THIS_PAGE, ...theirs]),
      waitingFors: waitedOn === null ? { kind: 'none' } : { kind: 'on', who: waitedOn },
    }),
    ...named({ section: PROJECTS, type: vault.project, where: THIS_PAGE, shows: ['status'] }),
    ...dated(DECISIONS, vault.decision, ANY_LINK),
    ...noteSection(vault.types, [
      { type: meeting, joined: held },
      anyLink(person),
      anyLink(task?.type ?? null),
      anyLink(vault.project),
      anyLink(vault.decision),
    ]),
  ];
}

/** A project's or an area's page: what is filed under it. */
function filedSections(vault: Vault): LinkedSectionPlan[] {
  const { page, task, meeting, decision, project } = vault;
  const isArea = page.name.trim().toLowerCase() === AREA_TYPE;
  const filed = (type: ObjectType | null): Listed => ({
    type,
    joined: type === null ? ANY_LINK : pointsAtPage(type, page),
  });
  const listed = {
    task: filed(task?.type ?? null),
    meeting: filed(meeting),
    decision: filed(decision),
    project: filed(project),
  };
  return [
    ...taskSections({
      task,
      joined: listed.task.joined.where,
      waitingFors: { kind: 'filed' },
      // An area is never finished, so nothing says it should be moving (P30-07).
      wantsNextAction: !isArea,
    }),
    ...(isArea
      ? named({
          section: PROJECTS,
          type: project,
          where: listed.project.joined.where,
          shows: ['status'],
        })
      : []),
    ...dated(MEETINGS, meeting, listed.meeting.joined),
    ...dated(DECISIONS, decision, listed.decision.joined),
    ...noteSection(vault.types, [
      listed.task,
      listed.meeting,
      listed.decision,
      ...(isArea ? [listed.project] : []),
    ]),
  ];
}

/**
 * A meeting's page: who was in it, and the tasks and decisions linked with
 * it — by any link, whichever of the two holds it, so one made from the
 * meeting and one that merely mentions it are both here.
 */
function meetingSections(vault: Vault): LinkedSectionPlan[] {
  const { task, person, company } = vault;
  const employer = person === null || company === null ? [] : relationKeys(person, company.name);
  return [
    ...named({
      section: PEOPLE,
      type: person,
      where: THIS_PAGE,
      shows: [...employer.slice(0, 1), 'role'],
    }),
    ...named({
      section: { id: 'companies', title: 'Companies' },
      type: company,
      where: THIS_PAGE,
      shows: [],
    }),
    ...(task === null
      ? []
      : [
          plan({
            id: 'tasks',
            title: 'Tasks',
            from: [task.type.name],
            where: [THIS_PAGE],
            rest: `${taskOrder(task.type)} ${show(task.type, [task.status, TASK_KEYS.waitingOn, TASK_KEYS.due])}`,
          }),
        ]),
    ...named({ section: DECISIONS, type: vault.decision, where: THIS_PAGE, shows: [] }),
  ];
}

/** A task's or a decision's page: the meetings linked with it, the one it came from among them. */
function sourceSections(vault: Vault): LinkedSectionPlan[] {
  if (vault.meeting === null) return [];
  const date = dateField(vault.meeting);
  return [
    plan({
      ...MEETINGS,
      from: [vault.meeting.name],
      where: [THIS_PAGE],
      rest: `SORT BY ${date} DESC ${date === 'date' ? 'SHOW date' : 'SHOW title'}`,
    }),
  ];
}

const SECTIONS: Readonly<Record<string, (vault: Vault) => LinkedSectionPlan[]>> = {
  [PERSON_TYPE]: personSections,
  [COMPANY_TYPE]: companySections,
  [PROJECT_TYPE]: filedSections,
  [AREA_TYPE]: filedSections,
  [MEETING_TYPE]: meetingSections,
  [TASK_TYPE]: sourceSections,
  [DECISION_TYPE]: sourceSections,
};

/** A type's name as linked pages know it: `Person ` is `person`. */
export function linkedPageType(typeName: string): string {
  return typeName.trim().toLowerCase();
}

/** Whether notes of this type show linked sections: the page types P30-06 names. */
export function isLinkedPageType(typeName: string | null): boolean {
  return typeName !== null && Object.hasOwn(SECTIONS, linkedPageType(typeName));
}

/**
 * The sections a page of type `typeName` shows, in order, written from the
 * vault's own types. None for a type that is not a linked page, or that the
 * vault does not declare.
 */
export function linkedSectionPlans(typeName: string | null, types: Types): LinkedSectionPlan[] {
  if (typeName === null) return [];
  const name = linkedPageType(typeName);
  const page = typeNamed(types, name);
  const sections = Object.hasOwn(SECTIONS, name) ? SECTIONS[name] : undefined;
  if (page === null || sections === undefined) return [];
  return sections({
    types,
    page,
    person: typeNamed(types, PERSON_TYPE),
    company: typeNamed(types, COMPANY_TYPE),
    project: typeNamed(types, PROJECT_TYPE),
    meeting: typeNamed(types, MEETING_TYPE),
    decision: typeNamed(types, DECISION_TYPE),
    task: taskWords(types),
  });
}
