import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { remarkMarkdown } from '@atlas/adapters';
import { splitFrontmatter } from '@atlas/domain';
import { GTD_STATUSES } from '../../packages/domain/src/index.ts';
import { importNotionMeetings } from './import-notion-meetings.ts';
import { importNotionWorkspace, type WorkspaceImportOptions } from './import-notion-workspace.ts';
import { ImportSetupError } from './import-target.ts';

/*
 * The workspace import over an export laid out as Notion writes one now
 * (fixtures/workspace, every name in it made up): each database's pages in
 * a folder named without its id, beside `<Name> <id>_all.csv`, other
 * databases sharing a name elsewhere, rows with no title, and dates written
 * with slashes.
 */

const FIXTURE = fileURLToPath(new URL('fixtures/workspace/', import.meta.url));
const SHARED = 'Private & Shared';
const MEETINGS_CSV = `${SHARED}/Meeting Notes 5d0c9e2a7b1f4c3e8a6d2b9f0e1c7a54_all.csv`;
const DAILY_CSV = `${SHARED}/Daily Notes f6000000000000000000000000000000_all.csv`;
const TASKS_CSV = `${SHARED}/Tasks Tracker a1000000000000000000000000000000_all.csv`;

const GTD_TASK_TYPE = `---\nname: task\nlabel: Task\nproperties:\n  status:\n    kind: select\n    options: [${GTD_STATUSES.join(', ')}]\n    done: archive\n---\n`;

let root: string;
let exportDir: string;
let vault: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-notion-layout-')));
  exportDir = join(root, 'export');
  vault = join(root, 'vault copy');
  await cp(FIXTURE, exportDir, { recursive: true });
  await mkdir(join(vault, '.atlas', 'types'), { recursive: true });
  await writeFile(join(vault, '.atlas', 'types', 'task.md'), GTD_TASK_TYPE);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const run = (options: Partial<WorkspaceImportOptions> = {}) =>
  importNotionWorkspace({
    exportDir,
    vault,
    dryRun: false,
    only: null,
    taskStatuses: [],
    today: '2026-10-10',
    timeZone: 'America/Los_Angeles',
    geminiDates: 'arrival-local',
    ...options,
  });

/** Renames each database's pages folder as current exports name it: without the id. */
async function dropFolderIds(folder = join(exportDir, SHARED)) {
  const names = await readdir(folder);
  for (const name of names.filter((each) => each.endsWith('_all.csv'))) {
    const withId = name.replace(/_all\.csv$/, '');
    if (names.includes(withId)) {
      await rename(join(folder, withId), join(folder, withId.replace(/\s+[0-9a-f]{32}$/, '')));
    }
  }
}

async function writeExport(file: string, text: string) {
  await mkdir(join(exportDir, file, '..'), { recursive: true });
  await writeFile(join(exportDir, file), text);
}

async function appendExport(file: string, lines: string) {
  await writeFile(join(exportDir, file), (await readFile(join(exportDir, file), 'utf8')) + lines);
}

async function properties(path: string): Promise<Record<string, unknown>> {
  const text = await readFile(join(vault, path), 'utf8');
  return remarkMarkdown.frontmatterProperties(splitFrontmatter(text).frontmatter);
}

const refusals = (outcome: Awaited<ReturnType<typeof run>>) =>
  outcome.pages.flatMap((page) =>
    page.kind === 'refused' ? [`${page.database} "${page.title}": ${page.reason}`] : [],
  );

describe('pages in a folder named without the id', () => {
  it("are read as their databases' rows, the meetings too, as from folders named with it", async () => {
    await dropFolderIds();
    expect(await readdir(join(exportDir, SHARED))).toContain('Tasks Tracker');
    const subpage = `${SHARED}/Meeting Notes/Platform weekly sync 7c41e0d2a9b84f6e9d3a1c5b7e2f8a06`;
    await writeExport(`${subpage}/Agenda 7c41e0d2a9b84f6e9d3a1c5b7e2f8a07.md`, '# Agenda\n');
    await writeExport(`${subpage}/whiteboard.png`, 'not really a picture');

    const outcome = await run();

    expect(refusals(outcome)).toEqual([]);
    expect(outcome.pages.filter((page) => page.kind === 'create')).toHaveLength(18);
    expect(await properties('Tasks/Renew the Larkspur contract.md')).toMatchObject({
      notion_id: 'a1000000000000000000000000000001',
      people: ['[[Mara Quill]]'],
    });
    expect(outcome.meetings?.filter((row) => row.kind === 'written')).toHaveLength(4);
    const skipped = outcome.skipped.map((each) => each.what);
    expect(skipped).toContain(`${SHARED}/Wiki aa000000000000000000000000000001.md`);
    expect(skipped.filter((what) => what.startsWith(`${SHARED}/Meeting Notes/`))).toEqual([]);
    // The meeting import's own: only the task's chart is counted.
    expect(outcome.otherFiles).toBe(1);
  });

  it('give way to a folder named with the id when both are there', async () => {
    await writeExport(
      `${SHARED}/People/Mara Quill c3000000000000000000000000000009.md`,
      '# Mara Quill\n\nRole: Decoy\n',
    );

    const outcome = await run({ only: ['people', 'teams'] });

    expect(refusals(outcome)).toEqual([]);
    expect(await properties('People/Mara Quill.md')).toMatchObject({
      notion_id: 'c3000000000000000000000000000001',
      role: 'Head of Payroll',
    });
    expect(outcome.skipped).toContainEqual({
      what: `${SHARED}/People/Mara Quill c3000000000000000000000000000009.md`,
      reason: 'not a row of a database this import brings in',
    });
  });

  it('are looked for beside their own CSV only, never in a folder of the same name elsewhere', async () => {
    await dropFolderIds();
    await writeExport(
      'Team space/People/Tobias Fenn c3000000000000000000000000000008.md',
      '# Tobias Fenn\n\nEmail: tobias.fenn@example.com\nRole: Engineer\n',
    );

    const outcome = await run({ only: ['people', 'teams'] });

    expect(refusals(outcome)).toEqual([]);
    expect(await properties('People/Tobias Fenn.md')).toMatchObject({
      notion_id: 'c3000000000000000000000000000002',
      role: 'Engineer',
    });
  });

  it("hold the meeting pages the meeting import reads, not another database's beside them", async () => {
    await dropFolderIds();
    await writeExport(
      `${SHARED}/Notes/Platform notes b2000000000000000000000000000009.md`,
      '# Platform notes\n\nSource ID: 18c2f4a9e7b3d501\n\nNotes on the sync.\n',
    );

    const rows = await importNotionMeetings({
      csv: join(exportDir, MEETINGS_CSV),
      vault,
      folder: 'Inbox/Meetings',
      timeZone: 'America/Los_Angeles',
      groupAddresses: [],
      geminiDates: 'arrival-local',
      dryRun: true,
    });

    expect(rows.find((row) => row.row.title === 'Platform weekly sync')).toMatchObject({
      kind: 'would-write',
    });
  });
});

