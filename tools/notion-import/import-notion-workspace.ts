import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  followsGtd,
  InvalidTypeError,
  messageWithoutPaths,
  parseObjectType,
  splitFrontmatter,
  taskTypeOf,
  type ObjectType,
  type VaultPath,
} from '../../packages/domain/src/index.ts';
import type { GeminiDates } from './gemini-dates.ts';
import type { RowOutcome } from './import-notion-meetings.ts';
import { ImportSetupError, importTarget } from './import-target.ts';
import { NOTHING, type ImportedPage } from './note-merge.ts';
import {
  checkRecordWritable,
  clearPending,
  notePending,
  pendingFile,
  readPending,
  readRecord,
  recordFile,
  saveRecord,
} from './record-file.ts';
import { taskStatuses } from './task-status.ts';
import { readFrontmatter } from './vault-meetings.ts';
import { vaultNotes } from './vault-notes.ts';
import { DATABASE_KINDS, PLACES, type DatabaseKind } from './workspace-databases.ts';
import { readWorkspaceExport, type ExportDatabase } from './workspace-export.ts';
import { MEETINGS_FOLDER, runMeetings } from './workspace-meetings.ts';
import {
  notesToRead,
  planWorkspace,
  type PagePlan,
  type Placed,
  type Skipped,
} from './workspace-plan.ts';
import { writePlanned } from './workspace-write.ts';

export interface WorkspaceImportOptions {
  /** The unzipped Notion export: "Markdown & CSV", with subpages. */
  readonly exportDir: string;
  /** The vault to write into. There is no default: it is always named. */
  readonly vault: string;
  /** Plans and reports everything, writing nothing. */
  readonly dryRun: boolean;
  /** The databases to bring in; null for all of them. */
  readonly only: readonly DatabaseKind[] | null;
  /** `Notion status=gtd-status` changes to the default task mapping. */
  readonly taskStatuses: readonly string[];
  /** The day of the run, `YYYY-MM-DD`, on the local clock. */
  readonly today: string;
  /** The zone UTC times are read in, for meetings and for dates' days. */
  readonly timeZone: string | null;
  /** How Gemini's meeting Dates are read (issue #44); left out, they are held. */
  readonly geminiDates?: GeminiDates;
  /** Makes again the notes of pages imported before whose notes were deleted in Atlas. */
  readonly recreateDeleted?: boolean;
  /** Whether a note no run recorded importing (the earlier one-off import's) is filled in where it lacks a property; on unless turned off. */
  readonly fillUnrecorded?: boolean;
}

const TASKS_NEED_GTD =
  "tasks: the vault's Task type is not GTD yet (#21), so a task's status would be one its type does not offer: run the GTD move first, or leave tasks out with --only";

/** What became of one page: on a dry run, a note to make or change is not `written`. */
export type PageOutcome =
  | Extract<PagePlan, { kind: 'unchanged' | 'deleted' | 'refused' }>
  | ({ readonly kind: 'create'; readonly written: boolean } & Placed)
  | ({
      readonly kind: 'update';
      readonly written: boolean;
      readonly changed: readonly string[];
      readonly kept: readonly string[];
      readonly filled: boolean;
    } & Placed);

/** What the whole run came to, for the report. */
export interface WorkspaceOutcome {
  readonly dryRun: boolean;
  readonly pages: readonly PageOutcome[];
  readonly skipped: readonly Skipped[];
  /** Images and attachments in the export, which are not brought in. */
  readonly otherFiles: number;
  /** The meeting import's rows; null when meetings were not chosen. */
  readonly meetings: readonly RowOutcome[] | null;
  /** What the person should know about the vault, such as a type it does not declare. */
  readonly warnings: readonly string[];
  /** Why the record could not be kept partway through, when it could not; the notes after it were not written. */
  readonly recordProblem: string | null;
}

