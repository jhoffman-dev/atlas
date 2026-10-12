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
import { importNotionWorkspace, type WorkspaceImportOptions } from './import-notion-workspace.ts';

/*
 * Adversarial round 3 (PR #96, real export layout). Each test states a
 * contract the import makes and an export, laid out as Notion writes one
 * now, that breaks it. Fictional names only.
 */

const FIXTURE = fileURLToPath(new URL('fixtures/workspace/', import.meta.url));
const SHARED = 'Private & Shared';
const TASKS_CSV = `${SHARED}/Tasks Tracker a1000000000000000000000000000000_all.csv`;
const MEETING_PAGES = `${SHARED}/Meeting Notes`;
const SYNC_PAGE_FOLDER = `${MEETING_PAGES}/Platform weekly sync 7c41e0d2a9b84f6e9d3a1c5b7e2f8a06`;

const GTD_TASK_TYPE = `---\nname: task\nlabel: Task\nproperties:\n  status:\n    kind: select\n    options: [${GTD_STATUSES.join(', ')}]\n    done: archive\n---\n`;

let root: string;
let exportDir: string;
let vault: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-notion-round3-')));
  exportDir = join(root, 'export');
  vault = join(root, 'vault');
  await cp(FIXTURE, exportDir, { recursive: true });
  await mkdir(join(vault, '.atlas', 'types'), { recursive: true });
  await writeFile(join(vault, '.atlas', 'types', 'task.md'), GTD_TASK_TYPE);
  // Current exports: each database's pages in a folder named without its id.
  const folder = join(exportDir, SHARED);
  const names = await readdir(folder);
  for (const name of names.filter((each) => each.endsWith('_all.csv'))) {
    const withId = name.replace(/_all\.csv$/, '');
    if (names.includes(withId)) {
      await rename(join(folder, withId), join(folder, withId.replace(/\s+[0-9a-f]{32}$/, '')));
    }
  }
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

async function writeExport(file: string, content: string | Uint8Array) {
  await mkdir(join(exportDir, file, '..'), { recursive: true });
  await writeFile(join(exportDir, file), content);
}

async function properties(path: string): Promise<Record<string, unknown>> {
  const text = await readFile(join(vault, path), 'utf8');
  return remarkMarkdown.frontmatterProperties(splitFrontmatter(text).frontmatter);
}

async function vaultText(): Promise<string> {
  const entries = await readdir(vault, { recursive: true, withFileTypes: true });
  const texts = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => readFile(join(entry.parentPath, entry.name), 'utf8')),
  );
  return texts.join('\n');
}

describe("a meeting page's subpages and attachments", () => {
  /*
   * README: "Not imported, and listed: ... subpages and other pages that are
   * no database's row ... attachments". A task's subpage is listed and its
   * attachment counted; a meeting's are neither, so a whole workspace
   * migration drops them with nothing in the report to say so.
   */
  const AGENDA = `${SYNC_PAGE_FOLDER}/Agenda 7c41e0d2a9b84f6e9d3a1c5b7e2f8a07.md`;

  it('a subpage under a meeting is brought in or listed as skipped, never dropped unreported', async () => {
    await writeExport(
      AGENDA,
      '# Agenda\n\nLarkspur Payroll go-live checklist, owned by Tobias Fenn.\n',
    );

    const outcome = await run();

    const imported = (await vaultText()).includes('Larkspur Payroll go-live checklist');
    const listed = outcome.skipped.some((each) => each.what === AGENDA);
    expect(imported || listed).toBe(true);
  });

  it('an attachment under a meeting is counted among the attachments not brought in', async () => {
    const before = (await run({ dryRun: true })).otherFiles;
    await writeExport(`${SYNC_PAGE_FOLDER}/whiteboard.png`, 'not really a picture');

    const after = (await run({ dryRun: true })).otherFiles;

    expect(after).toBe(before + 1);
  });
});

describe('--date-order against a column that contradicts it', () => {
  /*
   * Notion's date format is per property. Under --date-order mdy a Due date
   * column holding 13/06/2026 is proved day first (no month 13), yet its
   * 06/07/2026 is still written as June 7 — a silent month error on every
   * cell whose day is 12 or less, while only the one cell that gave the
   * order away is reported.
   */
  it('does not write an ambiguous day in the order the same column has shown to be wrong', async () => {
    const csv = await readFile(join(exportDir, TASKS_CSV), 'utf8');
    const swapped = csv
      .replace('"October 20, 2026"', '13/06/2026')
      .replace('"December 1, 2026"', '06/07/2026');
    expect(swapped).not.toBe(csv);
    await writeFile(join(exportDir, TASKS_CSV), swapped);

    const outcome = await run({ dateOrder: 'mdy' });

    const contract = outcome.pages.find((page) => page.title === 'Renew the Larkspur contract');
    expect(contract !== undefined && 'notes' in contract ? contract.notes.join(' ') : '').toContain(
      '13/06/2026',
    );
    expect(await properties('Tasks/Plan the offsite.md')).not.toMatchObject({
      due: '2026-06-07',
    });
  });
});

describe('a macOS AppleDouble file in the Meeting Notes pages folder', () => {
  /*
   * The workspace reader skips dot files (`._x.md` that a copy through an
   * exFAT or SMB volume leaves beside each file), but the meeting import
   * reads every `.md` under its folder, dot files too, and refuses the
   * whole run on the binary one.
   */
  it('is skipped by the meeting import as the workspace reader skips it', async () => {
    const appleDouble = new Uint8Array([
      0x00,
      0x05,
      0x16,
      0x07,
      0x00,
      0x02,
      0x00,
      0x00,
      ...new TextEncoder().encode('Mac OS X        '),
      0x00,
      0x02,
      0xff,
      0xfe,
      0x80,
      0x81,
    ]);
    await writeExport(
      `${MEETING_PAGES}/._Platform weekly sync 7c41e0d2a9b84f6e9d3a1c5b7e2f8a06.md`,
      appleDouble,
    );
    await writeExport(
      `${SHARED}/Notes/._Renewal terms b2000000000000000000000000000001.md`,
      appleDouble,
    );

    const outcome = await run({ dryRun: true });

    expect(outcome.meetings?.some((row) => row.kind === 'would-write')).toBe(true);
  });
});
