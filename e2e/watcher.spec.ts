import { expect, test, type Page } from '@playwright/test';
import { createVault, emitVaultChanged, expectSaved, installHost, saveNow } from './host.ts';

async function openNote(page: Page) {
  const vault = await createVault();
  await vault.write('note.md', '# Note\n\nOriginal paragraph.\n');
  await vault.write('other.md', '# Other\n');
  await installHost(page, vault);

  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await page.getByRole('treeitem', { name: 'note', exact: true }).click();
  await expect(page.getByRole('article', { name: 'note' })).toBeVisible();
  return vault;
}

test('an edit still saves after the vault changes underneath', async ({ page }) => {
  const vault = await openNote(page);

  await page.getByText('Original paragraph.').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Edited.');
  await expect(page.getByText('Unsaved')).toBeVisible();

  // Something else touches the vault — another app, a sync client, or the board
  // writing a task file while Atlas is open.
  await emitVaultChanged(page, ['other.md']);
  await page.waitForTimeout(300);

  await saveNow(page);
  await expectSaved(page);

  expect(await vault.read('note.md')).toBe('# Note\n\nOriginal paragraph. Edited.\n');
});

test('typing after the vault changes underneath still marks the note unsaved', async ({ page }) => {
  const vault = await openNote(page);

  await emitVaultChanged(page, ['other.md']);
  await page.waitForTimeout(300);

  await page.getByText('Original paragraph.').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Typed later.');

  await expect(page.getByText('Unsaved')).toBeVisible();
  await saveNow(page);
  await expectSaved(page);

  expect(await vault.read('note.md')).toContain('Typed later.');
});
