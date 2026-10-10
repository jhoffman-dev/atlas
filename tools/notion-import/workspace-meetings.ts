import { createVaultPath, type VaultPath } from '../../packages/domain/src/index.ts';
import type { GeminiDates } from './gemini-dates.ts';
import { importNotionMeetings, type RowOutcome } from './import-notion-meetings.ts';
import { COLUMNS } from './notion-meetings.ts';
import type { ExportDatabase } from './workspace-export.ts';

/** Where the meeting import writes, as it does when run alone. */
export const MEETINGS_FOLDER = 'Inbox/Meetings';

/** What the meeting import is run with. */
export interface MeetingRun {
  readonly vault: string;
  readonly timeZone: string | null;
  readonly geminiDates?: GeminiDates;
  /** Plans the meetings without writing them: on a dry run, or when meetings are not chosen. */
  readonly dryRun: boolean;
}

/** The meetings, as the meeting import left them, and the note of each meeting page, by its page id. */
export interface MeetingsRun {
  readonly rows: readonly RowOutcome[];
  readonly paths: ReadonlyMap<string, VaultPath>;
  readonly ids: ReadonlySet<string>;
}

const placedAt = (outcome: RowOutcome | undefined): string | null =>
  outcome !== undefined && 'path' in outcome ? outcome.path : null;

/**
 * The meeting import (P28-07) over one Meeting Notes database, and each of
 * its pages' notes: the import answers row by row, in the CSV's order, and a
 * page is its row's by the Source ID both hold.
 */
async function meetingsOf(database: ExportDatabase, run: MeetingRun) {
  const rows = await importNotionMeetings({
    csv: database.csvPath,
    vault: run.vault,
    folder: MEETINGS_FOLDER,
    timeZone: run.timeZone,
    groupAddresses: [],
    dryRun: run.dryRun,
    ...(run.geminiDates === undefined ? {} : { geminiDates: run.geminiDates }),
  });
  const pathBySource = new Map<string, string>();
  database.csv.rows.forEach((row, at) => {
    const path = placedAt(rows[at]);
    const source = (row.get(COLUMNS.sourceId) ?? '').trim();
    if (path !== null && source !== '') pathBySource.set(source, path);
  });
  const paths = new Map<string, VaultPath>();
  for (const { id, page } of database.pages) {
    const path = pathBySource.get(page.properties.get(COLUMNS.sourceId)?.trim() ?? '');
    if (id !== null && path !== undefined) paths.set(id, createVaultPath(path));
  }
  return { rows, paths };
}

/**
 * Every Meeting Notes database through the meeting import, before any other
 * note is planned, so a relation or a link to a meeting page names the note
 * the meeting is in — written now, or already in the vault.
 */
export async function runMeetings(
  databases: readonly ExportDatabase[],
  run: MeetingRun,
): Promise<MeetingsRun> {
  const rows: RowOutcome[] = [];
  const paths = new Map<string, VaultPath>();
  const ids = new Set<string>();
  for (const database of databases.filter((each) => each.kind === 'meetings')) {
    const one = await meetingsOf(database, run);
    rows.push(...one.rows);
    for (const [id, path] of one.paths) paths.set(id, path);
    for (const { id } of database.pages) if (id !== null) ids.add(id);
  }
  return { rows, paths, ids };
}
