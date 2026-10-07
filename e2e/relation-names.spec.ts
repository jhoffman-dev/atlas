/**
 * As James met it: "Relations added as a property always have square
 * brackets around the name." A relation is stored as `[[Note]]`, and that is
 * how it was shown — in the table, on the board's cards, on a dashboard's bars.
 * Wherever a relation is shown it is the linked note's name.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  createVault,
  emitVaultChanged,
  expectFile,
  installHost,
  sidebarSection,
  type FakeVault,
} from './host.ts';

const TASK_TYPE = [
  '---',
  'name: task',
  'label: Task',
  'properties:',
  '  status:',
  '    kind: select',
  '    options: [next, done]',
  '---',
  '',
].join('\n');

const PROJECT_TYPE = '---\nname: project\nlabel: Project\nproperties:\n  goal: text\n---\n';
const PERSON_TYPE = '---\nname: person\nlabel: Person\nproperties:\n  role: text\n---\n';

const view = (layout: string) =>
  [
    '---',
    'atlas: view',
    'type: task',
    `layout: ${layout}`,
    'groupBy: status',
    'columns: [status, project, people]',
    '---',
    '',
  ].join('\n');

const DASHBOARD = [
  '---',
  'atlas: dashboard',
  'widgets:',
  '  - title: By project',
  '    kind: bar',
  '    type: task',
  '    groupBy: project',
  '---',
  '',
].join('\n');

async function open(page: Page, files: Record<string, string>): Promise<FakeVault> {
  const vault = await createVault();
  for (const folder of ['.atlas/types', '.atlas/views', '.atlas/dashboards']) {
    await vault.mkdir(folder);
  }
  for (const [path, text] of Object.entries(files)) await vault.write(path, text);
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

const properties = (page: Page) => page.getByRole('region', { name: 'Properties' });

async function openNote(page: Page, name: string) {
  await page.getByRole('treeitem', { name, exact: true }).click();
  await expect(page.getByRole('article', { name })).toBeVisible();
}

async function addRelation(
  page: Page,
  { name, target, many }: { name: string; target: string; many: boolean },
) {
  await properties(page).getByRole('button', { name: 'Add a property' }).click();
  const popover = page.getByRole('dialog', { name: 'Add a property' });
  await popover.getByRole('textbox', { name: 'Property name' }).fill(name);
  await popover.getByRole('combobox', { name: 'Kind' }).selectOption('relation');
  await popover.getByRole('combobox', { name: 'Points at' }).selectOption({ label: target });
  if (many) await popover.getByRole('checkbox', { name: 'Several notes' }).check();
  await expect(popover.getByRole('radio', { name: 'Add to Task (every task)' })).toBeChecked();
  await popover.getByRole('button', { name: 'Add property' }).click();
  await expect(popover).toBeHidden();
}

const FILES = {
  '.atlas/types/task.md': TASK_TYPE,
  '.atlas/types/project.md': PROJECT_TYPE,
  '.atlas/types/person.md': PERSON_TYPE,
  '.atlas/views/Task table.md': view('table'),
  '.atlas/views/Task board.md': view('board'),
  '.atlas/dashboards/Work.md': DASHBOARD,
  'Atlas.md': '---\ntype: project\n---\n\n# Atlas\n',
  'Ada Lovelace.md': '---\ntype: person\n---\n\n# Ada Lovelace\n',
  'Grace Hopper.md': '---\ntype: person\n---\n\n# Grace Hopper\n',
  'Write docs.md': '---\ntype: task\nstatus: next\n---\n\n# Write docs\n',
};

test('a relation set through the note reads as the note it names, everywhere it is shown', async ({
  page,
}) => {
  const vault = await open(page, FILES);
  await openNote(page, 'Write docs');

  await addRelation(page, { name: 'Project', target: 'Project', many: false });
  const project = properties(page).getByRole('combobox', { name: 'Project' });
  await expect.poll(() => project.locator('option').allTextContents()).toContain('Atlas');
  await project.selectOption({ label: 'Atlas' });
  await expectFile(vault, 'Write docs.md').toContain('project: "[[Atlas]]"');

  await addRelation(page, { name: 'People', target: 'Person', many: true });
  const people = properties(page).getByRole('combobox', { name: 'People' });
  await expect.poll(() => people.locator('option').allTextContents()).toContain('Grace Hopper');
  await people.selectOption({ label: 'Ada Lovelace' });
  await people.selectOption({ label: 'Grace Hopper' });
  await expectFile(vault, 'Write docs.md').toMatch(
    /\npeople:\n {2}- "\[\[Ada Lovelace\]\]"\n {2}- "\[\[Grace Hopper\]\]"\n/,
  );

  // The note's own rows: the note's name, which opens it.
  await expect(properties(page).getByRole('button', { name: 'Open Atlas' })).toBeVisible();
  await expect(
    properties(page).getByRole('list', { name: 'People' }).getByRole('listitem'),
  ).toHaveText(['Ada Lovelace', 'Grace Hopper']);
  await expect(properties(page)).not.toContainText('[[');
  // What the host's watcher tells the index once the writes are on disk.
  await emitVaultChanged(page, ['Write docs.md']);

  // A table cell.
  await sidebarSection(page, 'views')
    .getByRole('button', { name: 'Task table', exact: true })
    .click();
  const table = page.locator('.table__grid');
  await expect(table.getByRole('button', { name: 'Open Atlas' })).toBeVisible();
  await expect(table.getByRole('button', { name: 'Open Grace Hopper' })).toBeVisible();
  await expect(table).not.toContainText('[[');

  // A board card's chips.
  await sidebarSection(page, 'views')
    .getByRole('button', { name: 'Task board', exact: true })
    .click();
  const next = page.getByRole('region', { name: 'next', exact: true });
  await expect(next.getByText('Atlas', { exact: true })).toBeVisible();
  await expect(next.getByText('Ada Lovelace, Grace Hopper', { exact: true })).toBeVisible();
  await expect(next).not.toContainText('[[');

  // A dashboard's bars.
  await sidebarSection(page, 'dashboards')
    .getByRole('button', { name: 'Work', exact: true })
    .click();
  await expect(page.getByLabel('By project').locator('.bars__label')).toHaveText(['Atlas']);
});

test('a relation to a note that is not there reads as its bare name, marked missing', async ({
  page,
}) => {
  await open(page, {
    ...FILES,
    '.atlas/types/task.md': TASK_TYPE.replace(
      '    options: [next, done]\n',
      '    options: [next, done]\n  project:\n    kind: relation\n    target: project\n',
    ),
    'Write docs.md':
      '---\ntype: task\nstatus: next\nproject: "[[Gone]]"\nmentor: "[[Ada Lovelace]]"\n---\n\n# Write docs\n',
  });
  await openNote(page, 'Write docs');

  // Declared, pointing nowhere: the name alone, struck through.
  const gone = properties(page).getByText('Gone', { exact: true });
  await expect(gone).toBeVisible();
  await expect(gone).toHaveAttribute('data-missing', 'true');
  // Not declared by the type, but a link all the same.
  await expect(properties(page).getByRole('button', { name: 'Open Ada Lovelace' })).toBeVisible();
  await expect(properties(page)).not.toContainText('[[');
});
