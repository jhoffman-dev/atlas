import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { remarkMarkdown } from '@atlas/adapters';
import { splitFrontmatter } from '@atlas/domain';
import {
  importNotionWorkspace,
  type PageOutcome,
  type WorkspaceImportOptions,
} from './import-notion-workspace.ts';
import { ImportSetupError } from './import-target.ts';
import { GTD_STATUSES } from './task-status.ts';

/*
 * Adversarial cases for the workspace import (issue #79): each test states one
 * promise the README makes and fails while the import breaks it. Same fixture
 * and setup as import-notion-workspace.test.ts; every name in it made up.
 */

const FIXTURE = fileURLToPath(new URL('fixtures/workspace/', import.meta.url));
const SHARED = 'Private & Shared';
const TASKS = `${SHARED}/Tasks Tracker a1000000000000000000000000000000`;

const GTD_TASK_TYPE = [
  '---',
  'name: task',
  'label: Task',
  'properties:',
  '  status:',
  '    kind: select',
  `    options: [${GTD_STATUSES.join(', ')}]`,
  '    done: archive',
  '---',
  '',
].join('\n');

let root: string;
let exportDir: string;
let vault: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-notion-workspace-')));
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

/** Every file in the vault, vault-relative, with its bytes. */
async function files(): Promise<Map<string, string>> {
  const entries = await readdir(vault, { withFileTypes: true, recursive: true });
  const found = new Map<string, string>();
  for (const entry of entries.filter((each) => each.isFile())) {
    const path = join(entry.parentPath, entry.name);
    found.set(relative(vault, path).split(sep).join('/'), await readFile(path, 'latin1'));
  }
  return found;
}

const note = (path: string) => readFile(join(vault, path), 'utf8');

async function properties(path: string): Promise<Record<string, unknown>> {
  return remarkMarkdown.frontmatterProperties(splitFrontmatter(await note(path)).frontmatter);
}

/** Puts `replacement` in place of `text` in a file of the export. */
async function editExport(file: string, text: string, replacement: string) {
  const path = join(exportDir, file);
  const before = await readFile(path, 'utf8');
  expect(before).toContain(text);
  await writeFile(path, before.replace(text, replacement));
}

async function editNote(path: string, text: string, replacement: string) {
  const before = await note(path);
  expect(before).toContain(text);
  await writeFile(join(vault, path), before.replace(text, replacement));
}

const TASKS_CSV = `${TASKS}_all.csv`;
const TEAMS = `${SHARED}/Teams e5000000000000000000000000000000`;
const RENEW = 'Tasks/Renew the Larkspur contract.md';
const RENEW_PAGE = `${TASKS}/Renew the Larkspur contract a1000000000000000000000000000001.md`;
const SHIP = 'Tasks/Ship the payroll export.md';
const OFFSITE = 'Tasks/Plan the offsite.md';
const OFFSITE_PAGE = `${TASKS}/Plan the offsite a1000000000000000000000000000005.md`;

const pageTitled = (pages: readonly PageOutcome[], title: string) =>
  pages.find((page) => page.title === title);

describe('a page with no properties paragraph', () => {
  it('keeps a first paragraph that only looks like "Label: text" in its body', async () => {
    await editExport(`${TEAMS}_all.csv`, 'pvs=21)\n', 'pvs=21)\nPayroll Ops,\n');
    await writeFile(
      join(exportDir, TEAMS, 'Payroll Ops e5000000000000000000000000000002.md'),
      '# Payroll Ops\n\nOn call: Tobias Fenn this week\n\nOwns the payroll run.\n',
    );
    await run();
    const body = splitFrontmatter(await note('Teams/Payroll Ops.md')).body;
    expect(body).toContain('Owns the payroll run.');
    expect(body).toContain('On call: Tobias Fenn this week');
  });
});

describe('a property set only where the task has none', () => {
  it('is not put back after it was removed in Atlas', async () => {
    await run();
    await editNote(SHIP, 'status: archive', 'status: in-progress');
    await editNote(SHIP, 'completed: 2026-10-10\n', '');
    const outcome = await run({ today: '2026-10-12' });
    expect(await properties(SHIP)).not.toHaveProperty('completed');
    expect(pageTitled(outcome.pages, 'Ship the payroll export')?.kind).toBe('unchanged');
  });
});

