/*
 * The window keeps its types and templates until something changes them
 * (#259). Another program changing them must still show, without a restart.
 */
import { expect, test, type Page } from '@playwright/test';
import { createVault, emitVaultChanged, installHost } from './host.ts';

const BOOK_TYPE = ['---', 'name: book', 'label: Book', 'properties:', '  author: text', '---', ''];

async function openBookVault(page: Page) {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/templates');
  await vault.write('.atlas/types/book.md', BOOK_TYPE.join('\n'));
  await vault.write('Dune.md', '---\ntype: book\nauthor: Frank Herbert\n---\n\n# Dune\n');
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

test('a property another program adds to a type shows on its notes', async ({ page }) => {
  const vault = await openBookVault(page);
  await page.getByRole('treeitem', { name: 'Dune', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Properties' });
  await expect(panel.getByLabel('author')).toHaveValue('Frank Herbert');
  await expect(panel.getByLabel('genre')).toHaveCount(0);

  const withGenre = [...BOOK_TYPE.slice(0, -2), '  genre: text', '---', ''];
  await vault.write('.atlas/types/book.md', withGenre.join('\n'));
  await emitVaultChanged(page, ['.atlas/types/book.md']);

  await expect(panel.getByLabel('genre')).toBeVisible();
});

test('a template another program adds is offered for a new note', async ({ page }) => {
  const vault = await openBookVault(page);
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(page.getByRole('menuitem', { name: 'Blank note' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Reading notes' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await vault.write('.atlas/templates/Reading notes.md', '---\ntype: book\n---\n\n# \n');
  await emitVaultChanged(page, ['.atlas/templates/Reading notes.md']);

  await page.getByRole('button', { name: 'New note' }).click();
  await expect(page.getByRole('menuitem', { name: 'Reading notes' })).toBeVisible();
});