describe('two databases of one kind in the export', () => {
  it("are refused, naming both, when a team space's Meetings sits elsewhere beside the Meeting Notes", async () => {
    await dropFolderIds();
    const teamMeetings = 'Team space/Databases/Meetings 77000000000000000000000000000000_all.csv';
    await writeExport(teamMeetings, 'Name,Date\nKickoff,"October 1, 2026"\n');
    await writeExport(
      'Team space/Databases/Meetings/Kickoff 77000000000000000000000000000001.md',
      '# Kickoff\n',
    );

    const failure = run({ dryRun: true });

    await expect(failure).rejects.toBeInstanceOf(ImportSetupError);
    await expect(failure).rejects.toThrow(
      `export: ${MEETINGS_CSV} and ${teamMeetings} are both meetings databases: export only the private databases, or point --export at a folder holding just them`,
    );
    expect(await readdir(vault)).toEqual(['.atlas']);
  });
});

describe('a daily row with no title', () => {
  beforeEach(async () => {
    await dropFolderIds();
    await appendExport(DAILY_CSV, ',2026/10/07,daily\n,10/08/2026,daily\n');
    await writeExport(
      `${SHARED}/Daily Notes/Untitled f6000000000000000000000000000002.md`,
      '# Untitled\n\nDate: 2026/10/07\nTags: daily\n\nThe seventh.\n',
    );
    await writeExport(
      `${SHARED}/Daily Notes/Untitled f6000000000000000000000000000003.md`,
      '# Untitled\n\nDate: 10/08/2026\nTags: daily\n\nThe eighth.\n',
    );
  });

  it("is paired with its Untitled page by its Date, and is the day's note, read in the order given", async () => {
    const outcome = await run({ only: ['daily'], dateOrder: 'mdy' });

    expect(refusals(outcome)).toEqual([]);
    expect(await properties('2026-10-07.md')).toMatchObject({
      notion_id: 'f6000000000000000000000000000002',
      date: '2026-10-07',
    });
    expect(await readFile(join(vault, '2026-10-07.md'), 'utf8')).toContain('The seventh.');
    expect(await properties('2026-10-08.md')).toMatchObject({
      notion_id: 'f6000000000000000000000000000003',
      date: '2026-10-08',
    });
  });

  it('whose Date is month first is refused without a date order, never guessed at', async () => {
    const outcome = await run({ only: ['daily'], dryRun: true });

    expect(refusals(outcome)).toEqual(['Daily Notes "": neither its Date nor its title is a day']);
  });
});

describe('a date written month first', () => {
  beforeEach(async () => {
    await dropFolderIds();
    const csv = await readFile(join(exportDir, TASKS_CSV), 'utf8');
    await writeFile(join(exportDir, TASKS_CSV), csv.replace('"December 1, 2026"', '12/01/2026'));
    const meetings = await readFile(join(exportDir, MEETINGS_CSV), 'utf8');
    await writeFile(
      join(exportDir, MEETINGS_CSV),
      meetings.replace('"October 6, 2026 10:00 AM → 10:30 AM"', '10/06/2026 10:00 AM → 10:30 AM'),
    );
  });

  it('is read for tasks and meetings alike with --date-order', async () => {
    const outcome = await run({ dateOrder: 'mdy' });

    expect(await properties('Tasks/Plan the offsite.md')).toMatchObject({ due: '2026-12-01' });
    expect(outcome.meetings).toContainEqual({
      kind: 'written',
      row: { title: 'Platform weekly sync', date: '10/06/2026 10:00 AM → 10:30 AM' },
      path: 'Inbox/Meetings/2026-10-06 Platform weekly sync.md',
    });
  });

  it('is listed as unreadable without it, the note saying to give one', async () => {
    const outcome = await run({ dryRun: true });

    const offsite = outcome.pages.find((page) => page.title === 'Plan the offsite');
    expect(offsite).toMatchObject({ kind: 'create' });
    expect(offsite !== undefined && 'notes' in offsite ? offsite.notes : []).toContain(
      'Due date "12/01/2026" cannot be read (cannot read "12/01/2026" as a date or a time), so the note keeps its due: run with --date-order mdy (month first) or dmy (day first), or set the column\'s format to Full date',
    );
    expect(outcome.meetings?.find((row) => row.row.title === 'Platform weekly sync')).toMatchObject(
      { kind: 'refused' },
    );
  });
});
