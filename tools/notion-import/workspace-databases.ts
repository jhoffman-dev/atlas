import type { CsvRow } from './notion-csv.ts';
import { readDay } from './notion-day.ts';
import { readOptions, readRelation, type RelationEntry } from './notion-relations.ts';
import type { GtdStatus } from '../../packages/domain/src/index.ts';
import { taskState } from './task-status.ts';

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
  /** A daily note's path is the app's own, `<YYYY-MM-DD>.md` at the root: see `dailyNotePath`. */
  daily: { folder: '', type: 'daily' },
  project: { folder: 'Projects', type: 'project' },
  area: { folder: 'Areas', type: 'area' },
  resource: { folder: 'Resources', type: 'resource' },
  /** Where archiving puts a project (`Archive/<its path>`), so unarchiving takes it back to Projects/. */
  archive: { folder: 'Archive/Projects', type: 'project' },
} as const;

/** Where a note goes and what it is. */
export interface Place {
  readonly folder: string;
  readonly type: string;
}

/** How a column's cell becomes a property: as text, a list of options, a date, or links to other notes. */
type ValueKind = 'text' | 'options' | 'date' | 'link' | 'links';

/** A column's property; a date whose cell is a range writes its end into `endKey`, where the type has one. */
interface PropertyRule {
  readonly key: string;
  readonly kind: ValueKind;
  readonly endKey?: string;
}

type ColumnRule =
  PropertyRule | { readonly special: 'status' | 'para-type' } | { readonly skip: string };

const BACK_LINK = { skip: 'it links back here, and Atlas shows that as a backlink' };
const property = (key: string, kind: ValueKind, endKey?: string): PropertyRule => ({
  key,
  kind,
  ...(endKey === undefined ? {} : { endKey }),
});

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
    'start date': property('start', 'date', 'end'),
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

/**
 * Each column's property rule, in the CSV's order, the title left out. Where
 * two columns map to one property, the first has it and the later one none.
 */
function propertyColumns(kind: NoteKind, columns: readonly string[]): Map<string, PropertyRule> {
  const claimed = new Set<string>();
  const rules = new Map<string, PropertyRule>();
  for (const column of columns.slice(1)) {
    const rule = ruleOf(kind, column);
    if (rule === undefined || !('kind' in rule) || claimed.has(rule.key)) continue;
    claimed.add(rule.key);
    rules.set(column, rule);
  }
  return rules;
}

/** Why a column brings nothing in, or null when it does. */
function leftOutBecause(kind: NoteKind, columns: readonly string[], column: string): string | null {
  const rule = ruleOf(kind, column);
  if (rule === undefined) return 'not a column this import maps';
  if ('skip' in rule) return rule.skip;
  if (!('kind' in rule) || propertyColumns(kind, columns).has(column)) return null;
  const first = columns.find((each) => propertyColumns(kind, columns).get(each)?.key === rule.key);
  return `it maps to ${rule.key}, which "${first ?? ''}" fills: not imported`;
}

/** The columns of a database that are not imported, and why, for the report. The first is the title. */
export function columnsLeftOut(kind: NoteKind, columns: readonly string[]): string[] {
  return columns.slice(1).flatMap((column) => {
    const reason = leftOutBecause(kind, columns, column);
    return reason === null ? [] : [`"${column}": ${reason}`];
  });
}

/** A link to a page, as written into a property, and whether the page is in the export or the vault; `why` says what the report should, when it is not. */
export interface ResolvedLink {
  readonly link: string;
  readonly known: boolean;
  readonly why?: string;
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
  /** The zone a UTC time's day is read in; null refuses to read one. */
  readonly timeZone: string | null;
}

/** What a row should come to in the vault. */
export interface WantedNote {
  readonly place: Place;
  /** The properties the import keeps in step with Notion, in order. */
  readonly fields: Readonly<Record<string, unknown>>;
  /** Properties set only where the note has none, and offered once. */
  readonly fillOnly: Readonly<Record<string, unknown>>;
  /** Properties Notion says something about that could not be read: the note keeps what it has. */
  readonly unread: readonly string[];
  /** The day a PARA Archive row was archived on (its end, else the day of the run); null for any other row. */
  readonly archivedOn: string | null;
  /** The day a daily note is for (its Date, else its title); null for any other row, or one with no day. */
  readonly day: string | null;
  /** What the report should say about the row. */
  readonly notes: readonly string[];
}

/** What reading a row's cells comes to, as it goes. */
interface Reading {
  readonly fields: Record<string, unknown>;
  readonly unread: string[];
  readonly notes: string[];
  /** Range ends, by the property they go into, written where that property has nothing of its own. */
  readonly ends: Map<string, string>;
}

