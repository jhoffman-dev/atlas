import type { CsvRow } from './notion-csv.ts';
import { notionWhen } from './notion-date.ts';
import { readOptions, readRelation, type RelationEntry } from './notion-relations.ts';
import { taskState, type GtdStatus } from './task-status.ts';

/** The Notion databases this import knows, by what they hold. */
export const DATABASE_KINDS = [
  'tasks',
  'notes',
  'meetings',
  'people',
  'para',
  'teams',
  'daily',
] as const;

export type DatabaseKind = (typeof DATABASE_KINDS)[number];

/** A database's name as compared: its words, lower case, without the emoji or marks a title may carry. */
const comparedName = (name: string) =>
  name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

const NAMES: ReadonlyMap<string, DatabaseKind> = new Map([
  ['tasks', 'tasks'],
  ['tasks tracker', 'tasks'],
  ['task tracker', 'tasks'],
  ['notes', 'notes'],
  ['meeting notes', 'meetings'],
  ['meetings', 'meetings'],
  ['people', 'people'],
  ['para', 'para'],
  ['teams', 'teams'],
  ['daily notes', 'daily'],
  ['daily', 'daily'],
]);

/** The kind of database a Notion export's CSV holds, by the database's name; null for one this import does not know. */
export const databaseKind = (name: string): DatabaseKind | null =>
  NAMES.get(comparedName(name)) ?? null;

/** Where a note of each kind goes in the vault, and the type it is. */
export const PLACES = {
  tasks: { folder: 'Tasks', type: 'task' },
  notes: { folder: 'Notes', type: 'notes' },
  people: { folder: 'People', type: 'person' },
  teams: { folder: 'Teams', type: 'team' },
  daily: { folder: 'Daily', type: 'daily' },
  project: { folder: 'Projects', type: 'project' },
  area: { folder: 'Areas', type: 'area' },
  resource: { folder: 'Resources', type: 'resource' },
  archive: { folder: 'Archive', type: 'project' },
} as const;

/** Where a note goes and what it is. */
export interface Place {
  readonly folder: string;
  readonly type: string;
}

/** How a column's cell becomes a property: as text, a list of options, a date, or links to other notes. */
type ValueKind = 'text' | 'options' | 'date' | 'link' | 'links';

type ColumnRule =
  | { readonly key: string; readonly kind: ValueKind }
  | { readonly special: 'status' | 'para-type' }
  | { readonly skip: string };

const BACK_LINK = { skip: 'it links back here, and Atlas shows that as a backlink' };
const property = (key: string, kind: ValueKind) => ({ key, kind });

/** Each kind's columns, by name in lower case. A column not named here is listed, not imported. */
const COLUMN_RULES: Readonly<
  Record<Exclude<DatabaseKind, 'meetings'>, Record<string, ColumnRule>>
> = {
  tasks: {
    status: { special: 'status' },
    priority: property('priority', 'text'),
    effort: property('effort', 'text'),
    'task type': property('task_type', 'text'),
    tags: property('tags', 'options'),
    'due date': property('due', 'date'),
    due: property('due', 'date'),
    project: property('project', 'link'),
    people: property('people', 'links'),
    note: property('notes', 'links'),
    notes: property('notes', 'links'),
  },
  notes: {
    tags: property('tags', 'options'),
    date: property('date', 'date'),
    project: property('project', 'link'),
    people: property('people', 'links'),
    tasks: property('tasks', 'links'),
    related: property('related', 'links'),
    'back links': BACK_LINK,
  },
  people: {
    email: property('email', 'text'),
    slack: property('slack', 'text'),
    role: property('role', 'text'),
    team: property('team', 'link'),
    tasks: BACK_LINK,
    notes: BACK_LINK,
    'meeting notes': BACK_LINK,
  },
  para: {
    type: { special: 'para-type' },
    priority: property('priority', 'text'),
    'start date': property('start', 'date'),
    'end date': property('end', 'date'),
    tasks: BACK_LINK,
    notes: BACK_LINK,
    'meeting notes': BACK_LINK,
  },
  teams: { people: BACK_LINK },
  daily: {
    date: property('date', 'date'),
    tags: property('tags', 'options'),
  },
};

/** A kind whose rows this import writes itself: every kind but meetings, which the P28-07 importer brings in. */
export type NoteKind = keyof typeof COLUMN_RULES;

const ruleOf = (kind: NoteKind, column: string): ColumnRule | undefined =>
  COLUMN_RULES[kind][column.trim().toLowerCase()];

/** The columns of a database that are not imported, and why, for the report. The first is the title. */
export function columnsLeftOut(kind: NoteKind, columns: readonly string[]): string[] {
  return columns.slice(1).flatMap((column) => {
    const rule = ruleOf(kind, column);
    if (rule === undefined) return [`"${column}": not a column this import maps`];
    return 'skip' in rule ? [`"${column}": ${rule.skip}`] : [];
  });
}

/** A link to a page, as written into a property, and whether the page is in the export or the vault. */
export interface ResolvedLink {
  readonly link: string;
  readonly known: boolean;
}

/** Everything a row's note is made from. */
export interface RowContext {
  readonly kind: NoteKind;
  readonly columns: readonly string[];
  readonly row: CsvRow;
  readonly resolve: (entry: RelationEntry) => ResolvedLink;
  readonly statuses: ReadonlyMap<string, GtdStatus>;
  /** The day of the run, `YYYY-MM-DD`. */
  readonly today: string;
}

