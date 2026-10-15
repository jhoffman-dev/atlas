import { humanizeKey } from '../page/property-label.ts';
import type { CompiledQuery } from '../query/view-query.ts';
import {
  ARCHIVED_PARA,
  AREA_TYPE,
  DEFAULT_PARA,
  PARA_KEY,
  PARA_VALUES,
  PROJECT_TYPE,
  RESOURCE_TYPE,
  type ParaValue,
} from './para.ts';
import type { ObjectType } from './property-def.ts';

type Properties = Readonly<Record<string, unknown>>;

/** A value as PARA compares it: text, trimmed, in any case; anything else is no name. */
const folded = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

/** The PARA value `value` names, in any case, or null when it names none of the four. */
export function paraValueNamed(value: unknown): ParaValue | null {
  const name = folded(value);
  return PARA_VALUES.find((candidate) => candidate === name) ?? null;
}

/** Whether a note is PARA's: its `type` is Project. Only these are archived by their value. */
export function isParaNote(properties: Properties): boolean {
  return folded(properties['type']) === PROJECT_TYPE;
}

/**
 * Where a note stands in PARA, from its `type` and its `para`: a Project's
 * `para`, or the default when it has none Atlas can read; a note of the
 * Area or Resource type from before #213 as the value its type names. Null
 * for a note of any other type.
 */
export function paraOf({ type, para }: { type: unknown; para: unknown }): ParaValue | null {
  const kind = folded(type);
  if (kind === PROJECT_TYPE) return paraValueNamed(para) ?? DEFAULT_PARA;
  if (kind === AREA_TYPE || kind === RESOURCE_TYPE) return kind;
  return null;
}

/** Whether a note is a Project set to archive: out of the way, though its file has not moved. */
export function isParaArchived(properties: Properties): boolean {
  return isParaNote(properties) && paraValueNamed(properties[PARA_KEY]) === ARCHIVED_PARA;
}

/** What a page menu's Archive or Unarchive does to a PARA note: the `para` it sets. */
export interface ParaArchiveToggle {
  readonly action: 'archive' | 'unarchive';
  readonly para: ParaValue;
}

/**
 * Archive or Unarchive on a PARA note (#213): archiving sets `para` to
 * archive and unarchiving sets it back to the default, and the file stays
 * where it is. Null for any other note, which the Archive takes by moving it.
 */
export function paraArchiveToggle(properties: Properties): ParaArchiveToggle | null {
  if (!isParaNote(properties)) return null;
  return isParaArchived(properties)
    ? { action: 'unarchive', para: DEFAULT_PARA }
    : { action: 'archive', para: ARCHIVED_PARA };
}

/** Whether a relation's target is a PARA value, so it resolves to the Project type. */
export function isParaTarget(target: string): boolean {
  const name = folded(target);
  return name === PROJECT_TYPE || name === AREA_TYPE || name === RESOURCE_TYPE;
}

/**
 * The PARA values a relation pointing at `targets` offers, in PARA's order:
 * `[project, area]` offers projects and areas, `area` only areas. Archive is
 * never one: an archived note is out of the way.
 */
export function paraValuesTargeted(targets: readonly string[]): ParaValue[] {
  const named = new Set(targets.map(folded));
  return PARA_VALUES.filter((value) => value !== ARCHIVED_PARA && named.has(value));
}

/** A note a PARA relation may offer, with where it stands in PARA. */
export interface ParaChoice {
  readonly path: string;
  readonly title: string;
  readonly para: ParaValue;
}

/**
 * What a relation pointing at `targets` offers of PARA's notes: the ones
 * whose value it points at, grouped as PARA reads — projects, then areas,
 * then resources — each group in the order given. Never an archived one.
 */
export function paraChoices<Choice extends ParaChoice>(
  notes: readonly Choice[],
  targets: readonly string[],
): Choice[] {
  return paraValuesTargeted(targets).flatMap((value) =>
    notes.filter((note) => note.para === value),
  );
}

const GROUP_LABELS: Readonly<Record<ParaValue, string>> = {
  project: 'Projects',
  area: 'Areas',
  resource: 'Resources',
  archive: 'Archive',
};

/** The heading a picker groups a relation's notes under: PARA's by value, any other by its type. */
export function relationGroupLabel(type: string): string {
  const value = paraValueNamed(type);
  return value === null ? humanizeKey(type) : GROUP_LABELS[value];
}

