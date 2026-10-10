import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { remarkMarkdown } from '@atlas/adapters';
import { createVaultPath, resolveWikiLinkTarget, splitFrontmatter } from '@atlas/domain';
import {
  importNotionWorkspace,
  type PageOutcome,
  type WorkspaceImportOptions,
} from './import-notion-workspace.ts';
import { GTD_STATUSES } from '../../packages/domain/src/index.ts';

/*
 * Round-2 adversarial cases for the workspace import (PR #88): each test
 * states one promise the README makes and fails while the import breaks it.
 * Same fixture and setup as import-notion-workspace.test.ts; every name in it
 * made up.
 */

const FIXTURE = fileURLToPath(new URL('fixtures/workspace/', import.meta.url));
const SHARED = 'Private & Shared';
const NOTES = `${SHARED}/Notes b2000000000000000000000000000000`;
const PARA = `${SHARED}/PARA d4000000000000000000000000000000`;
const DAILY_ID = 'f6000000000000000000000000000001';

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

/** Every file in the vault, vault-relative. */
async function vaultFiles(): Promise<string[]> {
  const entries = await readdir(vault, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(vault, join(entry.parentPath, entry.name)).split(sep).join('/'));
}

const note = (path: string) => readFile(join(vault, path), 'utf8');

async function properties(path: string): Promise<Record<string, unknown>> {
  return remarkMarkdown.frontmatterProperties(splitFrontmatter(await note(path)).frontmatter);
}

async function editExport(file: string, text: string, replacement: string) {
  const path = join(exportDir, file);
  const before = await readFile(path, 'utf8');
  expect(before).toContain(text);
  await writeFile(path, before.replace(text, replacement));
}

/** Adds a row, and its page, to the Notes database: every cell but the title empty. */
async function addNotesPage(title: string, id: string, body: string) {
  const csv = join(exportDir, `${NOTES}_all.csv`);
  await writeFile(csv, `${await readFile(csv, 'utf8')}${title},,,,,,,\n`);
  await writeFile(join(exportDir, NOTES, `Added ${id}.md`), `# ${title}\n\n${body}`);
}

const pageTitled = (pages: readonly PageOutcome[], title: string) =>
  pages.find((page) => page.title === title);

describe('a title cut at the byte limit right after ".markdown"', () => {
  it('names a note the links to it open, as a title ending in .markdown does', async () => {
    const title = `${'a'.repeat(238)}.markdown and the rest of a long title`;
    await addNotesPage(title, 'b2000000000000000000000000000009', 'Long body.\n');
    await editExport(
      `${NOTES}_all.csv`,
      'Pricing [draft],inbox,,,,,Quarterly numbers,',
      `Pricing [draft],inbox,,,,,"Long (https://www.notion.so/Long-b2000000000000000000000000000009)",`,
    );
    await run({ only: ['notes'] });
    const made = (await vaultFiles()).filter((path) => path.startsWith('Notes/aaaa'));
    expect(made).toHaveLength(1);
    const related = (await properties('Notes/Pricing draft.md'))['related'] as string[];
    const target = /^\[\[(.+)\]\]$/.exec(related[0] ?? '')?.[1] ?? '';
    const all = (await vaultFiles()).map(createVaultPath);
    expect(resolveWikiLinkTarget(target, all)).toBe(made[0]);
  });
});

describe('a .markdown note already in the vault', () => {
  it('keeps its [[links]]: a new note of its name is numbered, as beside a .md one', async () => {
    await mkdir(join(vault, 'Old', 'Deep'), { recursive: true });
    await writeFile(join(vault, 'Old', 'Deep', 'Mara Quill.markdown'), 'Someone else.\n');
    await run();
    const all = (await vaultFiles()).map(createVaultPath);
    expect(resolveWikiLinkTarget('Mara Quill', all)).toBe('Old/Deep/Mara Quill.markdown');
  });
});

describe('a daily page for a day the vault keeps a note of in a folder', () => {
  it("does not take the [[links]] that open the vault's own note for the day", async () => {
    await mkdir(join(vault, 'Journal'), { recursive: true });
    await writeFile(join(vault, 'Journal', '2026-10-06.md'), 'Written in Obsidian.\n');
    await writeFile(join(vault, 'Weekly review.md'), 'Monday was [[2026-10-06]].\n');
    await run({ only: ['daily'] });
    const all = (await vaultFiles()).map(createVaultPath);
    expect(resolveWikiLinkTarget('2026-10-06', all)).toBe('Journal/2026-10-06.md');
  });
});

describe('a page with no properties whose first paragraph uses column names', () => {
  it('keeps that paragraph in its body: nothing of the page is silently dropped', async () => {
    await addNotesPage(
      'Hallway chat',
      'b2000000000000000000000000000008',
      'People: everyone from the second floor\nDate: sometime after lunch\n\nWe agreed on Fridays.\n',
    );
    await run({ only: ['notes'] });
    const body = splitFrontmatter(await note('Notes/Hallway chat.md')).body;
    expect(body).toContain('People: everyone from the second floor');
    expect(body).toContain('Date: sometime after lunch');
  });
});

describe('--recreate-deleted for a daily page whose day the app has made a note for again', () => {
  it('brings the page back into that note, or says why not: it is not passed over in silence', async () => {
    await run({ only: ['daily'] });
    await rm(join(vault, '2026-10-06.md'));
    await writeFile(join(vault, '2026-10-06.md'), '---\ntype: daily\n---\nMy own day.\n');
    const recreated = await run({ only: ['daily'], recreateDeleted: true });
    const page = pageTitled(recreated.pages, 'October 6, 2026');
    const said = page !== undefined && page.kind !== 'unchanged';
    const relinked = (await properties('2026-10-06.md'))['notion_id'] === DAILY_ID;
    expect(said || relinked).toBe(true);
    const next = await run({ only: ['daily'] });
    expect(pageTitled(next.pages, 'October 6, 2026')?.kind).not.toBe('deleted');
  });
});

describe("a range's end Notion now writes in a form the import cannot read", () => {
  it('is not taken for Notion having cleared it: the end imported before stays', async () => {
    const csv = `${PARA}_all.csv`;
    await editExport(
      csv,
      'Larkspur Payroll renewal,Project,High,"October 1, 2026","November 30, 2026",',
      'Larkspur Payroll renewal,Project,High,"October 1, 2026 → November 30, 2026",,',
    );
    await run({ only: ['para'] });
    expect(await properties('Projects/Larkspur Payroll renewal.md')).toMatchObject({
      start: '2026-10-01',
      end: '2026-11-30',
    });
    await editExport(
      csv,
      '"October 1, 2026 → November 30, 2026"',
      '"October 1, 2026 → 11/30/2026"',
    );
    await run({ only: ['para'] });
    expect(await properties('Projects/Larkspur Payroll renewal.md')).toMatchObject({
      end: '2026-11-30',
    });
  });
});
