import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { exportText } from './import-notion-meetings.ts';
import { ImportSetupError } from './import-target.ts';
import { readCsv, type Csv } from './notion-csv.ts';
import { readNotionPage } from './notion-page.ts';
import { notionIdIn } from './notion-relations.ts';
import type { ExportPage } from './row-pages.ts';
import { databaseKind, type DatabaseKind } from './workspace-databases.ts';

/** A database in the export: its CSV, and the pages of its rows. */
export interface ExportDatabase {
  /** The database's name, without the id Notion adds to its files. */
  readonly name: string;
  readonly kind: DatabaseKind | null;
  /** The CSV read, absolute, and as the report shows it. */
  readonly csvPath: string;
  readonly csvFile: string;
  readonly csv: Csv;
  /** Its rows' pages: the `.md` files directly in its folder. Not read for a database this import does not know. */
  readonly pages: readonly ExportPage[];
}

/** A whole Notion workspace export, "Markdown & CSV" with subpages, unzipped. */
export interface WorkspaceExport {
  readonly databases: readonly ExportDatabase[];
  /** Pages that are no database's row — subpages, workspace pages — as the report shows them. */
  readonly otherPages: readonly string[];
  /** How many files are neither a page nor a CSV: images and attachments. */
  readonly otherFiles: number;
}

const ALL = /_all$/;
/** `Tasks a1000000…` as Notion names a database's files: its name and its id. */
const NAMED_WITH_ID = /^(.*?)\s+[0-9a-f]{32}$/i;

const shown = (root: string, path: string) => relative(root, path).split(sep).join('/');

/** The folder the export is in; one that is not there cannot be read. */
async function exportFolder(dir: string): Promise<string> {
  const found = await stat(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  });
  if (found === null || !found.isDirectory()) {
    throw new ImportSetupError(
      `export: there is no folder at ${resolve(dir)} (unzip the export, and any zip inside it)`,
    );
  }
  return resolve(dir);
}

/** Each database's CSV: the `_all` one where Notion wrote both, which has every column. */
function databaseCsvs(files: readonly string[]): string[] {
  const csvs = files.filter((file) => file.toLowerCase().endsWith('.csv'));
  const byBase = new Map<string, string>();
  for (const file of csvs) {
    const base = join(dirname(file), basename(file, '.csv').replace(ALL, ''));
    if (!byBase.has(base) || ALL.test(basename(file, '.csv'))) byBase.set(base, file);
  }
  return [...byBase.values()].sort();
}

/** The folder Notion puts a database's pages in: beside its CSV, named as it is. */
const pagesFolder = (csvPath: string) =>
  join(dirname(csvPath), basename(csvPath, '.csv').replace(ALL, ''));

async function readPage(root: string, path: string): Promise<ExportPage> {
  const file = shown(root, path);
  const page = readNotionPage(await exportText(path, `the page ${file}`));
  return { file, id: notionIdIn(basename(path, '.md')), page };
}

async function readDatabase(
  root: string,
  csvPath: string,
  pageFiles: readonly string[],
): Promise<ExportDatabase> {
  const csvFile = shown(root, csvPath);
  const base = basename(csvPath, '.csv').replace(ALL, '');
  const name = NAMED_WITH_ID.exec(base)?.[1] ?? base;
  const kind = databaseKind(name);
  const csv = readCsv(await exportText(csvPath, `the CSV ${csvFile}`));
  const folder = pagesFolder(csvPath);
  const rows = pageFiles.filter((file) => dirname(file) === folder);
  const pages = kind === null ? [] : await Promise.all(rows.map((file) => readPage(root, file)));
  return { name, kind, csvPath, csvFile, csv, pages };
}

/**
 * Reads a Notion workspace export: each database's CSV and its rows' pages,
 * every one read as UTF-8 or the run refused, the Meeting Notes pages too. A
 * page is a database's row when it is directly in the folder beside the
 * database's CSV. Every other page is listed and every other file counted,
 * not read here: the meeting import, which runs before any other note is
 * written, reads every page under its CSV's folder as UTF-8 itself.
 */
export async function readWorkspaceExport(dir: string): Promise<WorkspaceExport> {
  const root = await exportFolder(dir);
  const entries = await readdir(root, { withFileTypes: true, recursive: true });
  const files = entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => join(entry.parentPath, entry.name));
  const pageFiles = files.filter((file) => file.toLowerCase().endsWith('.md'));
  const databases = await Promise.all(
    databaseCsvs(files).map((csv) => readDatabase(root, csv, pageFiles)),
  );
  const meetingFolders = databases
    .filter((database) => database.kind === 'meetings')
    .map((database) => `${pagesFolder(database.csvPath)}${sep}`);
  const rowFiles = new Set(
    databases.flatMap((database) => database.pages.map((page) => page.file)),
  );
  const otherPages = pageFiles
    .filter((file) => !meetingFolders.some((folder) => file.startsWith(folder)))
    .map((file) => shown(root, file))
    .filter((file) => !rowFiles.has(file))
    .sort();
  const otherFiles = files.filter(
    (file) =>
      !/\.(md|csv)$/i.test(file) && !meetingFolders.some((folder) => file.startsWith(folder)),
  ).length;
  return { databases, otherPages, otherFiles };
}
