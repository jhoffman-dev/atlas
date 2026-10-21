import {
  ARCHIVED_PARA,
  compileParaValuesQuery,
  isArchivedPath,
  isAtlasNote,
  isParaTarget,
  PARA_VALUES_QUERY_COLUMNS,
  paraChoices,
  paraOf,
  PROJECT_TYPE,
  type ParaValue,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';

/** What reading the notes in use asks of the index: a type's notes, and their PARA. */
type NotesIndex = Pick<IndexPort, 'notesOfType' | 'query'>;

/** Out of the way (U-22), or one of DFAI's own files: never offered. */
const inUse = (note: { readonly path: string }) =>
  !isArchivedPath(note.path) && !isAtlasNote(note.path);

/**
 * The notes of a type that are still in use — what a relation, a board's
 * links or a project picker offers. An archived note is out of the way, so it
 * is not suggested (U-22) — whether it was moved to the Archive or, as a
 * Project, set to PARA archive where it stands (#213); a link to one that
 * already exists still opens it.
 * A note in `.atlas` is never offered: the type's template declares the type
 * without being one of its notes, and picking it linked the template (issue #15).
 */
export async function notesInUseOfType({
  index,
  type,
}: {
  index: NotesIndex;
  type: string;
}): Promise<readonly { path: string; title: string }[]> {
  const notes = (await index.notesOfType(type)).filter(inUse);
  if (type.trim().toLowerCase() !== PROJECT_TYPE) return notes;
  const para = await paraValuesOf(index, type);
  return notes.filter((note) => para.get(note.path) !== ARCHIVED_PARA);
}

/** A note a relation can point at, and which of its types it is. */
export interface NoteOfType {
  readonly path: string;
  readonly title: string;
  /** Its type — or, for PARA's notes, its PARA value: what the picker groups it under. */
  readonly type: string;
}

/**
 * The notes still in use of each of `types`, a type at a time in the order
 * given — what a relation that points at several types offers. A note listed
 * under two of them is offered once, under the first.
 *
 * Project, Area and Resource are PARA's values since #213, all notes of the
 * Project type: where `types` names any of them, the Project notes whose
 * PARA it names are offered in one place — projects, then areas, then
 * resources — never an archived one. Notes of the Area and Resource types a
 * vault kept from before are offered as the value their type names.
 */
export async function notesInUseOfTypes({
  index,
  types,
}: {
  index: NotesIndex;
  types: readonly string[];
}): Promise<readonly NoteOfType[]> {
  const firstPara = types.findIndex(isParaTarget);
  const listed = await Promise.all(
    types.map(async (type, at): Promise<readonly NoteOfType[]> => {
      if (isParaTarget(type)) return at === firstPara ? paraNotesInUse(index, types) : [];
      return (await notesInUseOfType({ index, type })).map((note) => ({ ...note, type }));
    }),
  );
  return onceEach(listed.flat());
}

/**
 * PARA's notes a relation pointing at `targets` offers, each typed by its
 * PARA value: the notes of each PARA type it names, in the order named, and
 * of the Project type, which holds all four.
 */
async function paraNotesInUse(
  index: NotesIndex,
  targets: readonly string[],
): Promise<NoteOfType[]> {
  const para = await paraValuesOf(index, PROJECT_TYPE);
  const typeNames = [...new Set([...targets.filter(isParaTarget), PROJECT_TYPE])];
  const listed = await Promise.all(
    typeNames.map(async (type) =>
      (await index.notesOfType(type)).filter(inUse).map((note) => ({
        path: note.path,
        title: note.title,
        para: paraOf({ type, para: para.get(note.path) }) ?? ARCHIVED_PARA,
      })),
    ),
  );
  return paraChoices(onceEach(listed.flat()), targets).map((note) => ({
    path: note.path,
    title: note.title,
    type: note.para,
  }));
}

/**
 * Each note of `typeName` that holds a PARA DFAI can read, and that value.
 * A note whose PARA says nothing readable is left out, and reads as the
 * default where it is asked for.
 */
async function paraValuesOf(
  index: Pick<IndexPort, 'query'>,
  typeName: string,
): Promise<ReadonlyMap<string, ParaValue>> {
  const { sql, parameters } = compileParaValuesQuery(typeName);
  const result = await index.query(sql, parameters);
  const [pathAt = -1, paraAt = -1] = PARA_VALUES_QUERY_COLUMNS.map((column) =>
    result.columns.indexOf(column),
  );
  const values = new Map<string, ParaValue>();
  for (const row of result.rows) {
    const path = row[pathAt];
    const value = paraOf({ type: typeName, para: row[paraAt] });
    if (typeof path === 'string' && value !== null && !values.has(path)) values.set(path, value);
  }
  return values;
}

/** Each note once, where it is first listed. */
function onceEach<Note extends { readonly path: string }>(notes: readonly Note[]): Note[] {
  const offered = new Map<string, Note>();
  for (const note of notes) if (!offered.has(note.path)) offered.set(note.path, note);
  return [...offered.values()];
}
