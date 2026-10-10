import { mkdir, readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  InvalidTypeError,
  parseObjectType,
  splitFrontmatter,
  type ObjectType,
  type VaultPath,
} from '../../packages/domain/src/index.ts';
import type { GeminiDates } from './gemini-dates.ts';
import { importNotionMeetings, type RowOutcome } from './import-notion-meetings.ts';
import {
  ImportRecordError,
  parseRecord,
  recordText,
  RECORD_PATH,
  type ImportRecord,
} from './import-record.ts';
import { ImportSetupError, importTarget } from './import-target.ts';
import { stageFile } from './staged-file.ts';
import { isGtdTaskType, taskStatuses } from './task-status.ts';
import { readFrontmatter } from './vault-meetings.ts';
import { vaultNotes } from './vault-notes.ts';
import { DATABASE_KINDS, PLACES, type DatabaseKind } from './workspace-databases.ts';
import { readWorkspaceExport, type ExportDatabase } from './workspace-export.ts';
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
  /** The zone the meeting import reads UTC times in. */
  readonly timeZone: string | null;
  /** How Gemini's meeting Dates are read (issue #44); left out, they are held. */
  readonly geminiDates?: GeminiDates;
}

/** Where the meeting import writes, as it does when run alone. */
const MEETINGS_FOLDER = 'Inbox/Meetings';

const TASKS_NEED_GTD =
  "tasks: the vault's Task type is not GTD yet (#21), so a task's status would be one its type does not offer: run the GTD move first, or leave tasks out with --only";

/** What became of one page: on a dry run, a note to make or change is not `written`. */
export type PageOutcome =
  | Extract<PagePlan, { kind: 'unchanged' | 'refused' }>
  | ({ readonly kind: 'create'; readonly written: boolean } & Placed)
  | ({
      readonly kind: 'update';
      readonly written: boolean;
      readonly changed: readonly string[];
      readonly kept: readonly string[];
    } & Placed);

/** What the whole run came to, for the report. */
export interface WorkspaceOutcome {
  readonly dryRun: boolean;
  readonly pages: readonly PageOutcome[];
  readonly skipped: readonly Skipped[];
  /** Images and attachments in the export, which are not brought in. */
  readonly otherFiles: number;
  /** The meeting import's rows; null when it did not run. */
  readonly meetings: readonly RowOutcome[] | null;
}

/** The vault's Task type, as its file in `.atlas/types` declares it; null when it has none that reads. */
async function vaultTaskType(vault: string): Promise<ObjectType | null> {
  const folder = join(vault, '.atlas', 'types');
  const files = await readdir(folder).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const file of files.filter((name) => name.toLowerCase().endsWith('.md'))) {
    const frontmatter = splitFrontmatter(await readFile(join(folder, file), 'utf8')).frontmatter;
    if (frontmatter === null) continue;
    try {
      const type = parseObjectType(readFrontmatter(frontmatter).properties);
      if (type.name === 'task') return type;
    } catch (error) {
      // A type file that does not read is no Task type: the check below refuses for want of one.
      if (!(error instanceof InvalidTypeError)) throw error;
    }
  }
  return null;
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** The record of the last run; empty before the first. One that cannot be read stops the run. */
async function readRecord(vault: string): Promise<ImportRecord> {
  let bytes: Buffer;
  try {
    bytes = await readFile(join(vault, RECORD_PATH));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
    throw error;
  }
  try {
    return parseRecord(UTF8.decode(bytes));
  } catch (error) {
    if (error instanceof TypeError)
      throw new ImportSetupError(new ImportRecordError('it is not UTF-8 text').message);
    if (error instanceof ImportRecordError) throw new ImportSetupError(error.message);
    throw error;
  }
}

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
    ...new Set([...Object.values(PLACES).map((place) => place.folder), MEETINGS_FOLDER]),
  ];
  const targets = await Promise.all(folders.map((folder) => importTarget({ vault, folder })));
  return targets[0]?.vault ?? vault;
}

/** Stops the run before anything is written when tasks are to come in and the vault's Task type is not GTD. */
async function checkTasks(
  vault: string,
  databases: readonly ExportDatabase[],
  selected: ReadonlySet<DatabaseKind>,
) {
  if (!selected.has('tasks') || !databases.some((database) => database.kind === 'tasks')) return;
  if (!isGtdTaskType(await vaultTaskType(vault))) throw new ImportSetupError(TASKS_NEED_GTD);
}

