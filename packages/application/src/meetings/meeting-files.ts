import {
  compileMeetingHoldersQuery,
  createVaultPath,
  DUPLICATE_OF_KEY,
  IMPORT_ERROR_KEY,
  splitFrontmatter,
  wikiLinkTargetFor,
  type MeetingImport,
  type MeetingImportHappening,
  type VaultPath,
} from '@atlas/domain';
import { archiveNotes } from '../archive/archive-notes.ts';
import { setNoteProperties } from '../query/set-property.ts';
import type { MeetingImportRun } from './import-arrived-meetings.ts';
import { readFrontmatter, validateMeetingFile } from './meeting-reading.ts';

/** One run of the import, and what it has done so far. */
export interface ImportContext extends MeetingImportRun {
  /** Copies this run archived, which are not looked at again when their own change comes up. */
  readonly settled: Set<string>;
  /** Whether a note was written or moved. */
  wrote: boolean;
}

export const UNSAVED = 'It is open in Atlas with unsaved typing, so the import left it as it is.';

/**
 * The other notes that hold a meeting now: the index names the notes that
 * held its provider + external_id when it last read them, and each is read
 * again, since the index is behind what the import writes and moves. A holder
 * follows the contract and carries no mark — a copy is no one's original, and
 * nor is a file failing import. Ids are compared without the spaces around
 * them, as the index keeps them.
 */
export async function meetingHolders(
  context: ImportContext,
  { meeting, besides }: { meeting: MeetingImport; besides: string },
): Promise<string[]> {
  const { sql, parameters } = compileMeetingHoldersQuery({
    provider: meeting.provider,
    externalId: meeting.externalId,
  });
  const found = await context.ports.index.query(sql, parameters);
  const holders: string[] = [];
  for (const holder of found.rows.map((row) => String(row[0]))) {
    if (holder === besides || context.settled.has(holder)) continue;
    if (await holdsMeeting(context, { holder, meeting })) holders.push(holder);
  }
  return holders;
}

async function holdsMeeting(
  context: ImportContext,
  { holder, meeting }: { holder: string; meeting: MeetingImport },
): Promise<boolean> {
  const { fs, markdown } = context.ports;
  let text: string;
  try {
    ({ text } = await fs.readTextFile(createVaultPath(holder)));
  } catch {
    // Gone since the index read it — moved or deleted: it holds nothing here now.
    return false;
  }
  const { properties } = readFrontmatter(markdown, splitFrontmatter(text).frontmatter);
  if (Object.hasOwn(properties, DUPLICATE_OF_KEY) || Object.hasOwn(properties, IMPORT_ERROR_KEY)) {
    return false;
  }
  const read = validateMeetingFile(markdown, text);
  return read.ok && sameMeeting(read.meeting, meeting);
}

const sameMeeting = (a: MeetingImport, b: MeetingImport) =>
  a.provider === b.provider && a.externalId.trim() === b.externalId.trim();

/**
 * Marks a copy `atlas_duplicate_of` its original — taking out any import
 * error it carried — and archives it. A copy being typed in is left as it is,
 * and said so.
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
    ...(Object.hasOwn(properties, IMPORT_ERROR_KEY) && { [IMPORT_ERROR_KEY]: null }),
    [DUPLICATE_OF_KEY]: `[[${wikiLinkTargetFor(original, notePaths)}]]`,
  };
  const unsaved = await writeInto(context, { path, modified, values });
  if (unsaved !== null) return { kind: 'failed', path, problem: unsaved };
  context.settled.add(path);
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
