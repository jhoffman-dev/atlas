import { KeyAsWritten } from '../markdown/frontmatter-key.ts';
import { isAtlasNote, isVisibleEntry, isWithinWalk } from '../vault/vault-visibility.ts';
import {
  createVaultPath,
  parentVaultPath,
  joinVaultPath,
  vaultPathName,
  type VaultPath,
} from '../vault/vault-path.ts';
import { foldedVaultPath } from '../vault/vault-spelling.ts';
import type { VaultEntry } from '../vault/vault-entry.ts';

/**
 * Where archived notes live: a folder at the root of the vault, holding each
 * note at the path it had — `Projects/X.md` becomes `Archive/Projects/X.md`.
 *
 * A folder rather than a flag, so the tree, the views and the index's hot
 * paths can leave the whole lot out by its first segment instead of reading
 * every note to find a property (U-22).
 */
export const ARCHIVE_DIRECTORY = 'Archive';

/** The frontmatter keys an archived note carries: when, and from where. */
export const ARCHIVED_KEY = 'archived';
export const ARCHIVED_FROM_KEY = 'archivedFrom';
/**
 * What the note had under the stamp's keys before it was archived, given back
 * when it is unarchived — so a note's own `archived: false` is not lost.
 */
export const ARCHIVED_PRIOR_KEY = 'archivedPrior';

const STAMPED_KEYS = [ARCHIVED_KEY, ARCHIVED_FROM_KEY, ARCHIVED_PRIOR_KEY] as const;

/**
 * The start of every archived path, lower-cased, for a statement or the host
 * to compare against a lower-cased path. The disk does not tell `Archive` from
 * `archive` on a Mac, so neither does this.
 */
export const ARCHIVE_PREFIX = `${ARCHIVE_DIRECTORY.toLowerCase()}/`;

const MARKDOWN = /\.(md|markdown)$/i;

/** Whether a note (or a folder) sits in the Archive. */
export function isArchivedPath(path: string): boolean {
  return path.toLowerCase().startsWith(ARCHIVE_PREFIX);
}

/** Whether this is the Archive folder itself, at the root, however it is spelled on disk. */
export function isArchiveFolder(entry: VaultEntry): boolean {
  return entry.kind === 'directory' && entry.path.toLowerCase() === ARCHIVE_DIRECTORY.toLowerCase();
}

/** The notes still in use: every one outside the Archive. */
export function activeNotePaths(paths: readonly VaultPath[]): VaultPath[] {
  return paths.filter((path) => !isArchivedPath(path));
}

/**
 * A SQL condition that leaves archived notes out, for a statement whose rows
 * carry a note's path in `column`. A constant of the app, so it is written into
 * the statement rather than bound; `substr` rather than `LIKE`, whose `_` is a
 * wildcard.
 */
export function outsideArchiveSql(column: string): string {
  return `lower(substr(${column}, 1, ${ARCHIVE_PREFIX.length})) <> '${ARCHIVE_PREFIX}'`;
}

/** Why a note cannot be archived, or null when it can. */
export function archiveRefusal(path: VaultPath): string | null {
  if (isAtlasNote(path)) return 'Atlas keeps its own files where they are.';
  if (isArchivedPath(path)) return 'It is already archived.';
  if (!MARKDOWN.test(path)) return 'Only notes can be archived.';
  // The Archive adds a folder; past the walk's depth the note would drop out of sight.
  if (!isWithinWalk(joinVaultPath(ARCHIVE_DIRECTORY as VaultPath, path))) {
    return 'It is too many folders deep: in the Archive, Atlas would no longer read it.';
  }
  return null;
}

/** Why a note cannot be unarchived, or null when it can. */
export function unarchiveRefusal(path: VaultPath): string | null {
  if (!isArchivedPath(path)) return 'It is not archived.';
  const implied = withoutArchive(path);
  if (
    isAtlasNote(implied) ||
    !isVisibleEntry({ kind: 'file', name: vaultPathName(implied), path: implied })
  ) {
    return 'Out of the Archive it would be somewhere Atlas does not show.';
  }
  return null;
}

/**
 * The first of `wanted`, `wanted 2`, `wanted 3`… in the same folder that is
 * not taken. Taken in another case or another Unicode composition counts, as
 * it does on the disk.
 */
export function freeNotePath(wanted: VaultPath, taken: ReadonlySet<string>): VaultPath {
  const lowered = new Set([...taken].map(foldedVaultPath));
  const name = vaultPathName(wanted);
  const extension = MARKDOWN.exec(name)?.[0] ?? '';
  const base = name.slice(0, name.length - extension.length);
  const folder = parentVaultPath(wanted);
  for (let attempt = 1; ; attempt += 1) {
    const candidate =
      attempt === 1 ? wanted : joinVaultPath(folder, `${base} ${attempt}${extension}`);
    if (!lowered.has(foldedVaultPath(candidate))) return candidate;
  }
}

/**
 * Where a note goes when it is archived: its own path under the Archive,
 * numbered if taken. `archive` is the Archive folder as the disk spells it,
 * when it is already there.
 */
export function archiveDestination({
  path,
  taken,
  archive = ARCHIVE_DIRECTORY as VaultPath,
}: {
  path: VaultPath;
  taken: ReadonlySet<string>;
  archive?: VaultPath;
}): VaultPath {
  return freeNotePath(joinVaultPath(archive, path), taken);
}