/** A planned write as the report shows it, without the text written. */
function shownOf(
  plan: Extract<PagePlan, { kind: 'create' | 'update' }>,
  written: boolean,
): PageOutcome {
  const { database, title, id, path, notes, imported } = plan;
  const placed = { database, title, id, path, notes, imported, written };
  if (plan.kind === 'create') return { kind: 'create', ...placed };
  return { kind: 'update', ...placed, changed: plan.changed, kept: plan.kept };
}

/** Writes what the plan says, page by page; a page whose write fails is refused, and the rest go on. */
async function written(
  vault: string,
  plans: readonly PagePlan[],
  dryRun: boolean,
): Promise<PageOutcome[]> {
  const outcomes: PageOutcome[] = [];
  for (const plan of plans) {
    if (plan.kind !== 'create' && plan.kind !== 'update') {
      outcomes.push(plan);
      continue;
    }
    const result = dryRun ? { ok: true as const } : await writePlanned(vault, plan);
    outcomes.push(
      result.ok
        ? shownOf(plan, !dryRun)
        : { kind: 'refused', database: plan.database, title: plan.title, reason: result.reason },
    );
  }
  return outcomes;
}

/**
 * The record after this run: what it brought in for every page it wrote or
 * found in step, and what earlier runs brought in for the rest. Written
 * whole under a hidden name and put in place in one step, and only when it
 * says something new, so a run that changes nothing writes nothing.
 */
async function keepRecord(vault: string, record: ImportRecord, outcomes: readonly PageOutcome[]) {
  const next = new Map(record);
  for (const outcome of outcomes) {
    if (outcome.kind === 'refused') continue;
    next.set(outcome.id, outcome.imported);
  }
  const text = recordText(next);
  const path = join(vault, RECORD_PATH);
  const before = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (before === text) return;
  await mkdir(dirname(path), { recursive: true });
  const staged = await stageFile(dirname(path), text);
  try {
    await staged.replace(path);
  } finally {
    await staged.discard();
  }
}

/** The meeting import (P28-07), for each Meeting Notes database chosen. */
async function meetingRows(options: WorkspaceImportOptions, databases: readonly ExportDatabase[]) {
  const meetings = databases.filter((database) => database.kind === 'meetings');
  if (meetings.length === 0) return null;
  const rows: RowOutcome[] = [];
  for (const database of meetings) {
    rows.push(
      ...(await importNotionMeetings({
        csv: database.csvPath,
        vault: options.vault,
        folder: MEETINGS_FOLDER,
        timeZone: options.timeZone,
        groupAddresses: [],
        dryRun: options.dryRun,
        ...(options.geminiDates === undefined ? {} : { geminiDates: options.geminiDates }),
      })),
    );
  }
  return rows;
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

/**
 * Brings a Notion workspace export into a vault (issue #79): tasks, notes,
 * people, PARA, teams and daily notes as notes of their types, relations as
 * links, and the Meeting Notes through the meeting import (P28-07). Every
 * page is planned before anything is written, so each link names the note
 * it will open. A page already in the vault, by its `notion_id`, is brought
 * into step where Atlas has not changed it since the last run, and the run
 * records what it brought in so the next one can tell. Nothing is written
 * on a dry run. Every page comes back with what became of it.
 */
export async function importNotionWorkspace(
  options: WorkspaceImportOptions,
): Promise<WorkspaceOutcome> {
  const vault = await vaultFolder(options.vault);
  const statuses = taskStatuses(options.taskStatuses);
  const workspace = await readWorkspaceExport(options.exportDir);
  const selected = new Set(options.only ?? DATABASE_KINDS);
  await checkTasks(vault, workspace.databases, selected);
  const record = await readRecord(vault);
  const notes = await vaultNotes(vault);
  const plan = planWorkspace({
    databases: workspace.databases,
    selected,
    vault: notes,
    texts: await noteTexts(vault, notesToRead(workspace.databases, notes)),
    record,
    statuses,
    today: options.today,
  });
  const pages = await written(vault, plan.pages, options.dryRun);
  if (!options.dryRun) await keepRecord(vault, record, pages);
  const meetings = await meetingRows(
    options,
    workspace.databases.filter((database) => database.kind !== null && selected.has(database.kind)),
  );
  const skipped = [
    ...leftOutByOnly(workspace.databases, selected),
    ...plan.skipped,
    ...workspace.otherPages.map((what) => ({
      what,
      reason: 'not a row of a database this import brings in',
    })),
  ];
  return { dryRun: options.dryRun, pages, skipped, otherFiles: workspace.otherFiles, meetings };
}
