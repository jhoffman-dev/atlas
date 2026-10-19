/**
 * Issue #212: a table's filter filters, and its value box offers the values
 * the property can take — a task's GTD statuses, a select's options.
 */
import { expect, test, type Page } from './fixtures.ts';
import { createVault, expectFile, installHost, sidebarSection, type FakeVault } from './host.ts';

const note = (frontmatter: string[], body: string) =>
  ['---', ...frontmatter, '---', '', body, ''].join('\n');

const TASK_TYPE = [
  '---',
  'name: task',
  'label: Task',
  'properties:',
  '  status:',
  '    kind: select',
  '    options: [inbox, backlog, next-action, in-progress, waiting, someday, longterm, archive]',
  '    done: archive',
  '  priority:',
  '    kind: select',
  '    options: [low, high]',
  '  project:',
  '    kind: relation',
  '    target: project',
  '  tags:',
  '    kind: multiSelect',
  '  urgent: checkbox',
  '  due: date',
  '---',
  '',
  '# Task',
  '',
].join('\n');

const TABLE = [
  '---',
  'atlas: view',
  'type: task',
  'columns: [status, priority]',
  'limit: 50',
  '---',
  '',
  '# Tasks',
  '',
].join('\n');

const PROJECT_TYPE = ['---', 'name: project', 'label: Project', '---', ''].join('\n');

const FILES: Record<string, string> = {
  '.atlas/types/task.md': TASK_TYPE,
  '.atlas/types/project.md': PROJECT_TYPE,
  '.atlas/views/Tasks.md': TABLE,
  'projects/Larkspur launch.md': note(['type: project'], 'A launch.'),
  'projects/Quill audit.md': note(['type: project'], 'An audit.'),
  'tasks/Call the bank.md': note(
    [
      'type: task',
      'status: next-action',
      'priority: high',
      'project: "[[Larkspur launch]]"',
      'tags: [errand]',
    ],
    'Q3.',
  ),
  'tasks/Draft the memo.md': note(
    ['type: task', 'status: in-progress', 'priority: low', 'project: "[[Quill audit]]"'],
    'Q3.',
  ),
  'tasks/Ship it.md': note(['type: task', 'status: archive', 'priority: high'], 'Done.'),
};

async function openTable(page: Page): Promise<FakeVault> {
  const vault = await createVault();
  for (const folder of ['.atlas/types', '.atlas/views', 'tasks', 'projects']) {
    await vault.mkdir(folder);
  }
  for (const [path, text] of Object.entries(FILES)) await vault.write(path, text);

  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  await sidebarSection(page, 'views').getByRole('button', { name: 'Tasks', exact: true }).click();
  await expect(row(page, 'Call the bank')).toBeVisible();
  return vault;
}

const row = (page: Page, title: string) =>
  page.locator('.table').getByRole('button', { name: title, exact: true });

async function addFilter(page: Page, property: string, condition: string, value: string) {
  await page.getByRole('button', { name: 'Filter' }).click();
  await page.getByRole('combobox', { name: 'Property' }).selectOption(property);
  await page.getByRole('combobox', { name: 'Condition' }).selectOption(condition);
  await page.getByRole('combobox', { name: 'Value' }).fill(value);
  await page.getByRole('button', { name: 'Add filter' }).click();
  await page.keyboard.press('Escape');
}

test('status is not the status the table shows leaves those tasks out', async ({ page }) => {
  await openTable(page);
  await expect(page.locator('.table')).toContainText('Next Action');

  await addFilter(page, 'status', 'isNot', 'Next Action');

  await expect(row(page, 'Draft the memo')).toBeVisible();
  await expect(row(page, 'Ship it')).toBeVisible();
  await expect(row(page, 'Call the bank')).toHaveCount(0);
});

test('status is the status the table shows keeps only those tasks', async ({ page }) => {
  await openTable(page);

  await addFilter(page, 'status', 'is', 'Next Action');

  await expect(row(page, 'Call the bank')).toBeVisible();
  await expect(row(page, 'Draft the memo')).toHaveCount(0);
  await expect(row(page, 'Ship it')).toHaveCount(0);
});

