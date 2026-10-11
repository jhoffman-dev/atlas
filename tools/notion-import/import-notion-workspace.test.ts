import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { remarkMarkdown } from '@atlas/adapters';
import { createVaultPath, originOf, resolveWikiLinkTarget, splitFrontmatter } from '@atlas/domain';
import {
  importNotionWorkspace,
  type PageOutcome,
  type WorkspaceImportOptions,
} from './import-notion-workspace.ts';
import { ImportSetupError } from './import-target.ts';
import { NotionExportError } from './notion-meetings.ts';
import { GTD_STATUSES } from '../../packages/domain/src/index.ts';
import { workspaceImported } from './workspace-report.ts';

/*
 * The workspace import over a small Notion export (fixtures/workspace, every
 * name in it made up) and a real folder standing in for a vault copy.
 */

const FIXTURE = fileURLToPath(new URL('fixtures/workspace/', import.meta.url));
const SHARED = 'Private & Shared';
const TASKS = `${SHARED}/Tasks Tracker a1000000000000000000000000000000`;
const MARA_ID = 'c3000000000000000000000000000001';

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

const OLD_TASK_TYPE = [
  '---',
  'name: task',
  'label: Task',
  'properties:',
  '  status:',
  '    kind: select',
  '    options: [backlog, next, doing, review, done]',
  '    done: done',
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

/** When each file in the vault was last written, by its vault-relative path. */
async function writtenAt(): Promise<Map<string, number>> {
  const times = new Map<string, number>();
  for (const path of (await files()).keys()) {
    times.set(path, (await stat(join(vault, path))).mtimeMs);
  }
  return times;
}

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

const byKind = (pages: readonly PageOutcome[], kind: PageOutcome['kind']) =>
  pages.filter((page) => page.kind === kind);

const WIKI_LINK = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;

describe('importing a workspace export', () => {
  it('brings every database in, each note in the folder of its kind', async () => {
    const outcome = await run();
    const written = [...(await files()).keys()].filter((path) => !path.startsWith('.atlas'));
    expect(written.sort()).toEqual(
      [
        'Archive/Projects/Old migration.md',
        'Areas/Engineering.md',
        '2026-10-06.md',
        'Inbox/Meetings/2026-10-01 Larkspur Payroll renewal, final terms.md',
        'Inbox/Meetings/2026-10-02 1 1 (gemini da17a49f).md',
        'Inbox/Meetings/2026-10-02 1 1.md',
        'Inbox/Meetings/2026-10-06 Platform weekly sync.md',
        'Notes/Mara Quill Tobias — Oct 2, 2026.md',
        'Notes/Pricing draft.md',
        'Notes/Renewal terms.md',
        'People/Mara Quill.md',
        'People/Tobias Fenn.md',
        'Projects/Larkspur Payroll renewal.md',
        'Resources/Style guide.md',
        'Tasks/Ask about the audit.md',
        'Tasks/Chase the signed order form.md',
        'Tasks/Fix the sync bug.md',
        'Tasks/Plan the offsite.md',
        'Tasks/Renew the Larkspur contract.md',
        'Tasks/Ship the payroll export.md',
        'Tasks/Write the onboarding guide.md',
        'Teams/Platform.md',
      ].sort(),
    );
    expect(byKind(outcome.pages, 'create')).toHaveLength(18);
    expect(workspaceImported(outcome)).toBe(true);
    // The record caught up with every note, so its write-ahead log is empty.
    expect((await files()).has('.atlas/imports/notion-workspace.pending')).toBe(false);
  });

  it('writes a task with its GTD status, its relations as links, and its page as its body', async () => {
    await run();
    expect(await properties('Tasks/Renew the Larkspur contract.md')).toEqual({
      type: 'task',
      status: 'next-action',
      notion_status: 'Ready',
      priority: 'H',
      effort: 'M',
      task_type: 'Feature',
      tags: ['payroll', 'contracts'],
      due: '2026-10-20',
      project: '[[Larkspur Payroll renewal]]',
      people: ['[[Mara Quill]]'],
      notes: ['[[Renewal terms]]'],
      scheduled: '2026-10-20',
      source: 'notion',
      notion_id: 'a1000000000000000000000000000001',
    });
    const body = splitFrontmatter(await note('Tasks/Renew the Larkspur contract.md')).body;
    expect(body).toContain('See [[Renewal terms]] and ![chart](');
    expect(await properties('Tasks/Ship the payroll export.md')).toMatchObject({
      status: 'archive',
      completed: '2026-10-10',
    });
    expect(await properties('Tasks/Chase the signed order form.md')).toMatchObject({
      status: 'waiting',
      waiting_on: '[[Tobias Fenn]]',
    });
  });

  it('holds a Waiting task with nobody to wait on in the Inbox, and lists it', async () => {
    const outcome = await run();
    expect(await properties('Tasks/Ask about the audit.md')).toMatchObject({ status: 'inbox' });
    const audit = outcome.pages.find((page) => page.title === 'Ask about the audit');
    expect(audit !== undefined && 'notes' in audit ? audit.notes : []).toEqual([
      'Waiting with nobody in People: held in the Inbox',
    ]);
  });

  it('writes every link so it opens a note this run wrote, but for a page not in the export', async () => {
    await run();
    const all = [...(await files()).keys()].map(createVaultPath);
    const unresolved: string[] = [];
    for (const path of all.filter(
      (each) => !each.startsWith('.atlas') && !each.startsWith('Inbox'),
    )) {
      for (const [, target] of (await note(path)).matchAll(WIKI_LINK)) {
        if (resolveWikiLinkTarget(target ?? '', all) === null) unresolved.push(target ?? '');
      }
    }
    expect(unresolved).toEqual(['Quarterly numbers']);
  });

  it('changes nothing on a second run, not even its record', async () => {
    await run();
    const before = await files();
    const times = await writtenAt();
    const outcome = await run();
    expect(await files()).toEqual(before);
    expect(await writtenAt()).toEqual(times);
    expect(outcome.pages.map((page) => page.kind)).toEqual(Array(18).fill('unchanged'));
    expect(outcome.meetings?.map((row) => row.kind)).toEqual([
      'in-vault',
      'in-vault',
      'in-vault',
      'in-vault',
      'no-source-id',
    ]);
    expect(workspaceImported(outcome)).toBe(true);
  });

  it('writes nothing on a dry run, and says what it would do', async () => {
    const before = await files();
    const outcome = await run({ dryRun: true });
    expect(await files()).toEqual(before);
    expect(byKind(outcome.pages, 'create')).toHaveLength(18);
    expect(outcome.pages.every((page) => page.kind !== 'create' || !page.written)).toBe(true);
    expect(outcome.meetings?.filter((row) => row.kind === 'would-write')).toHaveLength(4);
  });

  it("on a dry run, says a meeting would take its other name when its own is another file's", async () => {
    await mkdir(join(vault, 'Inbox', 'Meetings'), { recursive: true });
    await writeFile(
      join(vault, 'Inbox', 'Meetings', '2026-10-06 Platform weekly sync.md'),
      'Mine.\n',
    );
    const outcome = await run({ dryRun: true });
    expect(outcome.meetings?.[0]).toMatchObject({
      kind: 'would-write',
      path: expect.stringMatching(/^Inbox\/Meetings\/2026-10-06 Platform weekly sync \(.+\)\.md$/),
    });
  });

  it('lists what it does not bring in: other databases, subpages, attachments, columns', async () => {
    const outcome = await run();
    expect(outcome.skipped).toEqual(
      expect.arrayContaining([
        {
          what: `${SHARED}/Reading list 99000000000000000000000000000000_all.csv`,
          reason: 'not a database this import knows',
        },
        {
          what: `${TASKS}/Renew the Larkspur contract a1000000000000000000000000000001/Checklist a1000000000000000000000000000099.md`,
          reason: 'not a row of a database this import brings in',
        },
        { what: 'Tasks Tracker', reason: '"Created time": not a column this import maps' },
        {
          what: 'Notes',
          reason: '"Back Links": it links back here, and Atlas shows that as a backlink',
        },
      ]),
    );
    expect(outcome.otherFiles).toBe(1);
  });

  it('maps a status as told', async () => {
    await run({ taskStatuses: ['Later=longterm'] });
    expect(await properties('Tasks/Plan the offsite.md')).toMatchObject({ status: 'longterm' });
  });
});

describe('the GTD move comes first', () => {
  it('refuses to bring tasks into a vault whose Task type is not GTD, and writes nothing', async () => {
    await writeFile(join(vault, '.atlas', 'types', 'task.md'), OLD_TASK_TYPE);
    const before = await files();
    await expect(run()).rejects.toThrow(ImportSetupError);
    await expect(run()).rejects.toThrow('run the GTD move first');
    expect(await files()).toEqual(before);
  });

  it('refuses a vault with no Task type at all', async () => {
    await rm(join(vault, '.atlas'), { recursive: true });
    await expect(run()).rejects.toThrow('run the GTD move first');
  });

  it('finds the Task type among type files that are not one, or do not read', async () => {
    const types = join(vault, '.atlas', 'types');
    await writeFile(join(types, 'a-readme.md'), 'No frontmatter here.\n');
    await writeFile(join(types, 'b-broken.md'), '---\nname: broken\nproperties: 3\n---\n');
    await expect(run({ dryRun: true })).resolves.toMatchObject({ dryRun: true });
    await rm(join(types, 'task.md'));
    await expect(run({ dryRun: true })).rejects.toThrow('run the GTD move first');
  });

  it('brings the rest in when tasks are left out, links to tasks still naming their notes', async () => {
    await writeFile(join(vault, '.atlas', 'types', 'task.md'), OLD_TASK_TYPE);
    const outcome = await run({ only: ['notes', 'people'] });
    const written = [...(await files()).keys()].filter((path) => !path.startsWith('.atlas'));
    expect(written.every((path) => path.startsWith('Notes/') || path.startsWith('People/'))).toBe(
      true,
    );
    expect(await properties('Notes/Renewal terms.md')).toMatchObject({
      tasks: ['[[Renew the Larkspur contract]]'],
    });
    expect(outcome.skipped).toContainEqual({ what: 'Tasks Tracker', reason: 'left out by --only' });
    expect(outcome.meetings).toBeNull();
  });
});

describe('an edit made in Atlas', () => {
  const OFFSITE = 'Tasks/Plan the offsite.md';
  const OFFSITE_PAGE = `${TASKS}/Plan the offsite a1000000000000000000000000000005.md`;
  const OFFSITE_CSV = `${TASKS}_all.csv`;

  it('stands while Notion has not changed', async () => {
    await run();
    await editNote(OFFSITE, 'status: someday', 'status: in-progress');
    const outcome = await run();
    expect(await properties(OFFSITE)).toMatchObject({ status: 'in-progress' });
    expect(byKind(outcome.pages, 'unchanged')).toHaveLength(18);
    expect(workspaceImported(outcome)).toBe(true);
  });

  it('is kept, and listed once, when Notion changed too', async () => {
    await run();
    await editNote(OFFSITE, 'status: someday', 'status: in-progress');
    await editExport(OFFSITE_CSV, 'Plan the offsite,Later', 'Plan the offsite,Ready');
    await editExport(OFFSITE_PAGE, 'Status: Later', 'Status: Ready');
    const third = await run();
    expect(await properties(OFFSITE)).toMatchObject({
      status: 'in-progress',
      notion_status: 'Ready',
    });
    const offsite = third.pages.find((page) => page.title === 'Plan the offsite');
    expect(offsite).toMatchObject({ kind: 'update', changed: ['notion_status'], kept: ['status'] });
    expect(workspaceImported(third)).toBe(false);
    const fourth = await run();
    expect(fourth.pages.find((page) => page.title === 'Plan the offsite')).toMatchObject({
      kind: 'unchanged',
      kept: [],
    });
    expect(workspaceImported(fourth)).toBe(true);
  });

  it("gives way to Notion's change where Atlas left the value alone, every other byte kept", async () => {
    await run();
    const path = 'Tasks/Renew the Larkspur contract.md';
    await editNote(path, 'type: task\n', 'type: task\n# kept by hand\nrating:   5\n');
    await editNote(path, 'book the call.', 'book the call. Added in Atlas.');
    const before = await note(path);
    await editExport(
      `${TASKS}_all.csv`,
      'Renew the Larkspur contract,Ready,H,',
      'Renew the Larkspur contract,Ready,L,',
    );
    await editExport(
      `${TASKS}/Renew the Larkspur contract a1000000000000000000000000000001.md`,
      'Priority: H',
      'Priority: L',
    );
    const outcome = await run();
    expect(await note(path)).toBe(before.replace('priority: H', 'priority: L'));
    expect(outcome.pages.find((page) => 'path' in page && page.path === path)).toMatchObject({
      kind: 'update',
      changed: ['priority'],
      kept: [],
    });
  });
});

describe('a note already in the vault', () => {
  const EARLIER = [
    '---',
    'type: person',
    'email: mara@example.com',
    "team: 'Platform'",
    `notion_id: '${MARA_ID}'`,
    '---',
    '',
    'Earlier words.',
    '',
  ].join('\n');

  it('is left as it is with --no-fill-unrecorded, and nothing recorded, so a later run can fill it', async () => {
    await mkdir(join(vault, 'Old'));
    await writeFile(join(vault, 'Old', 'mara.md'), EARLIER);
    const left = await run({ fillUnrecorded: false });
    expect(await note('Old/mara.md')).toBe(EARLIER);
    expect(notesOfPage(left.pages, 'Mara Quill')).toContain(
      'no record of an earlier import: left as it is (--no-fill-unrecorded)',
    );
    const filled = await run();
    expect(pageOf(filled.pages, 'Mara Quill')).toMatchObject({
      kind: 'update',
      filled: true,
      changed: ['slack', 'role', 'source'],
    });
  });

  it('is found by its notion_id wherever it is, and filled in, never duplicated or written over', async () => {
    await mkdir(join(vault, 'Old'));
    await writeFile(join(vault, 'Old', 'mara.md'), EARLIER);
    const outcome = await run();
    expect((await files()).has('People/Mara Quill.md')).toBe(false);
    expect(await properties('Old/mara.md')).toEqual({
      type: 'person',
      email: 'mara@example.com',
      team: 'Platform',
      notion_id: MARA_ID,
      slack: '@mara',
      role: 'Head of Payroll',
      source: 'notion',
    });
    expect(splitFrontmatter(await note('Old/mara.md')).body).toBe('\nEarlier words.\n');
    expect(
      outcome.pages.find((page) => 'path' in page && page.path === 'Old/mara.md'),
    ).toMatchObject({
      kind: 'update',
      kept: ['email', 'team', 'body'],
    });
    expect(await properties('Tasks/Renew the Larkspur contract.md')).toMatchObject({
      people: ['[[mara]]'],
    });
  });

  it('is refused when two notes claim its page, and nothing is written for it', async () => {
    await writeFile(join(vault, 'mara.md'), EARLIER);
    await writeFile(join(vault, 'mara again.md'), EARLIER);
    const outcome = await run();
    expect(outcome.pages.find((page) => page.title === 'Mara Quill')).toEqual({
      kind: 'refused',
      database: 'People',
      title: 'Mara Quill',
      reason: 'mara again.md and mara.md all hold its notion_id: merge them first',
    });
    expect((await files()).has('People/Mara Quill.md')).toBe(false);
    expect(workspaceImported(outcome)).toBe(false);
  });

  it('is left as it is when it is not UTF-8; one whose properties cannot be read holds no page', async () => {
    const latin1 = Buffer.from(`---\nnotion_id: ${MARA_ID}\n---\nCaf\xe9\n`, 'latin1');
    await writeFile(join(vault, 'mara.md'), latin1);
    const broken = `---\nnotion_id: c3000000000000000000000000000002\nrole: [unclosed\n---\n`;
    await writeFile(join(vault, 'tobias.md'), broken);
    const outcome = await run();
    expect(await readFile(join(vault, 'mara.md'))).toEqual(latin1);
    expect(await note('tobias.md')).toBe(broken);
    expect(byKind(outcome.pages, 'refused')).toEqual([
      {
        kind: 'refused',
        database: 'People',
        title: 'Mara Quill',
        reason: 'mara.md is not UTF-8 text: not changed',
      },
    ]);
    expect(await properties('People/Tobias Fenn.md')).toMatchObject({ role: 'Engineer' });
  });

  it("does not take a name another note has: the new note's is numbered", async () => {
    await mkdir(join(vault, 'Tasks'));
    await writeFile(join(vault, 'Tasks', 'Plan the offsite.md'), 'My own offsite note.\n');
    await run();
    expect(await note('Tasks/Plan the offsite.md')).toBe('My own offsite note.\n');
    expect(await properties('Tasks/Plan the offsite 2.md')).toMatchObject({ status: 'someday' });
  });
});

describe('an export it cannot trust', () => {
  it('refuses a page that is not UTF-8, writing nothing', async () => {
    await writeFile(
      join(exportDir, `${TASKS}/Plan the offsite a1000000000000000000000000000005.md`),
      Buffer.from('# Plan the offsite\n\nCaf\xe9\n', 'latin1'),
    );
    const before = await files();
    await expect(run()).rejects.toThrow(NotionExportError);
    expect(await files()).toEqual(before);
  });

  it('refuses a row it cannot pair with a page, and a page the export holds twice', async () => {
    await rm(join(exportDir, `${TASKS}/Fix the sync bug a1000000000000000000000000000006.md`));
    await cp(
      join(exportDir, TASKS),
      join(exportDir, 'Copy', 'Tasks a1000000000000000000000000000000'),
      {
        recursive: true,
      },
    );
    await cp(
      join(exportDir, `${TASKS}_all.csv`),
      join(exportDir, 'Copy', 'Tasks a1000000000000000000000000000000_all.csv'),
    );
    const outcome = await run();
    const refusals = byKind(outcome.pages, 'refused').map((page) =>
      page.kind === 'refused' ? `${page.database} ${page.title}: ${page.reason}` : '',
    );
    expect(refusals).toContain(
      'Tasks Tracker Fix the sync bug: no page in the export has its title',
    );
    expect(refusals).toContain(
      'Tasks Tracker Ship the payroll export: the export holds its page twice: Copy/Tasks a1000000000000000000000000000000/Ship the payroll export a1000000000000000000000000000004.md too',
    );
  });

  it('refuses an export folder that is not there', async () => {
    await expect(run({ exportDir: join(root, 'nowhere') })).rejects.toThrow(
      'export: there is no folder at',
    );
  });
});

describe('the vault', () => {
  it('must be there', async () => {
    await expect(run({ vault: join(root, 'nowhere') })).rejects.toThrow(ImportSetupError);
  });

  it('must not lead a folder out of itself', async () => {
    await mkdir(join(root, 'elsewhere'));
    await symlink(join(root, 'elsewhere'), join(vault, 'Tasks'));
    await expect(run()).rejects.toThrow('folder: Tasks is not a folder inside the vault');
    expect(await readdir(join(root, 'elsewhere'))).toEqual([]);
  });

  it('writes nothing, not even a meeting, when its record cannot be written', async () => {
    await mkdir(join(vault, '.atlas', 'imports'));
    await chmod(join(vault, '.atlas', 'imports'), 0o555);
    const before = await files();
    await expect(run()).rejects.toThrow('.atlas/imports/notion-workspace.md cannot be written');
    await chmod(join(vault, '.atlas', 'imports'), 0o755);
    expect([...(await files()).keys()]).toEqual([...before.keys()]);
  });

  it('keeps a record the run trusts, or the run does not start', async () => {
    await mkdir(join(vault, '.atlas', 'imports'));
    await writeFile(join(vault, '.atlas', 'imports', 'notion-workspace.md'), 'not a record\n');
    const before = await files();
    await expect(run()).rejects.toThrow('cannot be read (it has no list of pages)');
    await writeFile(join(vault, '.atlas', 'imports', 'notion-workspace.md'), Buffer.from([0xff]));
    await expect(run()).rejects.toThrow('cannot be read (it is not UTF-8 text)');
    expect([...(await files()).keys()]).toEqual([...before.keys()]);
  });
});

const NOTES = `${SHARED}/Notes b2000000000000000000000000000000`;
const MEETING_PAGE =
  '../Meeting%20Notes%205d0c9e2a7b1f4c3e8a6d2b9f0e1c7a54/Platform%20weekly%20sync%207c41e0d2a9b84f6e9d3a1c5b7e2f8a06.md';

const pageOf = (pages: readonly PageOutcome[], title: string) =>
  pages.find((page) => page.title === title);

const notesOfPage = (pages: readonly PageOutcome[], title: string) => {
  const page = pageOf(pages, title);
  return page !== undefined && 'notes' in page ? page.notes : [];
};

const pageTitled = (pages: readonly PageOutcome[], title: string) =>
  pages.find((page) => page.title === title);

const notesOf = (page: PageOutcome | undefined) =>
  page !== undefined && 'notes' in page ? page.notes : [];

describe('a note deleted in Atlas', () => {
  const SHIP = 'Tasks/Ship the payroll export.md';

  it('is listed and not made again, deleted or hidden, until asked for', async () => {
    await run();
    await rm(join(vault, SHIP));
    const second = await run();
    expect((await files()).has(SHIP)).toBe(false);
    expect(pageTitled(second.pages, 'Ship the payroll export')).toEqual({
      kind: 'deleted',
      database: 'Tasks Tracker',
      title: 'Ship the payroll export',
      id: 'a1000000000000000000000000000004',
    });
    expect(workspaceImported(second)).toBe(true);
    const third = await run({ recreateDeleted: true });
    expect(pageTitled(third.pages, 'Ship the payroll export')).toMatchObject({ kind: 'create' });
    expect(await properties(SHIP)).toMatchObject({ status: 'archive' });
  });

  it('is linked by its name from the notes that name it, and the report says why', async () => {
    await run();
    await rm(join(vault, 'People/Mara Quill.md'));
    const outcome = await run();
    expect(await properties('Tasks/Renew the Larkspur contract.md')).toMatchObject({
      people: ['[[Mara Quill]]'],
    });
    expect(notesOf(pageTitled(outcome.pages, 'Renew the Larkspur contract'))).toContain(
      'People: "Mara Quill" was deleted in Atlas; linked by its name',
    );
  });
});

describe('a relation naming a page by its id', () => {
  it('is never taken for another page of the same title when its own is not in the run', async () => {
    const people = `${SHARED}/People c3000000000000000000000000000000`;
    await editExport(`${people}_all.csv`, 'Tobias Fenn,tobias.fenn@example.com,,Engineer,,\n', '');
    await rm(join(exportDir, people, 'Tobias Fenn c3000000000000000000000000000002.md'));
    await editExport(
      `${SHARED}/Teams e5000000000000000000000000000000_all.csv`,
      'Platform,',
      'Tobias Fenn,',
    );
    await editExport(
      `${SHARED}/Teams e5000000000000000000000000000000/Platform e5000000000000000000000000000001.md`,
      '# Platform',
      '# Tobias Fenn',
    );
    const outcome = await run();
    expect(notesOf(pageTitled(outcome.pages, 'Chase the signed order form'))).toContain(
      'People: "Tobias Fenn" is not in this run; linked by its name',
    );
  });
});

describe('a new note', () => {
  it("never takes another note's [[links]]: it is numbered instead, and the report says so", async () => {
    await mkdir(join(vault, 'Old', 'Deep'), { recursive: true });
    await writeFile(join(vault, 'Old', 'Deep', 'Mara Quill.md'), 'Someone else.\n');
    const outcome = await run();
    expect(notesOf(pageTitled(outcome.pages, 'Mara Quill'))).toEqual([
      '[[Mara Quill]] already opens Old/Deep/Mara Quill.md: named People/Mara Quill 2.md so it does not take its links',
    ]);
    const all = [...(await files()).keys()].map(createVaultPath);
    expect(resolveWikiLinkTarget('Mara Quill', all)).toBe('Old/Deep/Mara Quill.md');
    expect(await properties('Tasks/Renew the Larkspur contract.md')).toMatchObject({
      people: ['[[Mara Quill 2]]'],
    });
  });
});

describe('a link to a meeting page', () => {
  it('names the note the meeting import wrote for it in the same run', async () => {
    await editExport(
      `${NOTES}/Renewal terms b2000000000000000000000000000001.md`,
      'Three-year term',
      `[The sync](${MEETING_PAGE}) agreed a three-year term`,
    );
    await editExport(
      `${NOTES}_all.csv`,
      'Pricing [draft],inbox,,,,,Quarterly numbers,',
      `Pricing [draft],inbox,,,,,Platform weekly sync (${MEETING_PAGE}),`,
    );
    await run();
    expect(splitFrontmatter(await note('Notes/Renewal terms.md')).body).toContain(
      '[[2026-10-06 Platform weekly sync|The sync]] agreed',
    );
    expect(await properties('Notes/Pricing draft.md')).toMatchObject({
      related: ['[[2026-10-06 Platform weekly sync]]'],
    });
  });

  it('says so when the run does not bring that meeting in', async () => {
    await editExport(
      `${NOTES}_all.csv`,
      'Pricing [draft],inbox,,,,,Quarterly numbers,',
      `Pricing [draft],inbox,,,,,Platform weekly sync (${MEETING_PAGE}),`,
    );
    // Without --gemini-dates, the Gemini meeting is held.
    const outcome = await importNotionWorkspace({
      exportDir,
      vault,
      dryRun: false,
      only: null,
      taskStatuses: [],
      today: '2026-10-10',
      timeZone: 'America/Los_Angeles',
    });
    expect(notesOf(pageTitled(outcome.pages, 'Pricing [draft]'))).toContain(
      'Related: "Platform weekly sync" is a meeting this run does not bring in; linked by its name',
    );
  });
});

describe("the app's own places", () => {
  it('fills in the daily note the vault already has for the day, keeping its own words', async () => {
    await writeFile(join(vault, '2026-10-06.md'), '---\ntype: daily\n---\nMy own day.\n');
    const outcome = await run();
    expect(await properties('2026-10-06.md')).toMatchObject({
      type: 'daily',
      date: '2026-10-06',
      tags: ['daily'],
      notion_id: 'f6000000000000000000000000000001',
    });
    expect(splitFrontmatter(await note('2026-10-06.md')).body).toBe('My own day.\n');
    expect(pageTitled(outcome.pages, 'October 6, 2026')).toMatchObject({
      kind: 'update',
      kept: ['body'],
    });
  });

  it('refuses a daily page with no day', async () => {
    const daily = `${SHARED}/Daily Notes f6000000000000000000000000000000`;
    await editExport(
      `${daily}_all.csv`,
      '"October 6, 2026","October 6, 2026",daily',
      'Week notes,,daily',
    );
    await editExport(
      `${daily}/October 6, 2026 f6000000000000000000000000000001.md`,
      '# October 6, 2026\n\nDate: October 6, 2026\n',
      '# Week notes\n\n',
    );
    const outcome = await run();
    expect(pageTitled(outcome.pages, 'Week notes')).toMatchObject({
      kind: 'refused',
      reason: 'neither its Date nor its title is a day',
    });
  });

  it('files a PARA Archive item as archiving would, so unarchiving takes it back to Projects', async () => {
    await run();
    const stamped = await properties('Archive/Projects/Old migration.md');
    expect(stamped).toMatchObject({
      archived: '2026-06-30',
      archivedFrom: 'Projects/Old migration.md',
    });
    expect(
      originOf(createVaultPath('Archive/Projects/Old migration.md'), stamped['archivedFrom']),
    ).toBe('Projects/Old migration.md');
  });

  it('says which types the vault does not declare, and writes no type file', async () => {
    const outcome = await run({ only: ['people', 'teams'] });
    expect([...outcome.warnings].sort()).toEqual([
      'the vault declares no person type: its notes are written with type: person. Open the vault in Atlas first, which adds the types it builds in, or add the type.',
      'the vault declares no team type: its notes are written with type: team. Open the vault in Atlas first, which adds the types it builds in, or add the type.',
    ]);
    expect(await readdir(join(vault, '.atlas', 'types'))).toEqual(['task.md']);
  });
});

describe('two columns that map to one property', () => {
  it('keep the first, and list the second: a text Notes column never replaces the Note relation', async () => {
    const csv = join(exportDir, `${TASKS}_all.csv`);
    const lines = (await readFile(csv, 'utf8')).split('\n');
    lines[0] = `${lines[0]},Notes`;
    lines[1] = `${lines[1]},Bring the signed copy`;
    await writeFile(csv, lines.join('\n'));
    const outcome = await run();
    expect(await properties('Tasks/Renew the Larkspur contract.md')).toMatchObject({
      notes: ['[[Renewal terms]]'],
    });
    expect(outcome.skipped).toContainEqual({
      what: 'Tasks Tracker',
      reason: '"Notes": it maps to notes, which "Note" fills: not imported',
    });
  });
});

describe('a title ending in a markdown extension', () => {
  it('names a note that links reach', async () => {
    await editExport(
      `${TASKS}_all.csv`,
      'Renew the Larkspur contract,Ready',
      'setup.markdown,Ready',
    );
    await editExport(
      `${TASKS}/Renew the Larkspur contract a1000000000000000000000000000001.md`,
      '# Renew the Larkspur contract',
      '# setup.markdown',
    );
    await run();
    const [link] = (await properties('Notes/Renewal terms.md'))['tasks'] as string[];
    const all = [...(await files()).keys()].map(createVaultPath);
    expect(resolveWikiLinkTarget(link?.slice(2, -2) ?? '', all)).toBe('Tasks/setup markdown.md');
  });
});

describe('a meeting page that is not UTF-8', () => {
  it('stops the run before anything is written', async () => {
    await writeFile(
      join(
        exportDir,
        `${SHARED}/Meeting Notes 5d0c9e2a7b1f4c3e8a6d2b9f0e1c7a54/Platform weekly sync 7c41e0d2a9b84f6e9d3a1c5b7e2f8a06.md`,
      ),
      Buffer.from('# Platform weekly sync\n\nCaf\xe9\n', 'latin1'),
    );
    const before = await files();
    await expect(run()).rejects.toThrow(NotionExportError);
    expect(await files()).toEqual(before);
  });
});

describe("the vault's own note for a day, kept in a folder", () => {
  it('is filled in, and the report says where', async () => {
    await mkdir(join(vault, 'Journal'));
    await writeFile(join(vault, 'Journal', '2026-10-06.md'), 'Written in Obsidian.\n');
    const outcome = await run({ only: ['daily'] });
    expect(await properties('Journal/2026-10-06.md')).toMatchObject({
      notion_id: 'f6000000000000000000000000000001',
    });
    expect(notesOfPage(outcome.pages, 'October 6, 2026')).toContain(
      "filled Journal/2026-10-06.md, the vault's note for 2026-10-06: one at 2026-10-06.md would take its [[2026-10-06]] links",
    );
  });

  it('is never filled with a page when it holds another', async () => {
    await mkdir(join(vault, 'Journal'));
    await writeFile(
      join(vault, 'Journal', '2026-10-06.md'),
      "---\nnotion_id: 'f6000000000000000000000000000099'\n---\nAnother page.\n",
    );
    const outcome = await run({ only: ['daily'] });
    expect(pageOf(outcome.pages, 'October 6, 2026')).toMatchObject({
      kind: 'refused',
      reason: 'Journal/2026-10-06.md, the note for 2026-10-06, holds another Notion page',
    });
    expect((await files()).has('2026-10-06.md')).toBe(false);
  });
});