/**
 * The type a picker's "New area…" makes a note of, and what it is given: for
 * a PARA target, a Project whose PARA is the value named — when the vault's
 * Project type declares PARA (#213); otherwise the type the target names, as
 * for any relation. Null when the vault has no type to make it of.
 */
export function relatedNoteKind<Type extends Pick<ObjectType, 'name' | 'properties'>>({
  target,
  types,
}: {
  target: string;
  types: readonly Type[];
}): { readonly type: Type; readonly values: Readonly<Record<string, string>> } | null {
  const value = isParaTarget(target) ? paraValueNamed(target) : null;
  const project = types.find((type) => folded(type.name) === PROJECT_TYPE);
  const holdsPara = project?.properties.some((property) => property.key === PARA_KEY) === true;
  if (value !== null && project !== undefined && holdsPara) {
    return { type: project, values: { [PARA_KEY]: value } };
  }
  const named = types.find((type) => type.name === target);
  return named === undefined ? null : { type: named, values: {} };
}

/**
 * What a new note of `type` starts with besides what it was given: on a
 * Project type that declares `para`, the default — unless its fields or its
 * template already say one.
 */
export function paraDefaultFor({
  type,
  starting,
}: {
  type: Pick<ObjectType, 'name' | 'properties'>;
  /** What the new note says already: its template's frontmatter and the fields filled in. */
  starting: Properties;
}): Properties {
  if (folded(type.name) !== PROJECT_TYPE) return {};
  if (!type.properties.some((property) => property.key === PARA_KEY)) return {};
  const said = starting[PARA_KEY];
  if (said !== undefined && said !== null && String(said).trim() !== '') return {};
  return { [PARA_KEY]: DEFAULT_PARA };
}

/**
 * A SQL condition that leaves out Project notes set to archive, for a
 * statement whose rows carry a note's path in `column` — written qualified
 * (`"v_project"."path"`, `n.path`), since it is compared inside a subquery
 * over `props`. Constants of the app only, so nothing is bound.
 */
export function outsideParaArchiveSql(column: string): string {
  return [
    `NOT EXISTS (SELECT 1 FROM props AS para_value WHERE para_value.path = ${column}`,
    `  AND para_value.key = '${PARA_KEY}' AND lower(trim(para_value.value_text)) = '${ARCHIVED_PARA}'`,
    `  AND EXISTS (SELECT 1 FROM props AS para_type WHERE para_type.path = ${column}`,
    `    AND para_type.key = 'type' AND lower(trim(para_type.value_text)) = '${PROJECT_TYPE}'))`,
  ].join('\n');
}

/**
 * A SQL condition that keeps, of the Project notes at `column`, the projects:
 * those whose `para` names no other PARA value — none, `project`, or one
 * Atlas cannot read, which is the default. Constants only, nothing bound.
 */
export function paraProjectSql(column: string): string {
  const others = PARA_VALUES.filter((value) => value !== DEFAULT_PARA)
    .map((value) => `'${value}'`)
    .join(', ');
  return [
    `NOT EXISTS (SELECT 1 FROM props AS para_value WHERE para_value.path = ${column}`,
    `  AND para_value.key = '${PARA_KEY}' AND lower(trim(para_value.value_text)) IN (${others}))`,
  ].join('\n');
}

/** What {@link compileParaValuesQuery}'s statement starts with, so a log or a stand-in index can tell it apart. */
export const PARA_VALUES_QUERY_MARK = '/* PARA values */';

/** The columns {@link compileParaValuesQuery} comes back as, in order. */
export const PARA_VALUES_QUERY_COLUMNS = ['path', 'para'] as const;

/**
 * Every note of the type `typeName` — as its notes write it — that holds a
 * `para`, and what that says: what a picker groups the type's notes by.
 */
export function compileParaValuesQuery(typeName: string): CompiledQuery {
  return {
    sql: [
      `${PARA_VALUES_QUERY_MARK} SELECT para_value.path AS "path", para_value.value_text AS "para"`,
      `FROM props AS para_value`,
      `WHERE para_value.key = '${PARA_KEY}'`,
      `  AND EXISTS (SELECT 1 FROM props AS para_type WHERE para_type.path = para_value.path`,
      `    AND para_type.key = 'type' AND para_type.value_text = ?)`,
      `ORDER BY para_value.path, para_value.idx`,
    ].join('\n'),
    parameters: [typeName],
  };
}
