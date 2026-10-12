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
 * Each section is an Atlas query (ADR-0019) in which `this` is the page,
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
 * The most notes one section asks the index for: a person in hundreds of
 * meetings costs one bounded query, and the heading says there are more.
 */
export const LINKED_SECTION_LIMIT = 200;

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
  /** Its rows are waiting-fors: each says how long it has waited, read from `modified`. */
  readonly waited: boolean;
  /** Its rows are a project's or an area's open tasks, which should hold a next action. */
  readonly wantsNextAction: boolean;
  /** Whether a row says what type of note it is: only where the section mixes types. */
  readonly showsType: boolean;
}

/** A field or type name a query can spell bare. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

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

/**
 * The relations of `type` a query can hop through to a `target` note's own
 * fields — `waiting_on.company` — which takes a relation to that type alone.
 */
function hopKeys(type: ObjectType, target: string): string[] {
  return type.properties
    .filter((own) => {
      const targets = relationTypes(own);
      return own.kind === 'relation' && IDENTIFIER.test(own.key) && targets.length === 1;
    })
    .filter((own) => relationTypes(own)[0] === target)
    .map((own) => own.key);
}

const anyOf = (conditions: readonly string[]): string =>
  conditions.length === 1 ? (conditions[0] ?? '') : `(${conditions.join(' OR ')})`;

/**
 * `type`'s notes that point at the page through a relation made for it —
 * `people = this` — or, when the type declares none, through any link at all.
 */
function pointsAtPage(type: ObjectType, page: ObjectType): string {
  const keys = relationKeys(type, page.name);
  return keys.length === 0 ? THIS_PAGE : anyOf(keys.map((key) => `${key} = this`));
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
  /** The field recency is judged by; null where the section has no recent. */
  readonly recentBy?: string;
  readonly rest: string;
  readonly waited?: boolean;
  readonly wantsNextAction?: boolean;
  readonly showsType?: boolean;
}

function plan(section: Section): LinkedSectionPlan {
  const text = (where: readonly string[]) =>
    `FROM ${section.from.join(', ')} WHERE ${where.join(' AND ')} ${section.rest} LIMIT ${LINKED_SECTION_LIMIT}`;
  const { recentBy } = section;
  return {
    id: section.id,
    title: section.title,
    query: text(section.where),
    recentQuery:
      recentBy === undefined ? null : text([...section.where, `${recentBy} >= @-${RECENT_DAYS}d`]),
    waited: section.waited ?? false,
    wantsNextAction: section.wantsNextAction ?? false,
    showsType: section.showsType ?? false,
  };
}

