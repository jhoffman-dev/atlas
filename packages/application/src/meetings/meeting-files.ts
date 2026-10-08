import {
  compileMeetingHoldersQuery,
  createVaultPath,
  DUPLICATE_OF_KEY,
  IMPORT_ERROR_KEY,
  IMPORT_OUTCOME_KEY,
  importOutcomeOf,
  splitFrontmatter,
  wikiLinkTargetFor,
  type MeetingImport,
  type MeetingImportHappening,
  type VaultPath,
} from '@atlas/domain';
import { archiveNotes, type ArchivePorts } from '../archive/archive-notes.ts';
import type { ActivityRecorder } from '../activity/ports.ts';
import { setNoteProperties } from '../query/set-property.ts';
import { readFrontmatter, validateMeetingFile } from './meeting-reading.ts';

/** One run of the import, and what it has done so far. */
export interface ImportContext {
  readonly ports: ArchivePorts;
  /** The day a copy is archived on, `YYYY-MM-DD`. */
  readonly today: string;
  readonly activity: ActivityRecorder;
  /** Files this run has settled, which are not looked at again when their own turn comes. */
  readonly settled: Set<string>;
  /** Whether a note was written or moved. */
  wrote: boolean;
}

export const UNSAVED = 'It is open in Atlas with unsaved typing, so the import left it as it is.';

/** The notes holding a meeting now, and which of them the import has already let in. */
export interface Holders {
  readonly unsettled: readonly string[];
  readonly imported: readonly string[];
}

/**
 * The other notes that hold a meeting now: the index names the notes that
 * held its provider + external_id when it last read them, and each is read
 * again, since the index is behind what the import writes and moves. A holder
 * follows the contract and is not a copy or a file failing import; it is
 * `imported` once the import has let it in. Ids are compared without the
 * spaces around them, as the index keeps them.
 */
export async function meetingHolders(
  context: ImportContext,
  { meeting, besides }: { meeting: MeetingImport; besides: string },
): Promise<Holders> {
  const { sql, parameters } = compileMeetingHoldersQuery({
    provider: meeting.provider,
    externalId: meeting.externalId,
  });
  const found = await context.ports.index.query(sql, parameters);
  const unsettled: string[] = [];
  const imported: string[] = [];
  for (const holder of found.rows.map((row) => String(row[0]))) {
    if (holder === besides || context.settled.has(holder)) continue;
    const held = await holding(context, { holder, meeting });
    if (held === 'imported') imported.push(holder);
    else if (held === 'unsettled') unsettled.push(holder);
  }
  return { unsettled, imported };
}

/** Whether a note holds the meeting now, and whether the import has let it in; null when it does not hold it. */
async function holding(
  context: ImportContext,
  { holder, meeting }: { holder: string; meeting: MeetingImport },
): Promise<'imported' | 'unsettled' | null> {
  const { fs, markdown } = context.ports;
  let text: string;
  try {
    ({ text } = await fs.readTextFile(createVaultPath(holder)));
  } catch {
    // Gone since the index read it — moved or deleted: it holds nothing here now.
    return null;
  }
  const { properties } = readFrontmatter(markdown, splitFrontmatter(text).frontmatter);
  const outcome = importOutcomeOf(properties);
  if (outcome === 'duplicate' || outcome === 'error') return null;
  if (Object.hasOwn(properties, DUPLICATE_OF_KEY) || Object.hasOwn(properties, IMPORT_ERROR_KEY)) {
    return null;
  }
  const read = validateMeetingFile(markdown, text);
  if (!read.ok || !sameMeeting(read.meeting, meeting)) return null;
  return outcome === 'imported' ? 'imported' : 'unsettled';
}

const sameMeeting = (a: MeetingImport, b: MeetingImport) =>
  a.provider === b.provider && a.externalId.trim() === b.externalId.trim();

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
 * Marks a copy `duplicate`, `atlas_duplicate_of` its original — taking out
 * any import error it carried — and archives it. A copy being typed in is
 * left as it is, and said so.
 */
export async function archiveCopy(
  context: ImportContext,
  { path, original }: { path: VaultPath; original: VaultPath },
): Promise<MeetingImportHappening> {
  const { text, modified } = await context.ports.fs.readTextFile(path);
  const { properties } = readFrontmatter(
    context.ports.markdown,
    splitFrontmatter(text).frontmatter,
  );
  const notePaths = (await context.ports.index.manifest()).map((entry) =>
    createVaultPath(entry.path),
  );
  const values = {
    [IMPORT_OUTCOME_KEY]: 'duplicate',
    ...(Object.hasOwn(properties, IMPORT_ERROR_KEY) && { [IMPORT_ERROR_KEY]: null }),
    [DUPLICATE_OF_KEY]: `[[${wikiLinkTargetFor(original, notePaths)}]]`,
  };
  const unsaved = await writeInto(context, { path, modified, values });
  context.settled.add(path);
  if (unsaved !== null) return { kind: 'failed', path, problem: unsaved };
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
  const problem = reasons.length === 0 ? null : reasons.join(' ');
  return { kind: 'duplicate', path, of: original, archivedTo, problem };
}

/**
 * Writes properties into a note as it was read — refused if it changed
 * since — and has any pane showing it read it again. A note being typed in
 * is never written: why is said instead.
 */
export async function writeInto(
  context: ImportContext,
  {
    path,
    modified,
    values,
  }: { path: VaultPath; modified: number; values: Readonly<Record<string, unknown>> },
): Promise<string | null> {
  const { ports } = context;
  if (ports.editors.state(path) === 'dirty') return UNSAVED;
  await setNoteProperties({
    fs: ports.fs,
    markdown: ports.markdown,
    path,
    values,
    ifModified: modified,
  });
  context.wrote = true;
  if (ports.editors.state(path) === 'clean') ports.editors.reload(path);
  return null;
}
