import { isArchivedPath } from '../archive/archive.ts';
import { DAILY_TYPE } from '../daily/daily-note.ts';
import { LITERATURE_NOTE_TYPE, LIBRARY_HOME } from '../highlights/literature-note.ts';
import { TASK_TYPE } from '../gtd/gtd-status.ts';
import { MEETINGS_HOME } from '../meetings/meeting-arrival.ts';
import { MEETING_TYPE } from '../meetings/meeting-header.ts';
import { COMPANY_TYPE } from '../people/company.ts';
import { PERSON_TYPE } from '../people/person.ts';
import { PROPOSAL_TYPE } from '../proposals/proposal.ts';
import { AREA_TYPE, PROJECT_TYPE, RESOURCE_TYPE } from '../types/para.ts';
import type { ObjectType } from '../types/property-def.ts';
import { noteTitle } from '../vault/vault-entry.ts';
import { createVaultPath, joinVaultPath, type VaultPath } from '../vault/vault-path.ts';
import { isUserSpaceNote, isWithinWalk } from '../vault/vault-visibility.ts';

/** Where a note with no type of its own is tidied and filed to: it has no type file to say. */
export const PLAIN_NOTE_HOME = 'Notes/{YYYY}';

/**
 * Where each built-in type's notes live when its type file names no
 * `folder:` (#214). Dated ones are sharded by the note's own day, so no
 * folder grows without bound: a year of meetings is twelve folders of a
 * hundred, not one of 1,300. Every PARA type is a project to the folders.
 */
const DEFAULT_HOME_FOLDERS: ReadonlyMap<string, string> = new Map([
  [TASK_TYPE, 'Tasks/{YYYY}/{MM}'],
  [MEETING_TYPE, `${MEETINGS_HOME}/{YYYY}/{MM}`],
  [DAILY_TYPE, 'Daily/{YYYY}'],
  [PERSON_TYPE, 'People'],
  [COMPANY_TYPE, 'Companies'],
  [PROJECT_TYPE, 'Projects'],
  [AREA_TYPE, 'Projects'],
  [RESOURCE_TYPE, 'Projects'],
  ['notes', PLAIN_NOTE_HOME],
  [PROPOSAL_TYPE, 'Inbox/Proposals'],
  [LITERATURE_NOTE_TYPE, LIBRARY_HOME],
]);

const DATE_TOKENS = /\{(YYYY|MM)\}/g;
const ANY_TOKEN = /\{[^}]*\}/;
const DAY = /^(\d{4})-(\d{2})-\d{2}/;

const folded = (name: string) => name.trim().toLowerCase();

/**
 * The folder a type's notes live in, as written — `Tasks/{YYYY}/{MM}` — or
 * null when they have none and go where a new note always went. The type
 * file's own `folder:` wins; a blank one says the type has no home. A type
 * the vault does not define, or defines without one, has the built-in
 * default, if it is a built-in type.
 */
export function homeFolderTemplate(
  typeName: string,
  types: readonly Pick<ObjectType, 'name' | 'folder'>[],
): string | null {
  const own = types.find((type) => folded(type.name) === folded(typeName))?.folder;
  if (own !== undefined) return own.trim() === '' ? null : own.trim();
  return DEFAULT_HOME_FOLDERS.get(folded(typeName)) ?? null;
}

/**
 * The day a note is filed by, `YYYY-MM-DD`: its `date`, else a date its name
 * starts with — a daily note's `2026-10-12.md`, a meeting's
 * `2026-10-12 Standup.md` — else `today`.
 */
export function noteDay({
  properties,
  path,
  today,
}: {
  properties: Readonly<Record<string, unknown>>;
  path: VaultPath | null;
  today: string;
}): string {
  const date = properties['date'];
  const own = typeof date === 'string' ? DAY.exec(date.trim()) : null;
  if (own !== null) return own[0];
  const named = path === null ? null : DAY.exec(noteTitle(path));
  return named?.[0] ?? today;
}

/**
 * A home folder written in a type file, for a note of `day`: the tokens
 * filled in, or null when what is written cannot be a folder notes live in —
 * a token other than `{YYYY}` and `{MM}`, a path out of the vault, a folder
 * DFAI keeps for itself, a hidden one, the Archive, or one too deep to be
 * read. A folder that cannot be used is never refused: the note goes where it
 * would have gone without one.
 */
export function expandHomeFolder(template: string, day: string): VaultPath | null {
  const [, year, month] = DAY.exec(day) ?? [];
  if (year === undefined || month === undefined) return null;
  const filled = template.replace(DATE_TOKENS, (_, token: string) =>
    token === 'YYYY' ? year : month,
  );
  if (ANY_TOKEN.test(filled)) return null;
  let folder: VaultPath;
  try {
    folder = createVaultPath(filled.trim());
  } catch {
    // Written as a path out of the vault: there is no folder to use, so none is.
    return null;
  }
  const inside = joinVaultPath(folder, 'note.md');
  if (!isUserSpaceNote(inside) || isArchivedPath(inside) || !isWithinWalk(inside)) return null;
  return folder;
}

/**
 * Where a note of these properties lives (#214): its type's home folder for
 * its day, or null when its type has none, it has no type, or the folder
 * written for it cannot be used.
 */
export function homeFolderOf({
  properties,
  path = null,
  types,
  today,
}: {
  properties: Readonly<Record<string, unknown>>;
  /** Where the note is, when it is anywhere yet: its name may hold its day. */
  path?: VaultPath | null;
  types: readonly Pick<ObjectType, 'name' | 'folder'>[];
  today: string;
}): VaultPath | null {
  const typeName = typeOf(properties);
  if (typeName === null) return null;
  const template = homeFolderTemplate(typeName, types);
  if (template === null) return null;
  return expandHomeFolder(template, noteDay({ properties, path, today }));
}

/**
 * Where a note lives once it is tidied or filed out of the Inbox: its type's
 * home, or {@link PLAIN_NOTE_HOME} for a note with no type. A note of a type
 * with no home has none, and stays where it is.
 */
export function settledFolderOf(args: {
  properties: Readonly<Record<string, unknown>>;
  path: VaultPath;
  types: readonly Pick<ObjectType, 'name' | 'folder'>[];
  today: string;
}): VaultPath | null {
  if (typeOf(args.properties) !== null) return homeFolderOf(args);
  return expandHomeFolder(PLAIN_NOTE_HOME, noteDay(args));
}

function typeOf(properties: Readonly<Record<string, unknown>>): string | null {
  const type = properties['type'];
  return typeof type === 'string' && type.trim() !== '' ? type.trim() : null;
}