/** What a row should come to in the vault. */
export interface WantedNote {
  readonly place: Place;
  /** The properties the import keeps in step with Notion, in order. */
  readonly fields: Readonly<Record<string, unknown>>;
  /** Properties set only where the note has none: never changed once there. */
  readonly fillOnly: Readonly<Record<string, unknown>>;
  /** What the report should say about the row. */
  readonly notes: readonly string[];
}

const ISO_DAY = /^(\d{4}-\d{2}-\d{2})/;

/** A date cell's day, or null with a note when Notion wrote it some way that cannot be read. */
function dayOf(column: string, cell: string, notes: string[]): string | null {
  const day = ISO_DAY.exec(notionWhen(cell).date)?.[1];
  if (day !== undefined) return day;
  notes.push(`${column} "${cell}" is not a date this import reads: set its format to Full date`);
  return null;
}

/** The links a relation cell names, each noted when its page is in neither the export nor the vault. */
function linksOf(column: string, cell: string, context: RowContext, notes: string[]): string[] {
  return readRelation(cell).map((entry) => {
    const { link, known } = context.resolve(entry);
    if (!known) notes.push(`${column}: "${entry.title}" is not in the export; linked by its name`);
    return link;
  });
}

/** A cell as the value its rule writes; null for an empty cell, which writes nothing. */
function valueOf(
  rule: { readonly kind: ValueKind },
  column: string,
  context: RowContext,
  notes: string[],
): unknown {
  const cell = (context.row.get(column) ?? '').trim();
  if (cell === '') return null;
  switch (rule.kind) {
    case 'text':
      return cell;
    case 'options':
      return readOptions(cell);
    case 'date':
      return dayOf(column, cell, notes);
    case 'links':
      return linksOf(column, cell, context, notes);
    case 'link': {
      const links = linksOf(column, cell, context, notes);
      return links.length === 1 ? links[0] : links;
    }
  }
}

/** Each mapped column's property, in the CSV's order, empty ones left out. */
function mappedFields(context: RowContext, notes: string[]): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const column of context.columns.slice(1)) {
    const rule = ruleOf(context.kind, column);
    if (rule === undefined || !('kind' in rule)) continue;
    const value = valueOf(rule, column, context, notes);
    if (value !== null && fields[rule.key] === undefined) fields[rule.key] = value;
  }
  return fields;
}

/** What a row is read from: its database's kind and columns, and its cells. */
type RowCells = Pick<RowContext, 'kind' | 'columns' | 'row'>;

/** The column the special rule reads, by name; '' when the database has none. */
function specialCell(context: RowCells, special: 'status' | 'para-type'): string {
  const column = context.columns.find((each) => {
    const rule = ruleOf(context.kind, each);
    return rule !== undefined && 'special' in rule && rule.special === special;
  });
  return column === undefined ? '' : (context.row.get(column) ?? '').trim();
}

/** A row's place, and whether PARA filed it as finished: its Archive. */
type RowPlace = Place & { readonly done?: true };

/** A PARA row's place by its Type; a row of no Type this import knows is a project, noted. */
function paraPlace(type: string, notes: string[]): RowPlace {
  const known = type.toLowerCase();
  if (known === 'area' || known === 'resource' || known === 'project') return PLACES[known];
  if (known === 'archive') return { ...PLACES.archive, done: true };
  const which = type === '' ? 'no Type' : `Type "${type}", not Area, Project, Resource or Archive`;
  notes.push(`${which}: imported as a project`);
  return PLACES.project;
}

/** Where a row's note goes and what type it is: by its database, and for PARA by its Type. */
export function placeOf(context: RowCells, notes: string[] = []): RowPlace {
  if (context.kind === 'para') return paraPlace(specialCell(context, 'para-type'), notes);
  return PLACES[context.kind];
}

/** A task's fields with its status read the GTD way (issue #79): status, who it waits on, when it was done. */
function taskFields(context: RowContext, fields: Record<string, unknown>, notes: string[]) {
  const people = fields['people'];
  const notionStatus = specialCell(context, 'status');
  const state = taskState(
    {
      notionStatus,
      firstPerson: Array.isArray(people) ? (people[0] as string) : null,
      due: typeof fields['due'] === 'string' ? fields['due'] : null,
      today: context.today,
    },
    context.statuses,
  );
  if (state.note !== null) notes.push(state.note);
  const gtd = {
    status: state.status,
    ...(notionStatus === '' ? {} : { notion_status: notionStatus }),
    ...(state.waitingOn === null ? {} : { waiting_on: state.waitingOn }),
  };
  const fillOnly = {
    ...(state.completed === null ? {} : { completed: state.completed }),
    ...(state.scheduled === null ? {} : { scheduled: state.scheduled }),
  };
  return { fields: { ...gtd, ...fields }, fillOnly };
}

const STAMP = { source: 'notion' } as const;

/**
 * The note a row of a Notion database should be: where it goes, its type,
 * and its properties, relations written as links to the names Atlas gives
 * their notes. The page's id is kept as `notion_id`, which is how a later
 * run finds the note wherever it was moved.
 */
export function wantedNote(context: RowContext, notionId: string): WantedNote {
  const notes: string[] = [];
  const fields = mappedFields(context, notes);
  const ids = { ...STAMP, notion_id: notionId };
  const { done, ...place } = placeOf(context, notes);
  if (context.kind === 'tasks') {
    const task = taskFields(context, fields, notes);
    return {
      place,
      fields: { type: place.type, ...task.fields, ...ids },
      fillOnly: task.fillOnly,
      notes,
    };
  }
  const status = done === true ? { status: 'done' } : {};
  return { place, fields: { type: place.type, ...status, ...fields, ...ids }, fillOnly: {}, notes };
}
