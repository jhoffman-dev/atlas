import {
  compileMeetingHoldersQuery,
  createVaultPath,
  digestOf,
  DUPLICATE_OF_KEY,
  duplicateDecision,
  IMPORT_ERROR_KEY,
  importErrorText,
  MEETING_TYPE,
  meetingCandidates,
  meetingImportReport,
  messageWithoutPaths,
  splitFrontmatter,
  validateMeetingImport,
  wikiLinkTargetFor,
  type DuplicateDecision,
  type FrontmatterReading,
  type MeetingCandidate,
  type MeetingImport,
  type MeetingImportHappening,
  type NoteChange,
  type VaultPath,
} from '@atlas/domain';
import type { ActivityRecorder } from '../activity/ports.ts';
import { archiveNotes, type ArchivePorts } from '../archive/archive-notes.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { setNoteProperties } from '../query/set-property.ts';

/** What the import reaches: reading and writing notes, the index, the panes, and the Archive's move. */
export type MeetingImportPorts = ArchivePorts;

/**
 * The versions of notes already looked at, so a change heard twice is acted
 * on once. `firstTime` remembers the version and says whether it was new.
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

const UNSAVED = 'It is open in Atlas with unsaved typing, so the import left it as it is.';
/** Why the problem was not written into a file, as a clause the Activity line ends a sentence with. */
const UNSAVED_CLAUSE = 'it is open in Atlas with unsaved typing';
const UNREADABLE_FRONTMATTER = 'its frontmatter cannot be read, so nothing could be added to it';

/**
 * Imports the meetings one sync brought in (ADR-0027, P28-04).
 *
 * A file that arrived where meeting files land is checked against the
 * meeting import contract. One that follows it and is the first copy of its
 * meeting is left exactly as it came, and waits in the Inbox. A second copy —
 * the same provider + external_id as a meeting the vault already has — is
 * marked `atlas_duplicate_of` the first, and archived, which can be undone. A
 * file that breaks the contract stays where it landed and is marked
 * `atlas_import_error` with why; once it is fixed, the mark is taken out and
 * it is imported as if it had just arrived.
 *
 * Each outcome is one line in Activity. Nothing is decided from what the
 * index alone says about a file: it is read, and a file that changed since
 * the sync reported it is left for the sync that reports the new version.
 * One file's failure is said and the rest carry on.
 */
export async function importArrivedMeetings(run: MeetingImportRun): Promise<MeetingImportOutcome> {
  const candidates = meetingCandidates(run.changes).filter(
    (candidate) => run.seen?.firstTime(candidate.path, candidate.digest) ?? true,
  );
  const batch: Batch = {
    pending: new Set(candidates.filter(isArrival).map((candidate) => candidate.path)),
    refused: new Set(),
    wrote: false,
  };
  const happenings: MeetingImportHappening[] = [];
  for (const candidate of candidates) {
    batch.pending.delete(candidate.path);
    const path = createVaultPath(candidate.path);
    const happening = await importOne({ run, batch, candidate, path }).catch(
      (cause: unknown): MeetingImportHappening => ({
        kind: 'failed',
        path,
        problem: messageWithoutPaths(cause),
      }),
    );
    if (happening === null) continue;
    run.activity.record(meetingImportReport(happening));
    happenings.push(happening);
  }
  return { happenings, wrote: batch.wrote };
}

/** What one run has learnt so far, which the files after it are decided by. */
interface Batch {
  /** Files that arrived in this sync and are not decided yet: none is yet anyone's original. */
  readonly pending: Set<string>;
  /** Files found to break the contract: none is anyone's original, whatever the index says. */
  readonly refused: Set<string>;
  wrote: boolean;
}

interface OneFile {
  readonly run: MeetingImportRun;
  readonly batch: Batch;
  readonly candidate: MeetingCandidate;
  readonly path: VaultPath;
}

const isArrival = (candidate: MeetingCandidate) => candidate.kind === 'arrived';

/** What happened to one file, or null when there was nothing to do or say. */
async function importOne(file: OneFile): Promise<MeetingImportHappening | null> {
  const { run, candidate, path } = file;
  const { text, modified } = await run.ports.fs.readTextFile(path);
  // Changed again since this sync looked: the next sync reports that version.
  if (digestOf(text) !== candidate.digest) return null;
  const reading = readFrontmatter(run.ports.markdown, splitFrontmatter(text).frontmatter);
  // A copy already marked was decided before; one brought back from the Archive stays.
  if (Object.hasOwn(reading.properties, DUPLICATE_OF_KEY)) return null;
  const marked = Object.hasOwn(reading.properties, IMPORT_ERROR_KEY);
  // An edit to a meeting that imported is the person's own business, not the import's.
  if (candidate.kind === 'changed' && !marked) return null;

  const result = validateMeetingImport({
    text,
    readFrontmatter: (frontmatter) => readFrontmatter(run.ports.markdown, frontmatter),
    // Who `You` is changes how a turn is read, never whether the file follows the contract.
    selfName: null,
  });
  const written = { file, modified };
  if (!result.ok) {
    file.batch.refused.add(path);
    return refuse(written, { reading, problem: importErrorText(result.errors) });
  }
  return accept(written, { meeting: result.meeting, marked });
}

function readFrontmatter(markdown: MarkdownPort, frontmatter: string | null): FrontmatterReading {
  const problem = markdown.frontmatterProblem(frontmatter);
  return {
    properties: problem === null ? markdown.frontmatterProperties(frontmatter) : {},
    problem,
  };
}