describe('a note deleted in Atlas', () => {
  it('is not made again by the next run, which recorded importing it', async () => {
    await run();
    await rm(join(vault, SHIP));
    const outcome = await run();
    expect((await files()).has(SHIP)).toBe(false);
    expect(pageTitled(outcome.pages, 'Ship the payroll export')?.kind).not.toBe('create');
  });
});

describe('a date Notion now writes in a format the import cannot read', () => {
  it('does not take the date it imported before out of the note', async () => {
    await run();
    await editExport(TASKS_CSV, '"October 20, 2026"', '10/20/2026');
    await editExport(RENEW_PAGE, 'Due date: October 20, 2026', 'Due date: 10/20/2026');
    await run();
    expect(await properties(RENEW)).toMatchObject({ due: '2026-10-20' });
  });
});

describe('two columns that map to one property', () => {
  it('loses neither: a Notes text column beside the Note relation is imported or listed', async () => {
    const csvPath = join(exportDir, TASKS_CSV);
    const lines = (await readFile(csvPath, 'utf8')).split('\n');
    lines[0] = `${lines[0]},Notes`;
    lines[1] = `${lines[1]},Bring the signed copy`;
    await writeFile(csvPath, lines.join('\n'));
    const outcome = await run();
    const imported = (await note(RENEW)).includes('Bring the signed copy');
    const listed = outcome.skipped.some(
      (skip) => skip.what === 'Tasks Tracker' && skip.reason.includes('"Notes"'),
    );
    expect(imported || listed).toBe(true);
  });
});

describe('a date with a time in UTC', () => {
  it("is the day it falls on in the run's time zone", async () => {
    // 02:00 UTC on Oct 21 is 7 PM on Oct 20 in Los Angeles: the day Notion showed.
    await editExport(TASKS_CSV, '"October 20, 2026"', '"October 21, 2026 2:00 AM (UTC)"');
    await run({ timeZone: 'America/Los_Angeles' });
    expect(await properties(RENEW)).toMatchObject({ due: '2026-10-20' });
  });
});

describe('a date range', () => {
  it('keeps its end, or says it was not brought in', async () => {
    await editExport(TASKS_CSV, '"October 20, 2026"', '"October 20, 2026 → October 24, 2026"');
    const outcome = await run();
    const page = pageTitled(outcome.pages, 'Renew the Larkspur contract');
    const kept = (await note(RENEW)).includes('2026-10-24');
    const said =
      page !== undefined && 'notes' in page && page.notes.some((n) => n.includes('October 24'));
    expect(kept || said).toBe(true);
  });
});

describe('the record', () => {
  it('is never written through a link out of the vault', async () => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, join(vault, '.atlas', 'imports'));
    await run().catch((error: unknown) => {
      if (!(error instanceof ImportSetupError)) throw error;
    });
    expect(await readdir(outside)).toEqual([]);
  });

  it('that could not be written leaves the next run taking Notion changes to untouched properties', async () => {
    await mkdir(join(vault, '.atlas', 'imports'), { recursive: true });
    await chmod(join(vault, '.atlas', 'imports'), 0o555);
    await run().catch(() => undefined);
    await chmod(join(vault, '.atlas', 'imports'), 0o755);
    await editExport(TASKS_CSV, 'Plan the offsite,Later', 'Plan the offsite,Ready');
    await editExport(OFFSITE_PAGE, 'Status: Later', 'Status: Ready');
    await run();
    expect(await properties(OFFSITE)).toMatchObject({
      status: 'next-action',
      notion_status: 'Ready',
    });
  });
});

describe('a page title the disk or the vault walk treats differently', () => {
  it('ending in .markdown is found again: a second run with no changes is unchanged', async () => {
    await editExport(TASKS_CSV, 'Plan the offsite,Later', 'setup.markdown,Later');
    await editExport(OFFSITE_PAGE, '# Plan the offsite', '# setup.markdown');
    await run();
    const second = await run();
    expect(pageTitled(second.pages, 'setup.markdown')?.kind).toBe('unchanged');
  });

  it('longer than a file name may be is still brought in', async () => {
    const long = 'Quarterly review '.repeat(18).trim();
    await editExport(TASKS_CSV, 'Plan the offsite,Later', `${long},Later`);
    await editExport(OFFSITE_PAGE, '# Plan the offsite', `# ${long}`);
    const outcome = await run();
    expect(pageTitled(outcome.pages, long)?.kind).toBe('create');
  });
});
