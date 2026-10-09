import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { validateMeetingImport } from '../../packages/domain/src/index.ts';
import { remarkMarkdown } from '../../packages/adapters/src/index.ts';
import { MeetingMappingError } from '../n8n/meeting-mapping-error.ts';
import { mapMeeting, sameMeeting, type MeetingFile } from '../n8n/meeting-to-atlas.ts';
import { readCsv } from './notion-csv.ts';
import { planRows, type RowName, type RowPlan } from './notion-meetings.ts';
import { readNotionPage, type NotionPage } from './notion-page.ts';
import { meetingKey, meetingsInVault } from './vault-meetings.ts';

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
}

/** What became of one row. */
export type RowOutcome =
  | { readonly kind: 'written'; readonly row: RowName; readonly path: string }
  | { readonly kind: 'in-vault'; readonly row: RowName; readonly path: string }
  | { readonly kind: 'no-source-id'; readonly row: RowName }
  | { readonly kind: 'refused'; readonly row: RowName; readonly reason: string };

/** What placing a mapped meeting can come to. */
type Placed = Exclude<RowOutcome, { readonly kind: 'no-source-id' }>;

/** The run cannot start: the vault or the folder is not one to write into. */
export class ImportSetupError extends Error {
  override readonly name = 'ImportSetupError';
}

/** Every page of the export, read from the `.md` files under the CSV's folder. */
async function exportPages(folder: string): Promise<NotionPage[]> {
  const entries = await readdir(folder, { withFileTypes: true, recursive: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md'));
  return Promise.all(
    files.map(async (entry) =>
      readNotionPage(await readFile(join(entry.parentPath, entry.name), 'utf8')),
    ),
  );
}

/** The vault, which must already exist, and the folder in it, which must stay inside it. */
async function target(options: ImportOptions): Promise<{ vault: string; folder: string }> {
  const vault = resolve(options.vault);
  const found = await stat(vault).catch(() => null);
  if (found === null || !found.isDirectory()) {
    throw new ImportSetupError(`vault: there is no folder at ${vault}`);
  }
  const folder = resolve(vault, options.folder);
  const inside = relative(vault, folder);
  if (isAbsolute(options.folder) || inside === '..' || inside.startsWith(`..${sep}`)) {
    throw new ImportSetupError(`folder: ${options.folder} is not a folder inside the vault`);
  }
  return { vault, folder };
}

/** Why the file breaks the contract, in one line; null when Atlas will let it in. */
function contractProblem(content: string): string | null {
  const result = validateMeetingImport({
    text: content,
    selfName: null,
    readFrontmatter: (frontmatter) => ({
      properties: remarkMarkdown.frontmatterProperties(frontmatter),
      problem: remarkMarkdown.frontmatterProblem(frontmatter),
    }),
  });
  if (result.ok) return null;
  return result.errors.map((error) => `${error.field}: ${error.message}`).join('; ');
}

/** The file at `path`, or null when there is none. */
async function existing(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

interface Placement {
  readonly vault: string;
  readonly folder: string;
}

/**
 * Writes the meeting at its path, or at its collision path when another
 * meeting holds that (the n8n workflow's rule). Never over a file: a file
 * already holding this meeting means it is there, and a file at both paths
 * holding another means it is not written.
 */
async function place(meeting: MeetingFile, row: RowName, where: Placement): Promise<Placed> {
  for (const name of [basename(meeting.path), basename(meeting.collisionPath)]) {
    const path = join(where.folder, name);
    const shown = relative(where.vault, path).split(sep).join('/');
    const text = await existing(path);
    if (text === null) {
      await writeFile(path, meeting.content, { flag: 'wx' });
      return { kind: 'written', row, path: shown };
    }
    if (sameMeeting(text, meeting)) return { kind: 'in-vault', row, path: shown };
  }
  return {
    kind: 'refused',
    row,
    reason: `another meeting holds both of its paths in ${relative(where.vault, where.folder) || '.'}`,
  };
}

interface Run extends Placement {
  readonly options: ImportOptions;
  /** Where each meeting already is; a meeting written by this run is added. */
  readonly held: Map<string, string>;
}

async function importRow(plan: RowPlan, run: Run): Promise<RowOutcome> {
  if (plan.kind === 'no-source-id') return plan;
  if (plan.kind === 'no-page') return { kind: 'refused', row: plan.row, reason: plan.reason };
  const { row } = plan;
  try {
    const meeting = mapMeeting(plan.fields, run.options);
    const key = meetingKey(meeting.provider, meeting.externalId);
    const at = run.held.get(key);
    if (at !== undefined) return { kind: 'in-vault', row, path: at };
    const problem = contractProblem(meeting.content);
    if (problem !== null) return { kind: 'refused', row, reason: problem };
    const outcome = await place(meeting, row, run);
    if (outcome.kind !== 'refused') run.held.set(key, outcome.path);
    return outcome;
  } catch (error) {
    if (!(error instanceof MeetingMappingError) && !(error instanceof Error && 'code' in error)) {
      throw error;
    }
    return { kind: 'refused', row, reason: error.message };
  }
}

/**
 * Brings a Notion Meeting Notes export into a vault as meeting/v1 files
 * (ADR-0027), one row at a time, through the n8n destination's mapping
 * (P28-02). Each file is checked with the validator Atlas runs before it is
 * written, and a meeting the vault already holds anywhere, by provider and
 * external_id, is not written again: a second run writes nothing. Every row
 * comes back with what became of it; none is dropped unsaid.
 */
export async function importNotionMeetings(options: ImportOptions): Promise<RowOutcome[]> {
  const where = await target(options);
  const csv = readCsv(await readFile(options.csv, 'utf8'));
  const plans = planRows(csv, await exportPages(dirname(resolve(options.csv))));
  await mkdir(where.folder, { recursive: true });
  const run: Run = { ...where, options, held: await meetingsInVault(where.vault) };
  const outcomes: RowOutcome[] = [];
  for (const plan of plans) outcomes.push(await importRow(plan, run));
  return outcomes;
}
