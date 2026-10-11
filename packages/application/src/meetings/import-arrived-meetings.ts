import {
  createVaultPath,
  IMPORT_ERROR_KEY,
  IMPORT_OUTCOME_KEY,
  importErrorText,
  importOutcomeOf,
  isConflictCopyPath,
  isMeetingInboxPath,
  meetingCandidates,
  meetingCopies,
  meetingImportReport,
  messageWithoutPaths,
  parentVaultPath,
  splitFrontmatter,
  type FrontmatterReading,
  type MeetingImport,
  type MeetingImportError,
  type MeetingImportHappening,
  type NoteChange,
  type VaultPath,
} from '@atlas/domain';
import type { ActivityRecorder } from '../activity/ports.ts';
import type { ArchivePorts } from '../archive/archive-notes.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import {
  archiveCopy,
  letIn,
  meetingHolders,
  writeInto,
  type ImportContext,
} from './meeting-files.ts';
import { meetingInboxNotes } from './meeting-inbox.ts';
import { readFrontmatter, validateMeetingFile } from './meeting-reading.ts';

/** What the import reaches: reading and writing notes, the index, the panes, and the Archive's move. */
export type MeetingImportPorts = ArchivePorts;

export interface MeetingImportRun {
  readonly ports: MeetingImportPorts;
  /** The day a duplicate is archived on, `YYYY-MM-DD`. */
  readonly today: string;
  /** Where each outcome is said: one line per meeting file. */
  readonly activity: ActivityRecorder;
}

export interface MeetingImportOutcome {
  /** What happened to each meeting file the import did something about, as Activity was told. */
  readonly happenings: readonly MeetingImportHappening[];
  /** Whether any note was written or moved, so what shows the vault reads it again. */
  readonly wrote: boolean;
}

/** Why the problem was not written into a file, as a clause the Activity line ends a sentence with. */
const UNSAVED_CLAUSE = 'it is open in Atlas with unsaved typing';
const UNREADABLE_FRONTMATTER = 'its frontmatter cannot be read, so nothing could be added to it';

/**
 * Imports the meeting files one sync brought in or changed (ADR-0027,
 * P28-04). The change feed only says where to look: what each file is due
 * comes from the file itself — see {@link importMeetings}.
 */
export async function importArrivedMeetings(
  run: MeetingImportRun & { readonly changes: readonly NoteChange[] },
): Promise<MeetingImportOutcome> {
  return importMeetings(run, meetingCandidates(run.changes));
}

/**
 * Imports every file where meeting files land that is not settled yet: what
 * the import does when it starts, so nothing the change feed did not report —
 * a fresh index's first sync, news heard while another Mac imports, a run
 * that failed — is left behind.
 */
export async function catchUpMeetings(run: MeetingImportRun): Promise<MeetingImportOutcome> {
  return importMeetings(run, await meetingInboxNotes(run.ports.fs));
}

/**
 * Settles each file where meeting files land that is not settled yet, and
 * stamps it `atlas_import_outcome` with how:
 *
 * - `imported` — it follows the contract and is its meeting's original (see
 *   `meetingCopies`); the stamp is the only line written.
 * - `duplicate` — another note holds the same meeting: marked
 *   `atlas_duplicate_of` the original, and archived.
 * - `error` — it breaks the contract: marked `atlas_import_error` with why,
 *   where it landed. A file stamped `error` is looked at again whenever it
 *   is, so a fix lets it in.
 *
 * A file stamped `imported` or `duplicate` is never judged again — an edit, a
 * rename, a move, an unarchive or a sync conflict's copy of it carries the
 * stamp — and a file with no stamp is an arrival not finished yet, whatever
 * the feed called it. Each outcome is one line in Activity; one file's
 * failure is said against that file, and the rest carry on.
 */
async function importMeetings(
  run: MeetingImportRun,
  paths: readonly string[],
): Promise<MeetingImportOutcome> {
  const context: ImportContext = { ...run, settled: new Set(), notePaths: null, wrote: false };
  const happenings: MeetingImportHappening[] = [];
  for (const path of paths) {
    if (context.settled.has(path)) continue;
    for (const happening of await importOne(context, createVaultPath(path))) {
      run.activity.record(meetingImportReport(happening));
      happenings.push(happening);
    }
  }
  return { happenings, wrote: context.wrote };
}

