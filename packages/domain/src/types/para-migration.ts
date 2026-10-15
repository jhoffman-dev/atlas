import { isArchivedPath } from '../archive/archive.ts';
import type { CompiledQuery } from '../query/view-query.ts';
import { isAtlasNote } from '../vault/vault-visibility.ts';
import {
  ARCHIVED_PARA,
  AREA_TYPE,
  PARA_KEY,
  PROJECT_TYPE,
  RESOURCE_TYPE,
  type ParaValue,
} from './para.ts';
import { paraValueNamed } from './para-value.ts';

type Properties = Readonly<Record<string, unknown>>;

/** A note's `type` as PARA compares it: text, trimmed, in any case. */
const typeOf = (properties: Properties): string => {
  const type = properties['type'];
  return typeof type === 'string' ? type.trim().toLowerCase() : '';
};

/** What {@link compileParaCandidatesQuery}'s statement starts with, so a stand-in index can tell it apart. */
export const PARA_CANDIDATES_QUERY_MARK = '/* PARA candidates */';

/**
 * Every note whose `type` is Area, Resource or Project in any spelling —
 * `Area`, ` resource ` — asked of the index: what the move onto the Project
 * type reads, to judge each from its file. Comes back as one `path` column.
 */
export function compileParaCandidatesQuery(): CompiledQuery {
  return {
    sql: [
      `${PARA_CANDIDATES_QUERY_MARK} SELECT DISTINCT path AS "path" FROM props`,
      `WHERE key = 'type' AND lower(trim(value_text)) IN (?, ?, ?)`,
      `ORDER BY path`,
    ].join('\n'),
    parameters: [AREA_TYPE, RESOURCE_TYPE, PROJECT_TYPE],
  };
}

/** One note's move onto the Project type: where it stands now, and the PARA value it is given. */
export interface ParaNoteMove {
  /** Its `type` as written, or the empty string when it has none Atlas can read. */
  readonly fromType: string;
  /** Its `para` as written, or null when it has none. */
  readonly fromPara: string | null;
  readonly to: ParaValue;
  /** The keys written: `type` and `para`, or `para` alone — nothing else in the note changes. */
  readonly changes: Readonly<Record<string, string>>;
}

/**
 * What moving one note onto the one Project type writes into it (#213), or
 * null when it has nothing to move — so running the migration again changes
 * nothing:
 *
 * - a note of the Area or Resource type becomes a Project whose `para` names
 *   what it was — or `archive`, when its file is in the Archive;
 * - a Project whose file is in the Archive is given `para: archive`, so it
 *   stays out of the way once the file move is no longer what archives it.
 *
 * Only `type` and `para` are written; the file stays where it is. A note
 * Atlas keeps for itself — a template — is never moved.
 */
export function paraNoteMove({
  path,
  properties,
  projectType = PROJECT_TYPE,
}: {
  path: string;
  properties: Properties;
  /** The vault's Project type's name, as `type:` is to say it. */
  projectType?: string;
}): ParaNoteMove | null {
  if (isAtlasNote(path)) return null;
  const type = typeOf(properties);
  const archived = isArchivedPath(path);
  const from = {
    fromType: typeof properties['type'] === 'string' ? properties['type'] : '',
    fromPara: writtenPara(properties),
  };
  if (type === AREA_TYPE || type === RESOURCE_TYPE) {
    const to: ParaValue = archived ? ARCHIVED_PARA : type;
    return { ...from, to, changes: { type: projectType, [PARA_KEY]: to } };
  }
  if (type !== PROJECT_TYPE || !archived) return null;
  if (paraValueNamed(properties[PARA_KEY]) === ARCHIVED_PARA) return null;
  return { ...from, to: ARCHIVED_PARA, changes: { [PARA_KEY]: ARCHIVED_PARA } };
}

function writtenPara(properties: Properties): string | null {
  const para = properties[PARA_KEY];
  if (para === undefined || para === null) return null;
  return typeof para === 'string' ? para : JSON.stringify(para);
}

/** "Garden: Area → Project, PARA Area" — one note's line in the preview. */
export function paraMoveLine({ title, move }: { title: string; move: ParaNoteMove }): string {
  const value = (name: string) => (name === '' ? '(none)' : capitalized(name));
  const now = 'type' in move.changes ? value(move.fromType) : `PARA ${value(move.fromPara ?? '')}`;
  const becomes =
    'type' in move.changes ? `Project, PARA ${value(move.to)}` : `PARA ${value(move.to)}`;
  return `${title}: ${now} → ${becomes}`;
}

const capitalized = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * What Activity says once the move ran: "Moved 3 notes onto the Project
 * type, with PARA set." — and how many it left as they were, when any.
 */
export function paraMigrationLine({ moved, left }: { moved: number; left: number }): string {
  const notes = (count: number) => (count === 1 ? '1 note' : `${count} notes`);
  const kept = left === 0 ? '' : ` ${notes(left)} left as they were.`;
  return `Moved ${notes(moved)} onto the Project type, with PARA set.${kept}`;
}
