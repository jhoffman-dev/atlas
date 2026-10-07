import { expect, test, type Page } from '@playwright/test';
import { createVault, expectFile, installHost, sidebarSection } from './host.ts';

/**
 * P17-05: every view can be drawn another way from its toolbar, a feed reads
 * the notes' bodies, and a task can be ticked done from any layout — the tick
 * written into its file, as a board drag is.
 */

const TASK_TYPE = [
  '---',
  'name: task',
  'properties:',
  '  status:',
  '    kind: select',
  '    options: [backlog, review, done]',
  '  phase: number',
  '---',
  '',
].join('\n');

const view = (title: string, layout: string, extra: string[] = []) =>
  [
    '---',
    'atlas: view',
    'type: task',
    `layout: ${layout}`,
    ...extra,
    'columns: [phase]',
    'limit: 50',
    '---',
    '',
    `# ${title}`,
    '',
  ].join('\n');

const task = (title: string, status: string, body: string) =>
  [
    '---',
    'type: task',
    `status: ${status}`,
    'phase: 1',
    '---',
    '',
    `# ${title}`,
    '',
    body,
    '',
  ].join('\n');

async function openVault(page: Page) {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/views');
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  await vault.write('.atlas/views/All tasks.md', view('All tasks', 'table'));
  await vault.write('.atlas/views/Board.md', view('Board', 'board', ['groupBy: status']));
  await vault.write(
    'first.md',
    task('First', 'review', 'The first task’s body, pointing at [[Second]].'),
  );
  await vault.write(
    'second.md',
    task('Second', 'backlog', 'The second task’s body, filed under #someday.'),
  );

  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

const openView = (page: Page, name: string) =>
  sidebarSection(page, 'views').getByRole('button', { name, exact: true }).click();

const doneBox = (page: Page, title: string) =>
  page.getByRole('checkbox', { name: `Mark ${title} done` });

test('ticking a task in a table marks it done, the board follows, and unticking puts it back', async ({
  page,
}) => {
  const vault = await openVault(page);
  await openView(page, 'All tasks');

  // The status is not one of the table's columns, and still the box knows it.
  await expect(doneBox(page, 'First')).not.toBeChecked();
  await doneBox(page, 'First').click();
  await expectFile(vault, 'first.md').toContain('status: done');
  await expect(doneBox(page, 'First')).toBeChecked();
  expect(await vault.read('first.md')).toContain('The first task’s body');

  await page
    .getByRole('navigation', { name: 'Views' })
    .getByRole('button', { name: 'Board' })
    .click();
  const doneColumn = page.getByRole('region', { name: 'done' });
  await expect(doneColumn.getByRole('button', { name: 'first', exact: true })).toBeVisible();
  await expect(doneColumn.getByRole('checkbox', { name: 'Mark First done' })).toBeChecked();

  // Unticked on the board: back to review, where it was before — not the start.
  await doneColumn.getByRole('checkbox', { name: 'Mark First done' }).click();
  await expectFile(vault, 'first.md').toContain('status: review');
  const reviewColumn = page.getByRole('region', { name: 'review' });
  await expect(reviewColumn.getByRole('button', { name: 'first', exact: true })).toBeVisible();
});

test('a view switched to a feed reads each note’s body, and to a gallery draws cards', async ({
  page,
}) => {
  const vault = await openVault(page);
  await openView(page, 'All tasks');

  await page.getByRole('button', { name: 'Layout', exact: true }).click();
  await page.getByRole('menuitemradio', { name: /Feed/ }).click();

  const first = page.getByRole('article', { name: 'First' });
  await expect(first.getByLabel('Body of First')).toContainText('pointing at');
  await expect(
    page.getByRole('article', { name: 'Second' }).getByLabel('Body of Second'),
  ).toContainText('The second task’s body');
  // The feed is a tickable layout like the rest.
  await expect(first.getByRole('checkbox', { name: 'Mark First done' })).not.toBeChecked();

  // Drawn at once, and like a filter, only written into the view when saved.
  expect(await vault.read('.atlas/views/All tasks.md')).toContain('layout: table');
  await page.getByRole('button', { name: 'Save view' }).click();
  await expectFile(vault, '.atlas/views/All tasks.md').toContain('layout: feed');

  // A link in a body opens its note.
  await first.locator('[data-wikilink="Second"]').click();
  await expect(page.getByRole('heading', { name: 'second', exact: true, level: 1 })).toBeVisible();

  await openView(page, 'All tasks');
  await page.getByRole('button', { name: 'Layout', exact: true }).click();
  await page.getByRole('menuitemradio', { name: /Gallery/ }).click();
  const gallery = page.getByRole('list', { name: 'Notes' });
  await expect(gallery.getByRole('button', { name: 'first', exact: true })).toBeVisible();
  await expect(gallery.getByRole('checkbox', { name: 'Mark Second done' })).toBeVisible();

  // Reset puts the saved layout back, and the file never heard of the gallery.
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByRole('article', { name: 'First' })).toBeVisible();
  expect(await vault.read('.atlas/views/All tasks.md')).toContain('layout: feed');
});

test('a tag in a feed card’s body opens the tags page on it', async ({ page }) => {
  await openVault(page);
  await openView(page, 'All tasks');
  await page.getByRole('button', { name: 'Layout', exact: true }).click();
  await page.getByRole('menuitemradio', { name: /Feed/ }).click();

  const second = page.getByRole('article', { name: 'Second' });
  await second.locator('[data-tag="someday"]').click();
  await expect(page.getByRole('heading', { name: '#someday', level: 2 })).toBeVisible();
});

test('a new view can be made as a feed', async ({ page }) => {
  const vault = await openVault(page);
  await sidebarSection(page, 'types').getByRole('button', { name: /^task/i }).click();
  await page
    .getByRole('navigation', { name: 'Views' })
    .getByRole('button', { name: 'Add a view' })
    .click();
  await page.getByRole('menuitem', { name: /Feed/ }).click();

  await expectFile(vault, '.atlas/views/task feed.md').toContain('layout: feed');
  await expect(
    page.getByRole('article', { name: 'First' }).getByLabel('Body of First'),
  ).toContainText('pointing at');
});

test('the Layout menu says why a calendar cannot be chosen for a type with no date', async ({
  page,
}) => {
  await openVault(page);
  await openView(page, 'All tasks');

  await page.getByRole('button', { name: 'Layout', exact: true }).click();
  const calendar = page.getByRole('menuitemradio', { name: /Calendar/ });
  await expect(calendar).toBeVisible();
  await expect(calendar).toHaveAttribute('aria-disabled', 'true');
  await expect(calendar).toContainText('A calendar needs a date');
});