/** The vault's types, by name, as their files in `.atlas/types` declare them; a file that does not read is none. */
async function vaultTypes(vault: string): Promise<Map<string, ObjectType>> {
  const folder = join(vault, '.atlas', 'types');
  const files = await readdir(folder).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const types = new Map<string, ObjectType>();
  for (const file of files.filter((name) => name.toLowerCase().endsWith('.md'))) {
    const frontmatter = splitFrontmatter(await readFile(join(folder, file), 'utf8')).frontmatter;
    if (frontmatter === null) continue;
    try {
      const type = parseObjectType(readFrontmatter(frontmatter).properties);
      types.set(type.name, type);
    } catch (error) {
      // A type file that does not read declares no type: a check that needs it refuses for want of one.
      if (!(error instanceof InvalidTypeError)) throw error;
    }
  }
  return types;
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** The text of each note a page is already in; null for one that is not UTF-8, which is never rewritten. */
async function noteTexts(vault: string, paths: readonly VaultPath[]) {
  const texts = new Map<VaultPath, string | null>();
  for (const path of paths) {
    try {
      texts.set(path, UTF8.decode(await readFile(join(vault, path))));
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      texts.set(path, null);
    }
  }
  return texts;
}

/** The vault, checked as the meeting import checks it, with every folder this run may write into. */
async function vaultFolder(vault: string): Promise<string> {
  const folders = [
    ...new Set([
      ...Object.values(PLACES)
        .map((place) => place.folder)
        .filter((folder) => folder !== ''),
      MEETINGS_FOLDER,
    ]),
  ];
  const targets = await Promise.all(folders.map((folder) => importTarget({ vault, folder })));
  return targets[0]?.vault ?? vault;
}

/** Stops the run before anything is written when tasks are to come in and the vault's Task type is not GTD. */
function checkTasks(
  types: ReadonlyMap<string, ObjectType>,
  databases: readonly ExportDatabase[],
  selected: ReadonlySet<DatabaseKind>,
) {
  if (!selected.has('tasks') || !databases.some((database) => database.kind === 'tasks')) return;
  const task = taskTypeOf([...types.values()]);
  if (task === null || !followsGtd(task)) throw new ImportSetupError(TASKS_NEED_GTD);
}

/** The types this run writes notes of that the vault does not declare, for the report. */
function typeWarnings(
  types: ReadonlyMap<string, ObjectType>,
  plans: readonly PagePlan[],
): string[] {
  const written = new Set(
    plans.flatMap((plan) => (plan.kind === 'create' || plan.kind === 'update' ? [plan.type] : [])),
  );
  return [...written]
    .filter((type) => !types.has(type))
    .map(
      (type) =>
        `the vault declares no ${type} type: its notes are written with type: ${type}. Open the vault in Atlas first, which adds the types it builds in, or add the type.`,
    );
}

/** A planned write as the report shows it, without the text written. */
function shownOf(
  plan: Extract<PagePlan, { kind: 'create' | 'update' }>,
  written: boolean,
): PageOutcome {
  const { database, title, id, path, type, notes, imported } = plan;
  const placed = { database, title, id, path, type, notes, imported, written };
  if (plan.kind === 'create') return { kind: 'create', ...placed };
  return { kind: 'update', ...placed, changed: plan.changed, kept: plan.kept, filled: plan.filled };
}

/** How many notes are written between saves of the record. */
const RECORD_EVERY = 25;

/** Where the writes keep the record and its write-ahead log, and what they have recorded so far. */
interface Recording {
  readonly path: string;
  readonly pending: string;
  readonly record: Map<string, ImportedPage>;
}

/** Saves the record, then empties the log it has caught up with; why it could not, or null. A failure that is not the disk's is the run's. */
async function saved(recording: Recording): Promise<string | null> {
  try {
    await saveRecord(recording.path, recording.record);
    await clearPending(recording.pending);
    return null;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error)) throw error;
    return `the record could not be written (${messageWithoutPaths(error)})`;
  }
}

/**
 * Writes what the plan says, page by page, saving the record every few
 * notes and at the end. Before a note is made, its page goes into the
 * record's write-ahead log, so a run cut off between saves leaves no note
 * the next run does not know it made; a note brought into step already says
 * what the record would. A page whose write fails is refused and the rest go
 * on; once the record cannot be saved, no further note is written. With no
 * recording (a dry run), nothing is.
 */
async function written(plans: readonly PagePlan[], vault: string, recording: Recording | null) {
  const outcomes: PageOutcome[] = [];
  let problem: string | null = null;
  let unsaved = 0;
  for (const plan of plans) {
    if (plan.kind === 'unchanged' && plan.unrecorded !== true) {
      recording?.record.set(plan.id, plan.imported);
    }
    if (plan.kind !== 'create' && plan.kind !== 'update') {
      outcomes.push(plan);
      continue;
    }
    if (recording === null) {
      outcomes.push(shownOf(plan, false));
      continue;
    }
    const result =
      problem === null
        ? await logged(plan, recording, () => writePlanned(vault, plan))
        : { ok: false as const, reason: `not written: ${problem}` };
    if (!result.ok) {
      outcomes.push({
        kind: 'refused',
        database: plan.database,
        title: plan.title,
        reason: result.reason,
      });
      continue;
    }
    outcomes.push(shownOf(plan, true));
    recording.record.set(plan.id, plan.imported);
    unsaved += 1;
    if (unsaved >= RECORD_EVERY) {
      problem = await saved(recording);
      unsaved = 0;
    }
  }
  if (recording !== null && problem === null) problem = await saved(recording);
  return { outcomes, problem };
}

