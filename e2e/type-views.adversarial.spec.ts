/**
 * Adversarial pass on issue #11 (ADR-0023): a type's tabs, renamed to what a
 * person might type. A refused name is said, not hung on.
 */
import { expect, test, type Page } from '@playwright/test';
import { createVault, expectFile, installHost, sidebarSection } from './host.ts';

const TASK_TYPE = [
  '---',
  'name: task',
  'label: Task',
  'properties:',
  '  status:',
  '    kind: select',
  '    options: [backlog, doing, done]',
  '---',
  '',
].join('\n');

const view = (title: string, layout: string, extra: readonly string[] = []) =>
  [
    '---',
    'atlas: view',
    'type: task',
    `layout: ${layout}`,
    ...extra,
    '---',
    '',
    `# ${title}`,
    '',
  ].join('\n');

async function openVault(page: Page, typeLabel = 'Task') {
  await page.setViewportSize({ width: 1440, height: 900 });
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/views');
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  await vault.write(
    '.atlas/types/idea.md',
    ['---', 'name: idea', 'label: Idea', '---', ''].join('\n'),
  );
  await vault.write('.atlas/views/Board.md', view('Board', 'board', ['groupBy: status']));
  await vault.write(
    'Ship it.md',
    ['---', 'type: task', 'status: doing', '---', '', '# Ship it', ''].join('\n'),
  );
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  await sidebarSection(page, 'types')
    .getByRole('button', { name: new RegExp(`^${typeLabel}, `) })
    .click();
  return vault;
}

const tabStrip = (page: Page) => page.getByRole('navigation', { name: 'Views' });
const tabTitles = (page: Page) => tabStrip(page).locator('.view-tabs__tab');

test('renaming a type’s default table to a name a file cannot have keeps the name, and the app keeps answering', async ({
  page,
}) => {
  // The default table becomes a file named for what it is renamed to; a name no
  // number can make usable sent uniqueViewName round forever on the UI thread.
  // It is now written under the nearest name a disk holds, called what was typed
  // — as a written tab renamed to it would be.
  test.setTimeout(30_000);
  const vault = await openVault(page, 'Idea');
  await expect(tabTitles(page)).toHaveText(['Idea table']);

  await tabStrip(page).getByRole('button', { name: 'View options' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const name = tabStrip(page).getByRole('textbox', { name: 'View name' });
  await name.fill('Q1/Q2');
  await name.press('Enter');

  await expectFile(vault, '.atlas/views/Q1-Q2.md').toContain('title: Q1/Q2');
  await expect(tabTitles(page)).toHaveText(['Q1/Q2']);

  // Still answering: a menu opens on a click.
  await tabStrip(page).getByRole('button', { name: 'Add a view' }).click({ timeout: 5_000 });
  await expect(page.getByRole('menuitem', { name: /List/ })).toBeVisible({ timeout: 5_000 });
  expect(await vault.exists('.atlas/views/Idea table.md')).toBe(false);
});