/**
 * Where an archived note goes back to: its path with `Archive/` taken off,
 * numbered if something has taken it since.
 *
 * The note's `archivedFrom` is taken only where it names that same place —
 * see {@link originOf} — so an edited record can never send a note elsewhere.
 */
export function restoreDestination({
  path,
  archivedFrom,
  taken,
}: {
  path: VaultPath;
  archivedFrom: unknown;
  taken: ReadonlySet<string>;
}): VaultPath {
  return freeNotePath(originOf(path, archivedFrom), taken);
}

/**
 * Where an archived note came from: its path without `Archive/`. The record
 * archiving wrote is used only to spell that place as the note had it — in
 * its own case or composition, or without the number archiving gave a name
 * an archived note already had. A record naming anywhere else is ignored: it
 * was edited, by hand or through the API, and following it would let an edit
 * move the note to another folder, rename it, give it another extension or
 * bury it past where the vault is read (A20-06).
 */
export function originOf(path: VaultPath, archivedFrom: unknown): VaultPath {
  const implied = withoutArchive(path);
  return recordOfSamePlace(archivedFrom, implied) ?? implied;
}

function recordOfSamePlace(recorded: unknown, implied: VaultPath): VaultPath | null {
  if (typeof recorded !== 'string') return null;
  let path: VaultPath;
  try {
    path = createVaultPath(recorded);
  } catch {
    // A record that is not a path inside the vault is no record at all.
    return null;
  }
  const same = [implied, withoutCopyNumber(implied)].some(
    (place) => place !== null && foldedVaultPath(place) === foldedVaultPath(path),
  );
  return same ? path : null;
}

/** `X 2.md` as `X.md`: the name before {@link freeNotePath} numbered it; null when it has no number. */
function withoutCopyNumber(path: VaultPath): VaultPath | null {
  const numbered = /^(.+) \d+(\.(?:md|markdown))$/i.exec(vaultPathName(path));
  if (numbered === null) return null;
  return joinVaultPath(parentVaultPath(path), `${numbered[1]}${numbered[2]}`);
}

/**
 * The path with the Archive's segment taken off the front — every one of
 * them, so a note filed by hand at `Archive/Archive/x.md` still leaves it.
 */
function withoutArchive(path: VaultPath): VaultPath {
  let origin = path;
  while (isArchivedPath(origin)) origin = createVaultPath(origin.slice(ARCHIVE_PREFIX.length));
  return origin;
}

/**
 * What archiving writes into a note: the day, and where it was.
 *
 * `own` is the note's frontmatter as it was — each key's text as written —
 * or null when it had none. The text of what it held under the stamp's keys
 * is kept under {@link ARCHIVED_PRIOR_KEY}, so unarchiving gives it back byte
 * for byte: `0x1F` stays `0x1F`, a bare `archived:` stays bare. So is an empty
 * record when the note had a block with no keys in it, which is how
 * unarchiving knows to keep that block rather than take it away.
 */
export function archiveStamp({
  from,
  on,
  own = null,
}: {
  from: VaultPath;
  on: string;
  own?: Readonly<Record<string, string>> | null;
}): Readonly<Record<string, unknown>> {
  const stamp = { [ARCHIVED_KEY]: on, [ARCHIVED_FROM_KEY]: from };
  if (own === null) return stamp;
  const prior = Object.fromEntries(
    STAMPED_KEYS.filter((key) => Object.hasOwn(own, key)).map((key) => [key, own[key]]),
  );
  const nothingToKeep = Object.keys(prior).length === 0 && Object.keys(own).length > 0;
  return nothingToKeep ? stamp : { ...stamp, [ARCHIVED_PRIOR_KEY]: prior };
}

/** What unarchiving writes, and whether the note keeps its frontmatter block when nothing is left in it. */
export interface Unstamp {
  readonly changes: Readonly<Record<string, unknown>>;
  readonly keepsBlock: boolean;
}

/**
 * What unarchiving writes into a note whose frontmatter is `own`: each of the
 * stamp's keys back to the text the note had it as, or removed when it had
 * nothing there. A record that is not a map — edited by hand — keeps nothing,
 * and neither does an entry in it that is not text.
 */
export function unarchiveStamp(own: Readonly<Record<string, unknown>>): Unstamp {
  const recorded = own[ARCHIVED_PRIOR_KEY];
  const prior = isRecord(recorded) ? recorded : {};
  const restored = (key: string) => {
    const text = prior[key];
    return typeof text === 'string' ? new KeyAsWritten(text) : null;
  };
  return {
    changes: Object.fromEntries(STAMPED_KEYS.map((key) => [key, restored(key)])),
    keepsBlock: isRecord(recorded),
  };
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

/** An archived note as the Archive lists it. */
export interface ArchivedNote {
  readonly path: VaultPath;
  readonly title: string;
  /** Where it goes back to. */
  readonly from: VaultPath;
  /** The day it was archived, `YYYY-MM-DD`, or null when it does not say. */
  readonly archivedOn: string | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}/;

/** The day in an `archived:` value: a date written by hand or by Atlas. */
export function archivedDay(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value !== 'string') return null;
  return DAY.exec(value.trim())?.[0] ?? null;
}

/** One row of the Archive, from what the index knows of the note. */
export function archivedNote({
  path,
  title,
  properties,
}: {
  path: VaultPath;
  title: string;
  properties: Readonly<Record<string, unknown>>;
}): ArchivedNote {
  return {
    path,
    title,
    from: originOf(path, properties[ARCHIVED_FROM_KEY]),
    archivedOn: archivedDay(properties[ARCHIVED_KEY]),
  };
}
