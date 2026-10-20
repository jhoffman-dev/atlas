import { expect, test, type Page } from './fixtures.ts';
import {
  createVault,
  emitVaultChanged,
  installHost,
  sidebarSection,
  type FakeVault,
} from './host.ts';

/**
 * Performance 11 (#327): the Archive reads on a key of its own scope, the
 * Archive folder and the projects, and no longer on the index's every news.
 * What it lists still follows another program's change to the Archive.
 */

async function openVault(page: Page): Promise<FakeVault> {
  const vault = await createVault();
  await vault.mkdir('Archive');
  await vault.write('Archive/Old plan.md', '# Old plan\n\nDone with.\n');
  await vault.write('Bakery.md', '# Bakery\n\nWhere to buy sourdough.\n');
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

const archived = (page: Page, name: string) =>
  page.getByRole('article', { name: 'Archive' }).getByRole('button', { name, exact: true });

test('the Archive lists a note another program puts in it, and keeps its list for a note saved elsewhere', async ({
  page,
}) => {
  const vault = await openVault(page);
  await sidebarSection(page, 'userSpace')
    .getByRole('treeitem', { name: 'Archive', exact: true })
    .click();
  await expect(archived(page, 'Old plan')).toBeVisible();

  // Another program puts a note in the Archive, and the watcher says so.
  await vault.write('Archive/Receipts.md', '# Receipts\n\nFiled.\n');
  await emitVaultChanged(page, ['Archive/Receipts.md']);
  await expect(archived(page, 'Receipts')).toBeVisible();

  // A note saved outside the Archive leaves its list as it is.
  await vault.write('Bakery.md', '# Bakery\n\nAnd rye.\n');
  await emitVaultChanged(page, ['Bakery.md']);
  await expect(archived(page, 'Old plan')).toBeVisible();
  await expect(archived(page, 'Receipts')).toBeVisible();
});
