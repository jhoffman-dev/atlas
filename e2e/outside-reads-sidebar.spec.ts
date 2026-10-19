/*
 * The window reads the vault's settings once, and the sidebar's views,
 * dashboards and types again only when one of them changes (#293). Another
 * program changing any of them must still show, without a restart.
 */
import { expect, test, type Page } from './fixtures.ts';
import {
  createVault,
  emitVaultChanged,
  installHost,
  sidebarSection,
  type FakeVault,
} from './host.ts';

const TASK_TYPE = ['---', 'name: task', 'label: Task', '---', ''].join('\n');
const view = (title: string) =>
  ['---', 'atlas: view', 'type: task', 'layout: table', '---', '', `# ${title}`, ''].join('\n');

async function openVault(page: Page): Promise<FakeVault> {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/views');
  await vault.mkdir('.atlas/dashboards');
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  await vault.write('.atlas/views/Board.md', view('Board'));
  await vault.write('.atlas/settings.md', '---\nsidebarOrder: [favorites, types, views]\n---\n');
  await vault.write('Garden.md', '---\ntype: task\n---\n\n# Garden\n');
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

const headings = (page: Page) =>
  page.getByRole('navigation', { name: 'Vault' }).getByRole('heading', { level: 2 });

test('an edit another program makes to the settings shows without a restart', async ({ page }) => {
  const vault = await openVault(page);
  await expect(headings(page)).toHaveText(['Favorites', 'Types', 'Views', 'Dashboards', 'Pages']);

  await vault.write(
    '.atlas/settings.md',
    '---\nsidebarOrder: [views, dashboards, types, favorites, userSpace]\n---\n',
  );
  await emitVaultChanged(page, ['.atlas/settings.md']);

  await expect(headings(page)).toHaveText(['Views', 'Dashboards', 'Types', 'Favorites', 'Pages']);
});

test('a view another program adds is listed under Views', async ({ page }) => {
  const vault = await openVault(page);
  const views = sidebarSection(page, 'views');
  await expect(views.getByRole('button', { name: 'Board', exact: true })).toBeVisible();
  await expect(views.getByRole('button', { name: 'Planner', exact: true })).toHaveCount(0);

  await vault.write('.atlas/views/Planner.md', view('Planner'));
  await emitVaultChanged(page, ['.atlas/views/Planner.md']);

  await expect(views.getByRole('button', { name: 'Planner', exact: true })).toBeVisible();
});

test('a dashboard another program adds is listed under Dashboards', async ({ page }) => {
  const vault = await openVault(page);
  const dashboards = sidebarSection(page, 'dashboards');
  await expect(dashboards.getByText('No dashboards yet.')).toBeVisible();

  await vault.write('.atlas/dashboards/Week.md', '---\natlas: dashboard\n---\n\n# Week\n');
  await emitVaultChanged(page, ['.atlas/dashboards/Week.md']);

  await expect(dashboards.getByRole('button', { name: 'Week', exact: true })).toBeVisible();
});

test('a type another program adds is listed under Types, with its count', async ({ page }) => {
  const vault = await openVault(page);
  const types = sidebarSection(page, 'types');
  await expect(types.getByRole('button', { name: 'Task, 1 note' })).toBeVisible();
  await expect(types.getByRole('button', { name: /^Film/ })).toHaveCount(0);

  await vault.write('.atlas/types/film.md', '---\nname: film\nlabel: Film\n---\n');
  await vault.write('Arrival.md', '---\ntype: film\n---\n\n# Arrival\n');
  await emitVaultChanged(page, ['.atlas/types/film.md', 'Arrival.md']);

  await expect(types.getByRole('button', { name: 'Film, 1 note' })).toBeVisible();
});
