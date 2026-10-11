import {
  compileMeetingHoldersQuery,
  createVaultPath,
  DUPLICATE_OF_KEY,
  duplicateLink,
  IMPORT_ERROR_KEY,
  IMPORT_OUTCOME_KEY,
  isConflictCopyPath,
  meetingHolding,
  messageWithoutPaths,
  splitFrontmatter,
  type MeetingIdentity,
  type MeetingImportHappening,
  type VaultPath,
} from '@atlas/domain';
import { archiveNotes, type ArchivePorts } from '../archive/archive-notes.ts';
import type { ActivityRecorder } from '../activity/ports.ts';
import { readFrontmatter } from './meeting-reading.ts';
import { UNSAVED, writeStamp } from './meeting-stamp-writer.ts';

/** One run of the import, and what it has done so far. */
export interface ImportContext {
  readonly ports: ArchivePorts;
  /** The day a copy is archived on, `YYYY-MM-DD`. */
  readonly today: string;
  readonly activity: ActivityRecorder;
  /** Files this run has settled, which are not looked at again when their own turn comes. */
  readonly settled: Set<string>;
  /** Every note in the vault, read from the index once a run: what an archived copy's name is checked against. */
  notePaths: readonly VaultPath[] | null;
  /** Whether a note was written or moved. */
  wrote: boolean;
}

/** The notes holding a meeting now, and which of them the import has already let in. */
export interface Holders {
  readonly unsettled: readonly string[];
  readonly imported: readonly string[];
}

/** What finding a meeting's holders reads: the index, to know where to look, and the notes themselves. */
export type HolderPorts = Pick<ArchivePorts, 'fs' | 'markdown' | 'index'>;

/**
 * The other notes that hold a meeting now, as the import counts them (see
 * {@link meetingHoldersIn}), leaving out the file being settled and any this
 * run has settled already.
 */
export function meetingHolders(
  context: ImportContext,
  { meeting, besides }: { meeting: MeetingIdentity; besides: string },
): Promise<Holders> {
  return meetingHoldersIn(context.ports, {
    meeting,
    skip: (holder) => holder === besides || context.settled.has(holder),
  });
}

/**
 * The notes that hold a meeting now: the index names the notes that held its
 * provider + external_id when it last read them, and each is read again,
 * since the index is behind what the import writes and moves. One stamped
 * `imported` holds it whatever else it says — the person may have added to it
 * since. One not stamped holds it when it follows the contract. One stamped
 * `duplicate` or `error`, and a sync conflict's copy, holds nothing. Ids are
 * compared without the spaces around them, as the index keeps them. A note
 * `skip` names is not read.
 */
export async function meetingHoldersIn(
  ports: HolderPorts,
  { meeting, skip }: { meeting: MeetingIdentity; skip: (holder: string) => boolean },
): Promise<Holders> {
  const { sql, parameters } = compileMeetingHoldersQuery({
    provider: meeting.provider,
    externalId: meeting.externalId,
  });
  const found = await ports.index.query(sql, parameters);
  const unsettled: string[] = [];
  const imported: string[] = [];
  for (const holder of found.rows.map((row) => String(row[0]))) {
    if (skip(holder) || isConflictCopyPath(holder)) continue;
    const held = await holdingAt(ports, { holder, meeting });
    if (held === 'imported') imported.push(holder);
    else if (held === 'unsettled') unsettled.push(holder);
  }
  return { unsettled, imported };
}

/** Whether a note holds the meeting now, and whether the import has let it in; null when it does not hold it. */
export async function holdingAt(
  { fs, markdown }: Pick<HolderPorts, 'fs' | 'markdown'>,
  { holder, meeting }: { holder: string; meeting: MeetingIdentity },
): Promise<'imported' | 'unsettled' | null> {
  let text: string;
  try {
    ({ text } = await fs.readTextFile(createVaultPath(holder)));
  } catch {
    // Gone since the index read it — moved or deleted: it holds nothing here now.
    return null;
  }
  return meetingHolding({
    text,
    readFrontmatter: (frontmatter) => readFrontmatter(markdown, frontmatter),
    meeting,
  });
}

