import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from './fixtures.ts';
import { createVault, installHost, sidebarSection } from './host.ts';
import { lanternFixturePdf } from '../tools/pdf/fixture-pdf.ts';

/*
 * Verification (#506, PR #522 after 54f53fc3): "Open in PDF" followed from
 * the keyboard with a modifier opens where it is asked and leaves the note
 * as it was. Found red: with the highlight's block selected (as it is when
 * the note opens on it), ⌘↩ and ⇧↩ reach the editor's hard-break keys,
 * which replace the block, and the note is saved without its highlight.
 */

const PDF = 'Library/the-lantern-keepers.pdf';

const marker = (anchor: Record<string, unknown>) =>
  `<!-- atlas:highlight ${JSON.stringify({ v: 1, mark: 'highlight', color: 'yellow', ...anchor })} -->`;

const LITERATURE =
  `---\ntype: literature\nkind: pdf\ntitle: "The Lantern Keepers"\nfile: "[[${PDF}]]"\n---\n` +
  `> The last lamp was lit\n> ${marker({
    kind: 'pdf',
    page: 3,
    exact: 'The last lamp was lit',
    prefix: 'Chapter Three. ',
    suffix: ' in the year',
    rects: [[0.2, 0.1, 0.3, 0.02]],
  })}\n\n^lamp03\n`;

const READING = '# Reading notes\n\n![[The Lantern Keepers#^lamp03]]\n';

async function openVault(page: Page) {
  const vault = await createVault();
  const files: Record<string, string | Buffer> = {
    [PDF]: lanternFixturePdf(),
    'Library/The Lantern Keepers.md': LITERATURE,
    'Reading notes.md': READING,
  };
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(join(vault.root, path, '..'), { recursive: true });
    await writeFile(join(vault.root, path), contents);
  }
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await sidebarSection(page, 'userSpace')
    .getByRole('treeitem', { name: 'Reading notes', exact: true })
    .click();
  await expect(page.getByRole('article', { name: 'Reading notes' })).toBeVisible();
}

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Pane 1 tabs' }).getByRole('tab');
async function openLiteratureNote(page: Page) {
  await openVault(page);
  await sidebarSection(page, 'userSpace').getByRole('treeitem', { name: 'Library' }).click();
  await sidebarSection(page, 'userSpace')
    .getByRole('treeitem', { name: 'The Lantern Keepers', exact: true })
    .click();
  const offer = page.getByRole('link', { name: 'Open in PDF' });
  await expect(offer).toBeVisible();
  return { note: page.getByRole('article', { name: 'The Lantern Keepers' }), offer };
}

// The note opens with its highlight block selected, as a note whose first block is one does.
for (const keys of ['Meta+Enter', 'Shift+Enter']) {
  test(`${keys} on "Open in PDF" leaves the highlight in its note`, async ({ page }) => {
    const { note, offer } = await openLiteratureNote(page);
    await offer.focus();
    await page.keyboard.press(keys);
    await expect(note.getByText('The last lamp was lit', { exact: false })).toHaveCount(1);
  });
}

test('Meta+Enter on "Open in PDF" opens the reader in a new tab', async ({ page }) => {
  const { offer } = await openLiteratureNote(page);
  await offer.focus();
  await page.keyboard.press('Meta+Enter');
  await expect(tabs(page)).toHaveCount(2);
  await expect(page.locator('.pdf-reader')).toBeVisible();
});
