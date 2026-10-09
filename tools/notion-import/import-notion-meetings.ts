import { mkdir, readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { messageWithoutPaths, validateMeetingImport } from '../../packages/domain/src/index.ts';
import { MeetingMappingError } from '../n8n/meeting-mapping-error.ts';
import { mapMeeting, type MeetingFile } from '../n8n/meeting-to-atlas.ts';
import type { GeminiDates } from './gemini-dates.ts';
import { importTarget, type ImportTarget } from './import-target.ts';
import { readCsv } from './notion-csv.ts';
import { NotionExportError, planRows, type RowName, type RowPlan } from './notion-meetings.ts';
import { readNotionPage, type NotionPage } from './notion-page.ts';
import { stageFile } from './staged-file.ts';
import { holdsMeeting, meetingKey, meetingsInVault, readFrontmatter } from './vault-meetings.ts';

export { ImportSetupError } from './import-target.ts';

export interface ImportOptions {
  /** The Meeting Notes CSV of a Notion "Markdown & CSV" export; its pages are the `.md` files beside it. */
  readonly csv: string;
  /** The vault to write into. There is no default: it is always named. */
  readonly vault: string;
  /** The folder in the vault the files go in, vault-relative. */
  readonly folder: string;
  /** The zone the mapper reads UTC times in (tools/n8n/README.md, "Dates and instants"). */
  readonly timeZone: string | null;
  readonly groupAddresses: readonly string[];
  /** The providers to import, lower case; left out, every one. */
  readonly providers?: readonly string[];
  /** How Gemini's Dates are read (issue #44); left out, Gemini's rows are held. */
  readonly geminiDates?: GeminiDates;
}

/** A row, and why it is not in the vault. */
interface Reasoned {
  readonly row: RowName;
  readonly reason: string;
}

/** What became of one row. */
export type RowOutcome =
  | { readonly kind: 'written'; readonly row: RowName; readonly path: string }
  | { readonly kind: 'in-vault'; readonly row: RowName; readonly path: string }
  | { readonly kind: 'no-source-id'; readonly row: RowName }
  | ({ readonly kind: 'left-out' } & Reasoned)
  | ({ readonly kind: 'held' } & Reasoned)
  | ({ readonly kind: 'refused' } & Reasoned);

/** What placing a mapped meeting can come to. */
type Placed = Extract<RowOutcome, { readonly kind: 'written' | 'in-vault' | 'refused' }>;

const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** A file of the export as text; one that is not UTF-8 is refused rather than read with its letters lost. */
async function exportText(path: string, name: string): Promise<string> {
  try {
    return UTF8.decode(await readFile(path));
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new NotionExportError(`${name} is not UTF-8 text: export it again from Notion`);
  }
}

/** Every page of the export, read from the `.md` files under the CSV's folder. */
async function exportPages(folder: string): Promise<NotionPage[]> {
  const entries = await readdir(folder, { withFileTypes: true, recursive: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md'));
  return Promise.all(
    files.map(async (entry) => {
      const path = join(entry.parentPath, entry.name);
      return readNotionPage(await exportText(path, `the page ${relative(folder, path)}`));
    }),
  );
}

/** Why the file breaks the contract, in one line; null when Atlas will let it in. */
function contractProblem(content: string): string | null {
  const result = validateMeetingImport({ text: content, selfName: null, readFrontmatter });
  if (result.ok) return null;
  return result.errors.map((error) => `${error.field}: ${error.message}`).join('; ');
}

/** Whether the file at `path` holds the meeting; false when it holds another, or is gone. */
async function holdsAt(path: string, meeting: MeetingFile): Promise<boolean> {
  try {
    return holdsMeeting(await readFile(path, 'utf8'), meeting);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

const shownIn = (target: ImportTarget, path: string) =>
  relative(target.vault, path).split(sep).join('/') || '.';

/**
 * Writes the meeting at its path, or at its collision path when another file
 * has that name (the n8n workflow's rule). The whole file is written and
 * flushed under a hidden name first, then given its name only if no file has
 * it: no name ever holds part of a meeting, and no file is written over. A
 * file there that holds this meeting (another run's, say) means it is in
 * the vault.
 */
async function place(meeting: MeetingFile, row: RowName, target: ImportTarget): Promise<Placed> {
  const staged = await stageFile(target.folder, meeting.content);
  try {
    for (const name of [basename(meeting.path), basename(meeting.collisionPath)]) {
      const path = join(target.folder, name);
      if (await staged.linkTo(path)) return { kind: 'written', row, path: shownIn(target, path) };
      if (await holdsAt(path, meeting))
        return { kind: 'in-vault', row, path: shownIn(target, path) };
    }
  } finally {
    await staged.discard();
  }
  const reason = `another meeting holds both of its paths in ${shownIn(target, target.folder)}`;
  return { kind: 'refused', row, reason };
}

interface Run {
  readonly target: ImportTarget;
  readonly options: ImportOptions;
  /** Where each meeting already is; a meeting written by this run is added. */
  readonly held: Map<string, string>;
}

/** Maps, checks and writes one meeting the vault does not hold yet. */
async function bringIn(plan: Extract<RowPlan, { kind: 'meeting' }>, run: Run): Promise<Placed> {
  const { row } = plan;
  try {
    const meeting = mapMeeting(plan.fields, run.options);
    const problem = contractProblem(meeting.content);
    if (problem !== null) return { kind: 'refused', row, reason: problem };
    return await place(meeting, row, run.target);
  } catch (error) {
    if (error instanceof MeetingMappingError)
      return { kind: 'refused', row, reason: error.message };
    if (!(error instanceof Error && 'code' in error)) throw error;
    const where = shownIn(run.target, run.target.folder);
    return {
      kind: 'refused',
      row,
      reason: `cannot write into ${where}: ${messageWithoutPaths(error)}`,
    };
  }
}

async function importRow(plan: RowPlan, run: Run): Promise<RowOutcome> {
  if (plan.kind === 'no-source-id' || plan.kind === 'left-out') return plan;
  // Before the row is mapped: a meeting in the vault is there, whatever its Date says now.
  const at = run.held.get(meetingKey(plan.identity));
  if (at !== undefined) return { kind: 'in-vault', row: plan.row, path: at };
  if (plan.kind === 'no-page') return { kind: 'refused', row: plan.row, reason: plan.reason };
  if (plan.kind === 'held') return { kind: 'held', row: plan.row, reason: plan.reason };
  const outcome = await bringIn(plan, run);
  if (outcome.kind !== 'refused') run.held.set(meetingKey(plan.identity), outcome.path);
  return outcome;
}

/**
 * Brings a Notion Meeting Notes export into a vault as meeting/v1 files
 * (ADR-0027), one row at a time, through the n8n destination's mapping
 * (P28-02). Each file is checked with the validator Atlas runs before it is
 * written, and a meeting the vault already holds anywhere, by the import's
 * own rule (P28-04), is not written again: a second run writes nothing.
 * Gemini's rows wait for a way to read their Dates (issue #44). Every row
 * comes back with what became of it; none is dropped unsaid.
 */
export async function importNotionMeetings(options: ImportOptions): Promise<RowOutcome[]> {
  const target = await importTarget(options);
  const csv = readCsv(await exportText(options.csv, 'the CSV'));
  const pages = await exportPages(dirname(resolve(options.csv)));
  const plans = planRows(csv, pages, {
    providers: options.providers ?? null,
    geminiDates: options.geminiDates ?? null,
  });
  await mkdir(target.folder, { recursive: true });
  const run: Run = { target, options, held: await meetingsInVault(target.vault) };
  const outcomes: RowOutcome[] = [];
  for (const plan of plans) outcomes.push(await importRow(plan, run));
  return outcomes;
}