/** A date cell's day; a cell that cannot be read is noted, and the property left as the note has it. */
function readDateCell(
  rule: PropertyRule,
  column: string,
  cell: string,
  context: RowContext,
  reading: Reading,
) {
  const day = readDay(cell, context.timeZone);
  if (day.kind === 'unread') {
    reading.unread.push(rule.key);
    reading.notes.push(
      `${column} "${cell}" cannot be read (${day.why}), so the note keeps its ${rule.key}: set the column's format to Full date`,
    );
    return null;
  }
  if (day.endText !== null && rule.endKey !== undefined) {
    if (day.end !== null) reading.ends.set(rule.endKey, day.end);
    else {
      // An end that cannot be read says nothing, as a date that cannot be read says nothing.
      reading.unread.push(rule.endKey);
      reading.notes.push(
        `${column} "${cell}" ends on a day that cannot be read, so the note keeps its ${rule.endKey}`,
      );
    }
  } else if (day.endText !== null) {
    reading.notes.push(
      `${column} "${cell}" is a range: its end, ${day.endText}, is not brought in`,
    );
  }
  return day.day;
}

/** The links a relation cell names, each noted when its page is not one this run knows. */
function linksOf(column: string, cell: string, context: RowContext, notes: string[]): string[] {
  return readRelation(cell).map((entry) => {
    const { link, known, why } = context.resolve(entry);
    if (!known)
      notes.push(
        `${column}: "${entry.title}" ${why ?? 'is not in the export'}; linked by its name`,
      );
    return link;
  });
}

/** A cell as the value its rule writes; null for an empty or unreadable cell, which writes nothing. */
function valueOf(
  rule: PropertyRule,
  column: string,
  context: RowContext,
  reading: Reading,
): unknown {
  const cell = (context.row.get(column) ?? '').trim();
  if (cell === '') return null;
  switch (rule.kind) {
    case 'text':
      return cell;
    case 'options':
      return readOptions(cell);
    case 'date':
      return readDateCell(rule, column, cell, context, reading);
    case 'links':
      return linksOf(column, cell, context, reading.notes);
    case 'link': {
      const links = linksOf(column, cell, context, reading.notes);
      return links.length === 1 ? links[0] : links;
    }
  }
}

/** Each mapped column's property, in the CSV's order, empty ones left out; a range's end where its property has none. */
function readRow(context: RowContext): Reading {
  const reading: Reading = { fields: {}, unread: [], notes: [], ends: new Map() };
  for (const [column, rule] of propertyColumns(context.kind, context.columns)) {
    const value = valueOf(rule, column, context, reading);
    if (value !== null) reading.fields[rule.key] = value;
  }
  for (const [key, end] of reading.ends) {
    if (reading.fields[key] === undefined && !reading.unread.includes(key))
      reading.fields[key] = end;
  }
  return reading;
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

/**
 * The day a daily row is for: its Date, else a title Notion wrote as a date
 * (`October 6, 2026`). Null when neither is a day.
 */
export function rowDay(context: RowCells & Pick<RowContext, 'timeZone'>): string | null {
  const dateColumn = [...propertyColumns(context.kind, context.columns)].find(
    ([, rule]) => rule.key === 'date' && rule.kind === 'date',
  )?.[0];
  for (const cell of [dateColumn, context.columns[0]].map((column) =>
    context.row.get(column ?? ''),
  )) {
    const day =
      cell === undefined || cell.trim() === '' ? null : readDay(cell.trim(), context.timeZone);
    if (day?.kind === 'day') return day.day;
  }
  return null;
}

const STAMP = { source: 'notion' } as const;

/**
 * The note a row of a Notion database should be: where it goes, its type,
 * and its properties, relations written as links to the names Atlas gives
 * their notes. The page's id is kept as `notion_id`, which is how a later
 * run finds the note wherever it was moved.
 */
export function wantedNote(context: RowContext, notionId: string): WantedNote {
  const { fields, unread, notes } = readRow(context);
  const ids = { ...STAMP, notion_id: notionId };
  const { done, ...place } = placeOf(context, notes);
  const common = {
    place,
    unread,
    notes,
    archivedOn: done === true ? ((fields['end'] as string | undefined) ?? context.today) : null,
    day: context.kind === 'daily' ? rowDay(context) : null,
  };
  if (context.kind === 'tasks') {
    const task = taskFields(context, fields, notes);
    return {
      ...common,
      fields: { type: place.type, ...task.fields, ...ids },
      fillOnly: task.fillOnly,
    };
  }
  const status = done === true ? { status: 'done' } : {};
  return { ...common, fields: { type: place.type, ...status, ...fields, ...ids }, fillOnly: {} };
}
