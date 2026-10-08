import {
  createVaultPath,
  DUPLICATE_OF_KEY,
  IMPORT_ERROR_KEY,
  importErrorText,
  meetingCandidates,
  meetingCopies,
  meetingImportReport,
  messageWithoutPaths,
  splitFrontmatter,
  type FrontmatterReading,
  type MeetingCandidate,
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
  meetingHolders,
  writeInto,
  UNSAVED,
  type ImportContext,
} from './meeting-files.ts';
import { readFrontmatter, validateMeetingFile } from './meeting-reading.ts';

/** What the import reaches: reading and writing notes, the index, the panes, and the Archive's move. */
export type MeetingImportPorts = ArchivePorts;

/**
 * The versions of notes already looked at, so a change heard twice is said
 * once. `firstTime` remembers the version and says whether it was new.
 */
export interface SeenVersions {
  firstTime(path: string, digest: string): boolean;
}

export interface MeetingImportRun {
  readonly ports: MeetingImportPorts;
  /** One sync's changes, as the change feed published them. */
  readonly changes: readonly NoteChange[];
  /** The day a duplicate is archived on, `YYYY-MM-DD`. */
  readonly today: string;
  /** Where each outcome is said: one line per meeting file. */
  readonly activity: ActivityRecorder;
  /** What earlier runs looked at; omitted, nothing is remembered between runs. */
  readonly seen?: SeenVersions;
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
 * Imports the meetings one sync brought in, or changed, where meeting files
 * land (ADR-0027, P28-04). Every outcome is decided from what the files say
 * now — never from what was heard first — so a file looked at again, on this
 * Mac or another, comes to the same thing:
 *
 * - A file that follows the contract and is its meeting's original (see
 *   `meetingCopies`) is left byte for byte. Looking at it again does nothing.
 * - Any other holder of the meeting where meeting files land is a copy:
 *   marked `atlas_duplicate_of` the original, and archived.
 * - A file that breaks the contract is marked `atlas_import_error` with why,
 *   where it landed — when it arrived, or already carries a mark. One with no
 *   mark that changed is left alone: that is an edit to a meeting that
 *   imported, which is the person's business. Once a marked file reads, the
 *   mark is taken out and it is imported.
 *
 * So an arrival not finished the first time — its YAML unreadable, a pane
 * typing in it, a run that failed — is finished by the change that fixes it.
 * Each outcome is one line in Activity; one file's failure is said and the
 * rest carry on.
 */
export async function importArrivedMeetings(run: MeetingImportRun): Promise<MeetingImportOutcome> {
  const candidates = meetingCandidates(run.changes).filter(
    (candidate) => run.seen?.firstTime(candidate.path, candidate.digest) ?? true,
  );
  const context: ImportContext = { ...run, settled: new Set(), wrote: false };
  const happenings: MeetingImportHappening[] = [];
  for (const candidate of candidates) {
    // Archived already, as a copy of a meeting decided earlier in this run.
    if (context.settled.has(candidate.path)) continue;
    const path = createVaultPath(candidate.path);
    const said = await importOne(context, { candidate, path }).catch(
      (cause: unknown): MeetingImportHappening[] => [
        { kind: 'failed', path, problem: messageWithoutPaths(cause) },
      ],
    );
    for (const happening of said) {
      run.activity.record(meetingImportReport(happening));
      happenings.push(happening);
    }
  }
  return { happenings, wrote: context.wrote };
}

interface OneFile {
  readonly candidate: MeetingCandidate;
  readonly path: VaultPath;
}

/** What happened to one file and the copies it settled; empty when there was nothing to do or say. */
async function importOne(
  context: ImportContext,
  { candidate, path }: OneFile,
): Promise<MeetingImportHappening[]> {
  const { markdown } = context.ports;
  const { text, modified } = await context.ports.fs.readTextFile(path);
  const reading = readFrontmatter(markdown, splitFrontmatter(text).frontmatter);
  // A copy already marked was decided before; one brought back from the Archive stays.
  if (Object.hasOwn(reading.properties, DUPLICATE_OF_KEY)) return [];
  const marked = Object.hasOwn(reading.properties, IMPORT_ERROR_KEY);
  const result = validateMeetingFile(markdown, text);
  if (result.ok) {
    return accept(context, {
      path,
      modified,
      kind: candidate.kind,
      marked,
      meeting: result.meeting,
    });
  }
  // Unmarked and changed: an edit to a meeting that imported, not an arrival.
  if (!marked && candidate.kind === 'changed') return [];
  const refused = await refuse(context, { path, modified, text, reading, errors: result.errors });
  return refused === null ? [] : [refused];
}

/**
 * Marks a file that breaks the contract with why, where it landed. A file
 * already marked with the same words — by this Mac earlier, or by another
 * before it synced — is not news.
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
  if (reading.problem !== null) {
    const problem = importErrorText(errors);
    return { kind: 'invalid', path, problem, unmarked: UNREADABLE_FRONTMATTER };
  }
  const problem = problemAsMarked(context.ports.markdown, text, errors);
  if (reading.properties[IMPORT_ERROR_KEY] === problem) return null;
  const unsaved = await writeInto(context, {
    path,
    modified,
    values: { [IMPORT_ERROR_KEY]: problem },
  });
  return { kind: 'invalid', path, problem, unmarked: unsaved === null ? null : UNSAVED_CLAUSE };
}

/**
 * The problems as the file will read once the mark is in it. The mark is a
 * line of the frontmatter — and, in a file with none, a block of its own — so
 * it moves every line below it: counted in the file as it was, a body
 * problem's line would be wrong once written, and the next look would write
 * it again. The mark keeps its own number of lines whatever it says, so the
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
    markdown.updateFrontmatter(document.frontmatter, { [IMPORT_ERROR_KEY]: first }) + document.body;
  const again = validateMeetingFile(markdown, marked);
  return again.ok ? first : importErrorText(again.errors);
}

/**
 * A file that follows the contract. When it is its meeting's original, it is
 * left as it came — but for an import error from before it was fixed, taken
 * out — and every other copy where meeting files land is marked and archived.
 * Otherwise it is the copy.
 */
async function accept(
  context: ImportContext,
  {
    path,
    modified,
    kind,
    marked,
    meeting,
  }: {
    path: VaultPath;
    modified: number;
    kind: MeetingCandidate['kind'];
    marked: boolean;
    meeting: MeetingImport;
  },
): Promise<MeetingImportHappening[]> {
  const holders = await meetingHolders(context, { meeting, besides: path });
  const { original, copies } = meetingCopies([path, ...holders]);
  if (original !== path) {
    return [await archiveCopy(context, { path, original: createVaultPath(original) })];
  }
  const own = await settleOriginal(context, { path, modified, kind, marked });
  const others: MeetingImportHappening[] = [];
  for (const copy of copies) {
    others.push(await archiveCopy(context, { path: createVaultPath(copy), original: path }));
  }
  return [...(own === null ? [] : [own]), ...others];
}

/** The original as it is: news when it arrived, or when a mark had to come out; nothing otherwise. */
async function settleOriginal(
  context: ImportContext,
  {
    path,
    modified,
    kind,
    marked,
  }: { path: VaultPath; modified: number; kind: MeetingCandidate['kind']; marked: boolean },
): Promise<MeetingImportHappening | null> {
  if (!marked) return kind === 'arrived' ? { kind: 'arrived', path } : null;
  const unsaved = await writeInto(context, {
    path,
    modified,
    values: { [IMPORT_ERROR_KEY]: null },
  });
  return unsaved === null ? { kind: 'fixed', path } : { kind: 'failed', path, problem: UNSAVED };
}
