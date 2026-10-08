import { expect, test, type Page } from '@playwright/test';
import { createVault, expectFile, installHost, sidebarSection } from './host.ts';
import { dragCardTo } from './drag.ts';

const TASK_TYPE = [
  '---',
  'name: task',
  'properties:',
  '  status:',
  '    kind: select',
  '    options: [backlog, doing, done]',
  '  due: date',
  '  recurrence: text',
  '---',
  '',
].join('\n');

const TASK_TEMPLATE = [
  '---',
  'type: task',
  'status: backlog',
  'due:',
  '---',
  '',
  '# ',
  '',
  '',
].join('\n');

const BOARD = [
  '---',
  'atlas: view',
  'type: task',
  'layout: board',
  'groupBy: status',
  'columns: [status, due]',
  'limit: 50',
  '---',
  '',
  '# Board',
  '',
].join('\n');

async function openTaskVault(page: Page) {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/views');
  await vault.mkdir('.atlas/templates');
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  await vault.write('.atlas/templates/Task.md', TASK_TEMPLATE);
  await vault.write('.atlas/views/Board.md', BOARD);
  await vault.write(
    'one off.md',
    ['---', 'type: task', 'status: doing', '---', '', 'Once.', ''].join('\n'),
  );
  await vault.write(
    'water the plants.md',
    [
      '---',
      'type: task',
      'status: doing',
      'due: 2026-09-20',
      'recurrence: weekly',
      '---',
      '',
      'Every week.',
      '',
    ].join('\n'),
  );

  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

async function openBoard(page: Page) {
  await sidebarSection(page, 'views').getByRole('button', { name: 'Board', exact: true }).click();
  await expect(page.locator('.board__column').first()).toBeVisible();
}

test('a captured line becomes a task in the Inbox, without leaving the note in view', async ({
  page,
}) => {
  const vault = await openTaskVault(page);

  await page.keyboard.down('Meta');
  await page.keyboard.down('Shift');
  await page.keyboard.press('n');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Meta');

  const capture = page.getByRole('dialog', { name: 'Capture a task' });
  await expect(capture).toBeVisible();
  await expect(capture.getByText(/a Task/)).toBeVisible();

  await page.getByRole('textbox', { name: 'What needs doing' }).fill('Renew the passport');
  await page.getByRole('textbox', { name: 'What needs doing' }).press('Enter');

  // It is a task, from the vault's own template, waiting in the Inbox (P30-01).
  await expectFile(vault, 'Inbox/Renew the passport.md').toContain('type: task');
  expect(await vault.read('Inbox/Renew the passport.md')).toContain('status: backlog');
});

test('capture stays open for the next thought', async ({ page }) => {
  const vault = await openTaskVault(page);

  await page.keyboard.down('Meta');
  await page.keyboard.down('Shift');
  await page.keyboard.press('n');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Meta');

  const field = page.getByRole('textbox', { name: 'What needs doing' });
  await field.fill('First thing');
  await field.press('Enter');
  await field.fill('Second thing');
  await field.press('Enter');

  await expectFile(vault, 'Inbox/First thing.md').toContain('type: task');
  await expectFile(vault, 'Inbox/Second thing.md').toContain('type: task');
});

test('finishing a repeating task moves it on instead of ending it', async ({ page }) => {
  const vault = await openTaskVault(page);
  await openBoard(page);
  await page.locator('[data-path="water the plants.md"]').waitFor();

  await dragCardTo(page, 'water the plants.md', 'done');

  const saved = await expect
    .poll(() => vault.read('water the plants.md'))
    .toContain('due: 2026-09-27')
    .then(() => vault.read('water the plants.md'));

  // Back in play rather than finished, and it remembers when it was last done.
  expect(saved).toContain('status: backlog');
  expect(saved).toContain('lastCompleted: 2026-09-20');
  expect(saved).toContain('recurrence: weekly');
});

test('finishing an ordinary task just finishes it', async ({ page }) => {
  const vault = await openTaskVault(page);
  await openBoard(page);
  await page.locator('[data-path="one off.md"]').waitFor();

  await dragCardTo(page, 'one off.md', 'done');

  await expectFile(vault, 'one off.md').toContain('status: done');
});

test('capture does not also make a blank note', async ({ page }) => {
  const vault = await openTaskVault(page);

  await page.keyboard.down('Meta');
  await page.keyboard.down('Shift');
  await page.keyboard.press('n');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Meta');

  await page.getByRole('textbox', { name: 'What needs doing' }).fill('Only this');
  await page.getByRole('textbox', { name: 'What needs doing' }).press('Enter');
  await expectFile(vault, 'Inbox/Only this.md').toContain('type: task');

  await expect(page.getByRole('treeitem', { name: 'Untitled', exact: true })).toHaveCount(0);
});