test('a select property is filtered by the option as the table shows it', async ({ page }) => {
  await openTable(page);

  await addFilter(page, 'priority', 'is', 'High');

  await expect(row(page, 'Call the bank')).toBeVisible();
  await expect(row(page, 'Ship it')).toBeVisible();
  await expect(row(page, 'Draft the memo')).toHaveCount(0);
});

const valueBox = (page: Page) => page.getByRole('combobox', { name: 'Value' });
const offered = (page: Page) => page.getByRole('listbox', { name: 'Values' }).getByRole('option');

async function startFilter(page: Page, property: string, condition: string) {
  await page.getByRole('button', { name: 'Filter' }).click();
  await page.getByRole('combobox', { name: 'Property' }).selectOption(property);
  await page.getByRole('combobox', { name: 'Condition' }).selectOption(condition);
  await valueBox(page).focus();
}

test('the value box offers a task’s GTD statuses, and one is picked from the keyboard', async ({
  page,
}) => {
  const vault = await openTable(page);
  await startFilter(page, 'status', 'isNot');

  await expect(offered(page)).toHaveText([
    'Inbox',
    'Backlog',
    'Next Action',
    'In Progress',
    'Waiting',
    'Someday',
    'Longterm',
    'Archive',
  ]);
  await valueBox(page).pressSequentially('arch');
  await expect(offered(page)).toHaveText(['Archive']);
  await valueBox(page).press('ArrowDown');
  await expect(valueBox(page)).toHaveAttribute('aria-activedescendant', /.+/);
  await valueBox(page).press('Enter');
  await expect(valueBox(page)).toHaveValue('Archive');
  await expect(offered(page)).toHaveCount(0);
  await valueBox(page).press('Enter');

  await expect(page.getByText('Status is not Archive')).toBeVisible();
  await expect(row(page, 'Ship it')).toHaveCount(0);
  await expect(row(page, 'Call the bank')).toBeVisible();

  await page.keyboard.press('Escape');
  await page
    .getByRole('group', { name: 'Unsaved view changes' })
    .getByRole('button', { name: 'Save view' })
    .click();
  await expectFile(vault, '.atlas/views/Tasks.md').toMatch(
    /key: status\n\s+operator: isNot\n\s+value: archive/,
  );
});

test('two "is not" filters leave out both statuses', async ({ page }) => {
  await openTable(page);
  await startFilter(page, 'status', 'isNot');
  await offered(page).filter({ hasText: 'Next Action' }).click();
  await page.getByRole('button', { name: 'Add filter' }).click();
  await page.getByRole('combobox', { name: 'Condition' }).selectOption('isNot');
  await valueBox(page).focus();
  await offered(page).filter({ hasText: 'Archive' }).click();
  await page.getByRole('button', { name: 'Add filter' }).click();

  await expect(row(page, 'Draft the memo')).toBeVisible();
  await expect(row(page, 'Call the bank')).toHaveCount(0);
  await expect(row(page, 'Ship it')).toHaveCount(0);
});

test('a relation offers the notes it points at as they are typed', async ({ page }) => {
  await openTable(page);
  await startFilter(page, 'project', 'is');

  await valueBox(page).pressSequentially('lark');
  await expect(offered(page)).toHaveText(['Larkspur launch']);
  await offered(page).click();
  await page.getByRole('button', { name: 'Add filter' }).click();

  await expect(page.getByText('Project is Larkspur launch')).toBeVisible();
  await expect(row(page, 'Call the bank')).toBeVisible();
  await expect(row(page, 'Draft the memo')).toHaveCount(0);
  await expect(row(page, 'Ship it')).toHaveCount(0);
});

test('tags offer the vault’s tags; a checkbox true and false; a date a picker', async ({
  page,
}) => {
  await openTable(page);
  await startFilter(page, 'tags', 'is');
  await expect(offered(page)).toHaveText(['errand']);

  await page.getByRole('combobox', { name: 'Property' }).selectOption('urgent');
  await valueBox(page).focus();
  await expect(offered(page)).toHaveText(['true', 'false']);
  await valueBox(page).fill('maybe');
  await expect(page.getByRole('button', { name: 'Add filter' })).toBeDisabled();

  await page.getByRole('combobox', { name: 'Property' }).selectOption('due');
  await page.getByLabel('Pick a date').fill('2026-10-14');
  await expect(valueBox(page)).toHaveValue('2026-10-14');
});