/**
 * Lets a meeting in: stamped `imported`, and any import error it carried
 * from before it was fixed taken out. A file being typed in is left as it
 * is, and said so; it is let in when it next changes, or when the import
 * next looks over every arrival.
 */
export async function letIn(
  context: ImportContext,
  path: VaultPath,
): Promise<MeetingImportHappening> {
  const { text, modified } = await context.ports.fs.readTextFile(path);
  const { properties } = readFrontmatter(
    context.ports.markdown,
    splitFrontmatter(text).frontmatter,
  );
  const fixed = Object.hasOwn(properties, IMPORT_ERROR_KEY);
  const unsaved = await writeInto(context, {
    path,
    modified,
    values: { [IMPORT_OUTCOME_KEY]: 'imported', ...(fixed && { [IMPORT_ERROR_KEY]: null }) },
  });
  context.settled.add(path);
  if (unsaved !== null) return { kind: 'failed', path, problem: unsaved };
  return fixed ? { kind: 'fixed', path } : { kind: 'arrived', path };
}

/**
 * Archives a copy, then marks it where it landed: stamped `duplicate`,
 * `atlas_duplicate_of` its original, any import error it carried taken out.
 *
 * The move comes first so a copy is never left in the Inbox stamped as
 * settled: one whose move fails stays unstamped, and is archived when it is
 * next looked at. A `duplicate` stamp under `Inbox/Meetings/` then only ever
 * means the person brought the copy back, and it is left alone. A copy
 * being typed in is not moved, and said so.
 */
export async function archiveCopy(
  context: ImportContext,
  { path, original }: { path: VaultPath; original: VaultPath },
): Promise<MeetingImportHappening> {
  context.settled.add(path);
  if (context.ports.editors.state(path) === 'dirty') {
    return { kind: 'failed', path, problem: UNSAVED };
  }
  const notePaths = await everyNote(context);
  const outcome = await archiveNotes({
    ports: context.ports,
    paths: [path],
    notePaths,
    today: context.today,
    // The import is not the person: it never saves what someone is typing.
    unsavedTyping: 'leave',
  });
  const archivedTo = outcome.moves[0]?.move.to ?? null;
  const reasons = outcome.failed.map((failure) => failure.reason);
  if (archivedTo === null) {
    return { kind: 'duplicate', path, of: original, archivedTo, problem: reasons.join(' ') };
  }
  context.wrote = true;
  const marked = await markCopy(context, { path: archivedTo, original }).catch(
    (cause: unknown) => `Archived, but not marked as a copy: ${messageWithoutPaths(cause)}`,
  );
  const problems = [...reasons, ...(marked === null ? [] : [marked])];
  const problem = problems.length === 0 ? null : problems.join(' ');
  return { kind: 'duplicate', path, of: original, archivedTo, problem };
}

/** Writes a copy's stamp and its link to the original; why not, when it could not be. */
async function markCopy(
  context: ImportContext,
  { path, original }: { path: VaultPath; original: VaultPath },
): Promise<string | null> {
  const { text, modified } = await context.ports.fs.readTextFile(path);
  const { properties } = readFrontmatter(
    context.ports.markdown,
    splitFrontmatter(text).frontmatter,
  );
  return writeInto(context, {
    path,
    modified,
    values: {
      [IMPORT_OUTCOME_KEY]: 'duplicate',
      ...(Object.hasOwn(properties, IMPORT_ERROR_KEY) && { [IMPORT_ERROR_KEY]: null }),
      [DUPLICATE_OF_KEY]: duplicateLink(original),
    },
  });
}

/**
 * Every note in the vault, read from the index once a run. A copy archives to
 * its own path under `Archive/`, so the moves of one run never take each
 * other's place, and what the index read is enough to number around.
 */
async function everyNote(context: ImportContext): Promise<readonly VaultPath[]> {
  context.notePaths ??= (await context.ports.index.manifest()).map((entry) =>
    createVaultPath(entry.path),
  );
  return context.notePaths;
}

/** Writes the import's keys into a note (see `writeStamp`), and says the run wrote. */
export async function writeInto(
  context: ImportContext,
  args: Parameters<typeof writeStamp>[1],
): Promise<string | null> {
  const unsaved = await writeStamp(context.ports, args);
  if (unsaved === null) context.wrote = true;
  return unsaved;
}
