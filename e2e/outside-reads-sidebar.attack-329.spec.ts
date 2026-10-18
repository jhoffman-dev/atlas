/*
 * Attack on #293 (PR #329): the settings note and the sidebar's counts and
 * marks are cached reads now. What another program does to them must show
 * without a restart, and a settings note that breaks must not quietly put the
 * sidebar back to its defaults.
 */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  createVault,
  emitVaultChanged,
  installHost,
  sidebarSection,
  type FakeVault,
} from './host.ts';

const PROJECT_TYPE = [
  '---',
  'name: project',
  'label: Project',
  'properties:',
  '  para:',
  '    kind: select',
  '    label: PARA',
  '    options: [project, area, resource, archive]',
  '---',
  '',
].join('\n');
const TASK_TYPE = ['---', 'name: task', 'label: Task', '---', ''].join('\n');
const CHOSEN = '---\nsidebarOrder: [views, dashboards, types, favorites, userSpace]\n---\n';
const CHOSEN_HEADINGS = ['Views', 'Dashboards', 'Types', 'Favorites', 'Pages'];

async function openVault(page: Page): Promise<FakeVault> {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.write('.atlas/types/project.md', PROJECT_TYPE);
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  await vault.write('.atlas/settings.md', CHOSEN);
  await vault.write(
    'Lantern Works.md',
    '---\ntype: project\npara: project\n---\n\n# Lantern Works\n',
  );
  await vault.write('Orchard.md', '---\ntype: project\npara: area\n---\n\n# Orchard\n');
  await vault.write('Mend the fence.md', '---\ntype: task\n---\n\n# Mend the fence\n');
  await vault.write('Order seeds.md', '---\ntype: task\n---\n\n# Order seeds\n');
  // The real index lists what it holds, so a refresh can see a note gone.
  await installHost(page, vault, { keepsManifest: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

const headings = (page: Page) =>
  page.getByRole('navigation', { name: 'Vault' }).getByRole('heading', { level: 2 });

test('a settings note another program deletes puts the sidebar back to its own order', async ({
  page,
}) => {
  const vault = await openVault(page);
  await expect(headings(page)).toHaveText(CHOSEN_HEADINGS);

  await rm(join(vault.root, '.atlas/settings.md'));
  await emitVaultChanged(page, ['.atlas/settings.md']);

  await expect(headings(page)).not.toHaveText(CHOSEN_HEADINGS);
});

test('a settings note emptied by another program says nothing, and the order goes', async ({
  page,
}) => {
  const vault = await openVault(page);
  await expect(headings(page)).toHaveText(CHOSEN_HEADINGS);

  await vault.write('.atlas/settings.md', '');
  await emitVaultChanged(page, ['.atlas/settings.md']);

  await expect(headings(page)).not.toHaveText(CHOSEN_HEADINGS);
});

test('a settings note made unreadable keeps the order shown, and its fix shows', async ({
  page,
}) => {
  const vault = await openVault(page);
  await expect(headings(page)).toHaveText(CHOSEN_HEADINGS);

  await vault.write('.atlas/settings.md', '---\nsidebarOrder: [views\n  broken: : :\n---\n');
  await emitVaultChanged(page, ['.atlas/settings.md']);
  // Give the read its chance to land before checking nothing moved.
  await expect(page.getByText(/settings\.md can.t be read/).first()).toBeVisible();
  await expect(headings(page)).toHaveText(CHOSEN_HEADINGS);

  await vault.write(
    '.atlas/settings.md',
    '---\nsidebarOrder: [types, views, dashboards, favorites, userSpace]\n---\n',
  );
  await emitVaultChanged(page, ['.atlas/settings.md']);
  await expect(headings(page)).toHaveText(['Types', 'Views', 'Dashboards', 'Favorites', 'Pages']);
});

test('a project another program archives leaves the Project count', async ({ page }) => {
  const vault = await openVault(page);
  const types = sidebarSection(page, 'types');
  await expect(types.getByRole('button', { name: 'Project, 2 notes' })).toBeVisible();

  await vault.write('Orchard.md', '---\ntype: project\npara: archive\n---\n\n# Orchard\n');
  await emitVaultChanged(page, ['Orchard.md']);

  await expect(types.getByRole('button', { name: 'Project, 1 note' })).toBeVisible();
});

test('a task another program deletes leaves the Task count', async ({ page }) => {
  const vault = await openVault(page);
  const types = sidebarSection(page, 'types');
  await expect(types.getByRole('button', { name: 'Task, 2 notes' })).toBeVisible();

  await rm(join(vault.root, 'Order seeds.md'));
  await emitVaultChanged(page, ['Order seeds.md']);

  await expect(types.getByRole('button', { name: 'Task, 1 note' })).toBeVisible();
});

test('a note another program stars is listed under Favorites', async ({ page }) => {
  const vault = await openVault(page);
  const favorites = sidebarSection(page, 'favorites');
  await expect(favorites.getByRole('button', { name: 'Mend the fence', exact: true })).toHaveCount(
    0,
  );

  await vault.write(
    'Mend the fence.md',
    '---\ntype: task\nfavorite: true\n---\n\n# Mend the fence\n',
  );
  await emitVaultChanged(page, ['Mend the fence.md']);

  await expect(
    favorites.getByRole('button', { name: 'Mend the fence', exact: true }),
  ).toBeVisible();
});