/** The dated notes of `type` joined to the page by `where`, newest first. */
function dated(
  section: Pick<Section, 'id' | 'title'>,
  type: ObjectType | null,
  where: (type: ObjectType) => string,
): LinkedSectionPlan[] {
  if (type === null) return [];
  const date = dateField(type);
  return [
    plan({
      ...section,
      from: [type.name],
      where: [where(type)],
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

/** Every other kind of note linked with the page, most recently changed first. */
function noteSection(types: Types, listed: readonly (ObjectType | null)[]): LinkedSectionPlan[] {
  const taken = new Set(listed.map((type) => type?.name));
  const others = types.filter(
    (type) =>
      IDENTIFIER.test(type.name) &&
      !taken.has(type.name) &&
      type.name.trim().toLowerCase() !== PROPOSAL_TYPE,
  );
  if (others.length === 0) return [];
  return [
    plan({
      id: 'notes',
      title: 'Linked notes',
      from: others.map((type) => type.name),
      where: [THIS_PAGE],
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
  where: (type: ObjectType) => string;
  shows: readonly string[];
}): LinkedSectionPlan[] {
  if (type === null) return [];
  return [
    plan({
      ...section,
      from: [type.name],
      where: [where(type)],
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

function personSections(vault: Vault): LinkedSectionPlan[] {
  const { page, task } = vault;
  return [
    ...dated(MEETINGS, vault.meeting, (meeting) => pointsAtPage(meeting, page)),
    ...taskSections({
      task,
      joined: THIS_PAGE,
      waitingFors: { kind: 'on', who: `${TASK_KEYS.waitingOn} = this` },
    }),
    ...dated(DECISIONS, vault.decision, () => THIS_PAGE),
    ...noteSection(vault.types, [vault.meeting, task?.type ?? null, vault.decision]),
  ];
}

function companySections(vault: Vault): LinkedSectionPlan[] {
  const { page, task, person } = vault;
  const employers = person === null ? [] : relationKeys(person, page.name);
  // A task about one of its people: any relation of the task to a person at the company.
  const theirs = (keys: readonly string[]) =>
    keys.flatMap((key) => employers.map((employer) => `${key}.${employer} = this`));
  const onPeople = task === null || person === null ? [] : hopKeys(task.type, person.name);
  const waitingOn = theirs(onPeople.filter((key) => key === TASK_KEYS.waitingOn));
  return [
    ...named({
      section: PEOPLE,
      type: person,
      where: (people) => pointsAtPage(people, page),
      shows: ['role'],
    }),
    ...dated(MEETINGS, vault.meeting, (meeting) => pointsAtPage(meeting, page)),
    ...taskSections({
      task,
      joined: anyOf([THIS_PAGE, ...theirs(onPeople)]),
      waitingFors:
        waitingOn.length === 0 ? { kind: 'none' } : { kind: 'on', who: anyOf(waitingOn) },
    }),
    ...named({ section: PROJECTS, type: vault.project, where: () => THIS_PAGE, shows: ['status'] }),
    ...dated(DECISIONS, vault.decision, () => THIS_PAGE),
    ...noteSection(vault.types, [
      person,
      vault.meeting,
      task?.type ?? null,
      vault.project,
      vault.decision,
    ]),
  ];
}

/** A project's or an area's page: what is filed under it. */
function filedSections(vault: Vault): LinkedSectionPlan[] {
  const { page, task } = vault;
  const isArea = page.name.trim().toLowerCase() === AREA_TYPE;
  const filed = (type: ObjectType) => pointsAtPage(type, page);
  return [
    ...taskSections({
      task,
      joined: task === null ? THIS_PAGE : filed(task.type),
      waitingFors: { kind: 'filed' },
      wantsNextAction: true,
    }),
    ...(isArea
      ? named({ section: PROJECTS, type: vault.project, where: filed, shows: ['status'] })
      : []),
    ...dated(MEETINGS, vault.meeting, filed),
    ...dated(DECISIONS, vault.decision, filed),
    ...noteSection(vault.types, [
      vault.meeting,
      task?.type ?? null,
      vault.decision,
      ...(isArea ? [vault.project] : []),
    ]),
  ];
}

/** A meeting's page: who was in it, and what came out of it — whichever of the two holds the link. */
function meetingSections(vault: Vault): LinkedSectionPlan[] {
  const { task, person, company } = vault;
  const employer = person === null || company === null ? [] : relationKeys(person, company.name);
  return [
    ...named({
      section: PEOPLE,
      type: person,
      where: () => THIS_PAGE,
      shows: [...employer.slice(0, 1), 'role'],
    }),
    ...named({
      section: { id: 'companies', title: 'Companies' },
      type: company,
      where: () => THIS_PAGE,
      shows: [],
    }),
    ...(task === null
      ? []
      : [
          plan({
            id: 'tasks',
            title: 'Tasks from this meeting',
            from: [task.type.name],
            where: [THIS_PAGE],
            rest: `${taskOrder(task.type)} ${show(task.type, [task.status, TASK_KEYS.waitingOn, TASK_KEYS.due])}`,
          }),
        ]),
    ...named({
      section: { id: 'decisions', title: 'Decisions from this meeting' },
      type: vault.decision,
      where: () => THIS_PAGE,
      shows: [],
    }),
  ];
}

/** A task's or a decision's page: the meeting it came from, or that lists it. */
function sourceSections(vault: Vault): LinkedSectionPlan[] {
  if (vault.meeting === null) return [];
  const date = dateField(vault.meeting);
  return [
    plan({
      id: 'meetings',
      title: 'From meeting',
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

/** Whether notes of this type show linked sections: the page types P30-06 names. */
export function isLinkedPageType(typeName: string | null): boolean {
  return typeName !== null && Object.hasOwn(SECTIONS, typeName.trim().toLowerCase());
}

/**
 * The sections a page of type `typeName` shows, in order, written from the
 * vault's own types. None for a type that is not a linked page, or that the
 * vault does not declare.
 */
export function linkedSectionPlans(typeName: string | null, types: Types): LinkedSectionPlan[] {
  if (typeName === null) return [];
  const name = typeName.trim().toLowerCase();
  const page = typeNamed(types, name);
  if (page === null || !Object.hasOwn(SECTIONS, name)) return [];
  const sections = SECTIONS[name];
  if (sections === undefined) return [];
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