/** A file as it was read, and when, so a write to it is refused if it moved on since. */
interface ReadFile {
  readonly file: OneFile;
  readonly modified: number;
}

/**
 * Marks a file that breaks the contract with why, where it landed. A file
 * already marked with the same words — by this Mac earlier, or by another
 * before it synced — is not news.
 */
async function refuse(
  { file, modified }: ReadFile,
  { reading, problem }: { reading: FrontmatterReading; problem: string },
): Promise<MeetingImportHappening | null> {
  if (reading.properties[IMPORT_ERROR_KEY] === problem) return null;
  const { path } = file;
  if (reading.problem !== null) {
    return { kind: 'invalid', path, problem, unmarked: UNREADABLE_FRONTMATTER };
  }
  const unsaved = await writeInto(file, { modified, values: { [IMPORT_ERROR_KEY]: problem } });
  return { kind: 'invalid', path, problem, unmarked: unsaved === null ? null : UNSAVED_CLAUSE };
}

/**
 * A file that follows the contract: left as it came when it is the first
 * copy of its meeting; otherwise marked as the copy it is, and archived. An
 * import error it carried from before it was fixed is taken out in the same
 * write.
 */
async function accept(
  { file, modified }: ReadFile,
  { meeting, marked }: { meeting: MeetingImport; marked: boolean },
): Promise<MeetingImportHappening> {
  const { path } = file;
  const decision = await decide(file, meeting);
  const cleared = marked ? { [IMPORT_ERROR_KEY]: null } : {};
  if (decision.kind === 'original') {
    if (!marked) return { kind: 'arrived', path };
    const unsaved = await writeInto(file, { modified, values: cleared });
    return unsaved === null ? { kind: 'fixed', path } : { kind: 'failed', path, problem: unsaved };
  }
  const notePaths = await everyNote(file.run.ports);
  const original = createVaultPath(decision.of);
  const link = `[[${wikiLinkTargetFor(original, notePaths)}]]`;
  const unsaved = await writeInto(file, {
    modified,
    values: { ...cleared, [DUPLICATE_OF_KEY]: link },
  });
  if (unsaved !== null) return { kind: 'failed', path, problem: unsaved };
  return archiveCopy(file, { original, notePaths });
}

/**
 * Whether a meeting is the first copy. The index says which notes held its
 * id when it last read them; each is read again, since the index can be
 * behind what this run, or the one before it, has written or moved since.
 */
async function decide(file: OneFile, meeting: MeetingImport): Promise<DuplicateDecision> {
  const { sql, parameters } = compileMeetingHoldersQuery({
    provider: meeting.provider,
    externalId: meeting.externalId,
  });
  const found = await file.run.ports.index.query(sql, parameters);
  const holders: string[] = [];
  for (const holder of found.rows.map((row) => String(row[0]))) {
    if (holder === file.path || file.batch.refused.has(holder)) continue;
    if (await stillHolds(file.run.ports, { holder, meeting })) holders.push(holder);
  }
  return duplicateDecision({ path: file.path, holders, pending: file.batch.pending });
}

/** Whether a note holds the meeting's id now, unmarked: one a copy could be a copy of. */
async function stillHolds(
  ports: MeetingImportPorts,
  { holder, meeting }: { holder: string; meeting: MeetingImport },
): Promise<boolean> {
  let text: string;
  try {
    ({ text } = await ports.fs.readTextFile(createVaultPath(holder)));
  } catch {
    // Gone since the index read it — moved or deleted: it holds nothing here now.
    return false;
  }
  const properties = readFrontmatter(ports.markdown, splitFrontmatter(text).frontmatter).properties;
  return (
    properties['type'] === MEETING_TYPE &&
    properties['provider'] === meeting.provider &&
    properties['external_id'] === meeting.externalId &&
    !Object.hasOwn(properties, DUPLICATE_OF_KEY) &&
    !Object.hasOwn(properties, IMPORT_ERROR_KEY)
  );
}

/** Every note the index holds, which it does as of the sync this run heard. */
async function everyNote(ports: MeetingImportPorts): Promise<VaultPath[]> {
  return (await ports.index.manifest()).map((entry) => createVaultPath(entry.path));
}

async function archiveCopy(
  file: OneFile,
  { original, notePaths }: { original: VaultPath; notePaths: readonly VaultPath[] },
): Promise<MeetingImportHappening> {
  const { path, run } = file;
  const outcome = await archiveNotes({
    ports: run.ports,
    paths: [path],
    notePaths,
    today: run.today,
    // The import is not the person: it never saves what someone is typing.
    unsavedTyping: 'leave',
  });
  const archivedTo = outcome.moves[0]?.move.to ?? null;
  if (archivedTo !== null) file.batch.wrote = true;
  const reasons = outcome.failed.map((failure) => failure.reason);
  const problem = reasons.length === 0 ? null : reasons.join(' ');
  return { kind: 'duplicate', path, of: original, archivedTo, problem };
}

/**
 * Writes properties into the file as it was read — refused if it changed
 * since — and has any pane showing it read it again. A file being typed in
 * is never written: why is said instead.
 */
async function writeInto(
  file: OneFile,
  { modified, values }: { modified: number; values: Readonly<Record<string, unknown>> },
): Promise<string | null> {
  const { ports } = file.run;
  if (ports.editors.state(file.path) === 'dirty') return UNSAVED;
  await setNoteProperties({
    fs: ports.fs,
    markdown: ports.markdown,
    path: file.path,
    values,
    ifModified: modified,
  });
  file.batch.wrote = true;
  if (ports.editors.state(file.path) === 'clean') ports.editors.reload(file.path);
  return null;
}
