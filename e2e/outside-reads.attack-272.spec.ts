/*
 * PR 272 keeps the graph, tags, types and templates until something changes
 * them (#259). These are the changes another program makes that must still
 * show without a restart: they are what the kept reads could miss.
 */
import { rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createVault, emitVaultChanged, installHost, sidebarSection } from './host.ts';

const TASK_TYPE = [
  '---',
  'name: task',
  'properties:',
  '  status:',
  '    kind: select',
  '    options: [backlog, doing, done]',
  '---',
  '',
].join('\n');

const BOARD = [
  '---',
  'atlas: view',
  'type: task',
  'layout: board',
  'groupBy: status',
  'columns: [status]',
  'limit: 50',
  '---',
  '',
  '# Board',
  '',
].join('\n');

async function openVault(page: Page) {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/views');
  await vault.mkdir('.atlas/templates');
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  await vault.write('.atlas/views/Board.md', BOARD);
  await vault.write('.atlas/templates/Reading notes.md', '---\ntype: task\n---\n\n# \n');
  await vault.write('first.md', '---\ntype: task\nstatus: backlog\n---\n\n# First\n');
  await vault.write('Hub.md', '# Hub\n\nWords.\n');
  await vault.write('Spoke.md', '# Spoke\n\nWords.\n');
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

const newNoteMenu = async (page: Page) => {
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(page.getByRole('menuitem', { name: 'Blank note' })).toBeVisible();
};

test('a status option another program adds to a type shows as a board column', async ({ page }) => {
  const vault = await openVault(page);
  await sidebarSection(page, 'views').getByRole('button', { name: 'Board', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Doing' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Waiting' })).toHaveCount(0);

  await vault.write(
    '.atlas/types/task.md',
    TASK_TYPE.replace('[backlog, doing, done]', '[backlog, doing, waiting, done]'),
  );
  await emitVaultChanged(page, ['.atlas/types/task.md']);

  await expect(page.getByRole('region', { name: 'Waiting' })).toBeVisible();
});

test('a template another program renames is offered by its new name only', async ({ page }) => {
  const vault = await openVault(page);
  await newNoteMenu(page);
  await expect(page.getByRole('menuitem', { name: 'Reading notes' })).toBeVisible();
  await page.keyboard.press('Escape');

  await rename(
    join(vault.root, '.atlas/templates/Reading notes.md'),
    join(vault.root, '.atlas/templates/Book notes.md'),
  );
  await emitVaultChanged(page, [
    '.atlas/templates/Reading notes.md',
    '.atlas/templates/Book notes.md',
  ]);

  await newNoteMenu(page);
  await expect(page.getByRole('menuitem', { name: 'Book notes' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Reading notes' })).toHaveCount(0);
});

test('a template another program deletes is no longer offered', async ({ page }) => {
  const vault = await openVault(page);
  await newNoteMenu(page);
  await expect(page.getByRole('menuitem', { name: 'Reading notes' })).toBeVisible();
  await page.keyboard.press('Escape');

  await rm(join(vault.root, '.atlas/templates/Reading notes.md'));
  await emitVaultChanged(page, ['.atlas/templates/Reading notes.md']);

  await newNoteMenu(page);
  await expect(page.getByRole('menuitem', { name: 'Reading notes' })).toHaveCount(0);
});

test('a type another program adds has a table listing its notes', async ({ page }) => {
  const vault = await openVault(page);

  await vault.write('.atlas/types/film.md', '---\nname: film\nlabel: Film\n---\n');
  await vault.write('Alien.md', '---\ntype: film\n---\n\n# Alien\n');
  await emitVaultChanged(page, ['.atlas/types/film.md', 'Alien.md']);

  await sidebarSection(page, 'types').getByRole('button', { name: /^Film/ }).click();
  const table = page.getByRole('article', { name: 'Film', exact: true });
  // The table reads the type's SQL view: without a rebuild it is "no such table".
  await expect(table.getByRole('button', { name: 'Alien' })).toBeVisible();
});

test('a link another program adds through a frontmatter relation is drawn in the graph', async ({
  page,
}) => {
  const vault = await openVault(page);
  await page.getByRole('list', { name: 'Go to' }).getByRole('button', { name: 'Graph' }).click();
  await expect(page.locator('.graph__surface')).toBeVisible();
  await expect(page.locator('[data-edge="relation"]')).toHaveCount(0);

  await vault.write('Spoke.md', '---\nhub: "[[Hub]]"\n---\n# Spoke\n\nWords.\n');
  await emitVaultChanged(page, ['Spoke.md']);

  await expect(page.locator('[data-edge="relation"]')).toHaveCount(1);
});

test('a link another program takes out of a body leaves the graph', async ({ page }) => {
  const vault = await openVault(page);
  await vault.write('Spoke.md', '# Spoke\n\nOut to [[Hub]].\n');
  await emitVaultChanged(page, ['Spoke.md']);
  await page.getByRole('list', { name: 'Go to' }).getByRole('button', { name: 'Graph' }).click();
  await expect(page.locator('[data-edge="link"]')).toHaveCount(1);

  await vault.write('Spoke.md', '# Spoke\n\nOut to nowhere now.\n');
  await emitVaultChanged(page, ['Spoke.md']);

  await expect(page.locator('[data-edge="link"]')).toHaveCount(0);
});

test('a tag another program adds is listed on the tags page', async ({ page }) => {
  const vault = await openVault(page);
  await vault.write('Spoke.md', '# Spoke\n\nWords. #draft\n');
  await emitVaultChanged(page, ['Spoke.md']);
  await page.getByRole('button', { name: 'Tags', exact: true }).click();
  const tags = page.getByRole('list', { name: 'Tags', exact: true });
  await expect(tags.getByRole('button', { name: /^draft/ })).toBeVisible();
  await expect(tags.getByRole('button', { name: /^someday/ })).toHaveCount(0);

  await vault.write('Hub.md', '# Hub\n\nWords. #someday\n');
  await emitVaultChanged(page, ['Hub.md']);

  await expect(tags.getByRole('button', { name: /^someday/ })).toBeVisible();
});
