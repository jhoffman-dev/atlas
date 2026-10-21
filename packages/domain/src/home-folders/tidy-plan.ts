import { isArchivedPath } from '../archive/archive.ts';
import {
  declaresImport,
  importOutcomeOf,
  isInMeetingInboxFolder,
} from '../meetings/meeting-arrival.ts';
import type { ObjectType } from '../types/property-def.ts';
import { isMarkdownName } from '../vault/vault-entry.ts';
import {
  joinVaultPath,
  parentVaultPath,
  vaultPathName,
  VAULT_ROOT,
  type VaultPath,
} from '../vault/vault-path.ts';
import { foldedVaultPath } from '../vault/vault-spelling.ts';
import { isUserSpaceNote } from '../vault/vault-visibility.ts';
import { homeFolderOf, settledFolderOf } from './home-folder.ts';

/** One note the tidy would move, from where it is to its home folder. */
export interface TidyMove {
  readonly from: VaultPath;
  readonly to: VaultPath;
}

/** A note the tidy leaves where it is, though it has a home to go to, and why. */
export interface TidyRefusal {
  readonly path: VaultPath;
  /** Where it would have gone. */
  readonly to: VaultPath;
  readonly reason: string;
}

/** What tidying the vault would do: every move, and every note it will not move. */
export interface TidyPlan {
  readonly moves: readonly TidyMove[];
  readonly refused: readonly TidyRefusal[];
}

/** A note the tidy looks at, with the frontmatter it holds. */
export interface TidyNote {
  readonly path: VaultPath;
  readonly properties: Readonly<Record<string, unknown>>;
}

/**
 * Whether the tidy looks at a note at all (#214): one loose at the root of
 * the vault, or one in the older `Inbox/Meetings`, where every meeting landed
 * before each had a month of its own. DFAI's own notes, hidden ones and the
 * Archive are never looked at. Whether it moves is {@link tidyPlan}'s to say.
 */
export function isTidyCandidate(path: VaultPath): boolean {
  if (!isMarkdownName(path) || !isUserSpaceNote(path) || isArchivedPath(path)) return false;
  return parentVaultPath(path) === VAULT_ROOT || isInMeetingInboxFolder(path);
}

/**
 * The one-time tidy, as a plan to preview (#214): each note loose at the
 * root to its type's home folder — a plain note to `Notes/<year>` — and each
 * meeting the import let in from the older `Inbox/Meetings` to its month's
 * folder, all under their own names. A note whose type has no home stays
 * where it is. A meeting file the import has not let in — still arriving,
 * refused, a copy, or one that declares the import's contract from before
 * DFAI imported — is listed and left where it is: moved into `Meetings`, it
 * would be handed to the import as an arrival.
 *
 * Nothing is ever renamed: a note whose home already holds that name, or two
 * that would land on the same path, are refused, each with why, and stay.
 * Names are compared as the disk compares them. A vault already tidy has an
 * empty plan, so running it twice moves nothing the second time.
 */
export function tidyPlan({
  notes,
  notePaths,
  types,
  today,
}: {
  /** The candidates, with their frontmatter: see {@link isTidyCandidate}. */
  notes: readonly TidyNote[];
  /** Every note in the vault, for the names already taken. */
  notePaths: readonly VaultPath[];
  types: readonly Pick<ObjectType, 'name' | 'folder'>[];
  /** `YYYY-MM-DD`: the day of a note that names none. */
  today: string;
}): TidyPlan {
  const wanted: TidyMove[] = [];
  const refused: TidyRefusal[] = [];
  for (const note of notes) {
    const to = destinationOf(note, { types, today });
    if (to === null || foldedVaultPath(to) === foldedVaultPath(note.path)) continue;
    if (isUnsettledImport(note)) refused.push({ path: note.path, to, reason: UNSETTLED });
    else wanted.push({ from: note.path, to });
  }
  const taken = new Set(notePaths.map(foldedVaultPath));
  const landings = countBy(wanted.map(({ to }) => foldedVaultPath(to)));
  const moves: TidyMove[] = [];
  for (const move of wanted) {
    const reason = collision(move, { taken, landings });
    if (reason === null) moves.push(move);
    else refused.push({ path: move.from, to: move.to, reason });
  }
  return { moves, refused };
}

const UNSETTLED =
  'The meeting import has not let it in, so it stays where it is until the import settles it.';

/** A meeting file the import has to settle before it goes anywhere: one not stamped `imported`. */
function isUnsettledImport({ path, properties }: TidyNote): boolean {
  const theImports = isInMeetingInboxFolder(path) || declaresImport(properties);
  return theImports && importOutcomeOf(properties) !== 'imported';
}

/** Where a candidate's home is, or null when it has none: a meeting from `Inbox/Meetings` goes to its month. */
function destinationOf(
  note: TidyNote,
  context: { types: readonly Pick<ObjectType, 'name' | 'folder'>[]; today: string },
): VaultPath | null {
  const args = { ...note, ...context };
  const folder = isInMeetingInboxFolder(note.path) ? homeFolderOf(args) : settledFolderOf(args);
  return folder === null ? null : joinVaultPath(folder, vaultPathName(note.path));
}

/** Why a move would land on a note, or on the note another move lands on; null when it is clear. */
function collision(
  { to }: TidyMove,
  { taken, landings }: { taken: ReadonlySet<string>; landings: ReadonlyMap<string, number> },
): string | null {
  const landing = foldedVaultPath(to);
  if (taken.has(landing)) return `${to} is already a note there: rename one of them first.`;
  if ((landings.get(landing) ?? 0) > 1) {
    return `Another note would land at ${to} too: rename one of them first.`;
  }
  return null;
}

function countBy(keys: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}
