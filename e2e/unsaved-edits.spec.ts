import { expect, test, type Page } from './fixtures.ts';
import { createVault, expectFile, expectSaved, installHost, saveNow } from './host.ts';
import { caretAtLineEnd } from './caret.ts';

async function openVault(page: Page) {
  const vault = await createVault();
  await vault.write('one.md', '# One\n\nFirst note.\n');
  await vault.write('two.md', '# Two\n\nSecond note.\n');
  await installHost(page, vault);

  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  return vault;
}

// U-05: edits made to a document aren't saving.
test('switching notes keeps the edit rather than discarding it', async ({ page }) => {
  const vault = await openVault(page);

  await page.getByRole('treeitem', { name: 'one', exact: true }).click();
  await caretAtLineEnd(page.getByText('First note.'));
  await page.keyboard.type(' Edited.');
  await expect(page.getByText('Unsaved')).toBeVisible();

  // Switch away without saving, the way anyone would.
  await page.getByRole('treeitem', { name: 'two', exact: true }).click();
  await expect(page.getByRole('article', { name: 'two' })).toBeVisible();

  await expectFile(vault, 'one.md').toBe('# One\n\nFirst note. Edited.\n');

  // And it is still there on the way back.
  await page.getByRole('treeitem', { name: 'one', exact: true }).click();
  await expect(page.getByText('First note. Edited.')).toBeVisible();
});

test('an edit is written shortly after typing stops, without pressing anything', async ({
  page,
}) => {
  const vault = await openVault(page);

  await page.getByRole('treeitem', { name: 'one', exact: true }).click();
  await caretAtLineEnd(page.getByText('First note.'));
  await page.keyboard.type(' Typed and left alone.');

  await expect
    .poll(() => vault.read('one.md'), { timeout: 8000 })
    .toContain('Typed and left alone.');
  await expectSaved(page);
});

test('the blank line after frontmatter survives an edit', async ({ page }) => {
  const vault = await createVault();
  await vault.write('note.md', '---\ntitle: Note\n---\n\nBody text.\n');
  await installHost(page, vault);

  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await page.getByRole('treeitem', { name: 'note', exact: true }).click();
  await expect(page.getByRole('article', { name: 'note' })).toBeVisible();

  await caretAtLineEnd(page.getByText('Body text.'));
  await page.keyboard.type(' More.');
  await saveNow(page);
  await expectSaved(page);

  expect(await vault.read('note.md')).toBe('---\ntitle: Note\n---\n\nBody text. More.\n');
});

test('Save now once the autosave has written the edit leaves the note saved', async ({ page }) => {
  // On a slow runner the autosave can land before a test reaches Save now:
  // there is then nothing to save, and the item is disabled, rightly.
  const vault = await openVault(page);
  await page.getByRole('treeitem', { name: 'one', exact: true }).click();
  await caretAtLineEnd(page.getByText('First note.'));
  await page.keyboard.type(' Autosaved.');
  await expectFile(vault, 'one.md').toBe('# One\n\nFirst note. Autosaved.\n');
  await expectSaved(page);

  await saveNow(page);
  await expectSaved(page);
  await expectFile(vault, 'one.md').toBe('# One\n\nFirst note. Autosaved.\n');
});