/** A note's write, with a new note's page put in the log first, and taken out again when it was not made. */
async function logged(
  plan: Extract<PagePlan, { kind: 'create' | 'update' }>,
  recording: Recording,
  write: () => ReturnType<typeof writePlanned>,
): ReturnType<typeof writePlanned> {
  if (plan.kind === 'update') return write();
  await notePending(recording.pending, `+${plan.id}`);
  const result = await write();
  if (!result.ok) await notePending(recording.pending, `-${plan.id}`);
  return result;
}

/**
 * The record with the pages its log says may have notes it has not caught
 * up with: each counts as imported, with nothing known of what, so its note
 * is found in step if it is there, and taken as deleted if it is not.
 */
function caughtUp(record: ReadonlyMap<string, ImportedPage>, pending: ReadonlySet<string>) {
  const known = new Map(record);
  for (const id of pending) if (!known.has(id)) known.set(id, { fields: {}, body: NOTHING });
  return known;
}

const leftOutByOnly = (
  databases: readonly ExportDatabase[],
  selected: ReadonlySet<DatabaseKind>,
): Skipped[] =>
  databases.flatMap((database) => {
    if (database.kind === null)
      return [{ what: database.csvFile, reason: 'not a database this import knows' }];
    return selected.has(database.kind)
      ? []
      : [{ what: database.name, reason: 'left out by --only' }];
  });

/** Everything the run checks before it writes anything, and what it read doing so. */
async function setUp(options: WorkspaceImportOptions) {
  const vault = await vaultFolder(options.vault);
  const recordPath = await recordFile(vault);
  const statuses = taskStatuses(options.taskStatuses);
  const workspace = await readWorkspaceExport(options.exportDir);
  const selected = new Set(options.only ?? DATABASE_KINDS);
  const types = await vaultTypes(vault);
  checkTasks(types, workspace.databases, selected);
  const record = caughtUp(await readRecord(recordPath), await readPending(pendingFile(recordPath)));
  return { vault, recordPath, statuses, workspace, selected, types, record };
}

/**
 * Brings a Notion workspace export into a vault (issue #79): tasks, notes,
 * people, PARA, teams and daily notes as notes of their types, relations as
 * links, and the Meeting Notes through the meeting import (P28-07). The
 * meetings go first, so links to them name their notes; then every other
 * page is planned before anything is written, so each link names the note
 * it will open. A page already in the vault, by its `notion_id`, is brought
 * into step where Atlas has not changed it since the last run, and the run
 * records what it brought in so the next one can tell. Nothing is written
 * on a dry run. Every page comes back with what became of it.
 */
export async function importNotionWorkspace(
  options: WorkspaceImportOptions,
): Promise<WorkspaceOutcome> {
  const { vault, recordPath, statuses, workspace, selected, types, record } = await setUp(options);
  // Before the meetings too: nothing is written unless the record can be.
  if (!options.dryRun) await checkRecordWritable(recordPath);
  const meetingsChosen = selected.has('meetings');
  const meetings = await runMeetings(workspace.databases, {
    vault,
    timeZone: options.timeZone,
    dryRun: options.dryRun || !meetingsChosen,
    ...(options.geminiDates === undefined ? {} : { geminiDates: options.geminiDates }),
  });
  const read = {
    databases: workspace.databases,
    vault: await vaultNotes(vault),
    record,
    recreateDeleted: options.recreateDeleted === true,
    timeZone: options.timeZone,
  };
  const plan = planWorkspace({
    ...read,
    selected,
    texts: await noteTexts(vault, notesToRead(read)),
    statuses,
    today: options.today,
    meetingPaths: meetings.paths,
    meetingIds: meetings.ids,
    fillUnrecorded: options.fillUnrecorded !== false,
  });
  const recording = options.dryRun
    ? null
    : { path: recordPath, pending: pendingFile(recordPath), record: new Map(record) };
  const { outcomes, problem } = await written(plan.pages, vault, recording);
  const hasMeetings = workspace.databases.some((database) => database.kind === 'meetings');
  return {
    dryRun: options.dryRun,
    pages: outcomes,
    skipped: [
      ...leftOutByOnly(workspace.databases, selected),
      ...plan.skipped,
      ...workspace.otherPages.map((what) => ({
        what,
        reason: 'not a row of a database this import brings in',
      })),
    ],
    otherFiles: workspace.otherFiles,
    meetings: meetingsChosen && hasMeetings ? meetings.rows : null,
    warnings: typeWarnings(types, plan.pages),
    recordProblem: problem,
  };
}