/** What happened to one file and the others of its meeting; empty when there was nothing to do or say. */
async function importOne(
  context: ImportContext,
  path: VaultPath,
): Promise<MeetingImportHappening[]> {
  try {
    const { markdown } = context.ports;
    const { text, modified } = await context.ports.fs.readTextFile(path);
    const reading = readFrontmatter(markdown, splitFrontmatter(text).frontmatter);
    const outcome = importOutcomeOf(reading.properties);
    // Settled: and a copy stamped where meetings land was brought back from the Archive by the person.
    if (outcome === 'imported' || outcome === 'duplicate') return [];
    // The other Mac's version of a meeting both changed: the person's to settle, never a copy.
    if (isConflictCopyPath(path)) return [{ kind: 'conflict', path }];
    const result = validateMeetingFile(markdown, text);
    if (result.ok) return await settleMeeting(context, { path, meeting: result.meeting });
    const refused = await refuse(context, { path, modified, text, reading, errors: result.errors });
    return refused === null ? [] : [refused];
  } catch (cause) {
    // Moved or deleted since the feed named it: there is nothing to settle, and the next sync says so.
    if (await isGone(context, path)) return [];
    return [{ kind: 'failed', path, problem: messageWithoutPaths(cause) }];
  }
}

/** Whether a note is no longer in its folder, as the folder lists it now. */
async function isGone(context: ImportContext, path: VaultPath): Promise<boolean> {
  const listed = await context.ports.fs.listDirectory(parentVaultPath(path)).catch(() => null);
  return listed !== null && !listed.some((entry) => entry.path === path);
}

/**
 * Stamps a file that breaks the contract `error`, with why, where it landed.
 * A file already saying the same is not news.
 */
async function refuse(
  context: ImportContext,
  {
    path,
    modified,
    text,
    reading,
    errors,
  }: {
    path: VaultPath;
    modified: number;
    text: string;
    reading: FrontmatterReading;
    errors: readonly MeetingImportError[];
  },
): Promise<MeetingImportHappening | null> {
  context.settled.add(path);
  if (reading.problem !== null) {
    const problem = importErrorText(errors);
    return { kind: 'invalid', path, problem, unmarked: UNREADABLE_FRONTMATTER };
  }
  const problem = problemAsMarked(context.ports.markdown, text, errors);
  const stamped = importOutcomeOf(reading.properties) === 'error';
  if (stamped && reading.properties[IMPORT_ERROR_KEY] === problem) return null;
  const unsaved = await writeInto(context, { path, modified, values: errorStamp(problem) });
  return { kind: 'invalid', path, problem, unmarked: unsaved === null ? null : UNSAVED_CLAUSE };
}

const errorStamp = (problem: string) => ({
  [IMPORT_OUTCOME_KEY]: 'error',
  [IMPORT_ERROR_KEY]: problem,
});

/**
 * The problems as the file will read once the stamp is in it. The stamp is
 * lines of the frontmatter — and, in a file with none, a block of its own —
 * so it moves every line below it: counted in the file as it was, a body
 * problem's line would be wrong once written, and the next look would write
 * it again. The stamp keeps its number of lines whatever it says, so the
 * lines counted with it in place stay right.
 */
function problemAsMarked(
  markdown: MarkdownPort,
  text: string,
  errors: readonly MeetingImportError[],
): string {
  const first = importErrorText(errors);
  const document = splitFrontmatter(text);
  const marked =
    markdown.updateFrontmatter(document.frontmatter, errorStamp(first)) + document.body;
  const again = validateMeetingFile(markdown, marked);
  return again.ok ? first : importErrorText(again.errors);
}

/**
 * A file that follows the contract, settled with the other notes of its
 * meeting: the original is let in when it sits where meeting files land and
 * is not in yet, and every copy there is archived. Each is said against its
 * own file, so one that cannot be written leaves the others settled.
 */
async function settleMeeting(
  context: ImportContext,
  { path, meeting }: { path: VaultPath; meeting: MeetingImport },
): Promise<MeetingImportHappening[]> {
  const { unsettled, imported } = await meetingHolders(context, { meeting, besides: path });
  const { original, copies } = meetingCopies([path, ...unsettled], imported);
  const kept = createVaultPath(original);
  const settling: { path: VaultPath; settle: () => Promise<MeetingImportHappening> }[] = [
    ...(imported.includes(original) || !isMeetingInboxPath(original)
      ? []
      : [{ path: kept, settle: () => letIn(context, kept) }]),
    ...copies.map((copy) => {
      const at = createVaultPath(copy);
      return { path: at, settle: () => archiveCopy(context, { path: at, original: kept }) };
    }),
  ];
  const happenings: MeetingImportHappening[] = [];
  for (const each of settling) {
    happenings.push(
      await each.settle().catch((cause: unknown): MeetingImportHappening => ({
        kind: 'failed',
        path: each.path,
        problem: messageWithoutPaths(cause),
      })),
    );
  }
  return happenings;
}
