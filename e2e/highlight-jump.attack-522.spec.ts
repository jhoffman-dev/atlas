import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from './fixtures.ts';
import { createVault, installHost, sidebarSection } from './host.ts';
import { lanternFixturePdf } from '../tools/pdf/fixture-pdf.ts';

/*
 * Attack on PR #522 (#506), end to end in WebKit: the chip from the keyboard,
 * a literature note whose `file:` is no PDF, `[[name.pdf]]` when two
 * literature notes' PDFs share the name, and an aliased link to a highlight
 * in a list item. (A table is still a raw block, so its links are not live:
 * not this PR's.)
 */

const PDF = 'Library/the-lantern-keepers.pdf';

const marker = (anchor: Record<string, unknown>) =>
  `<!-- atlas:highlight ${JSON.stringify({ v: 1, mark: 'highlight', color: 'yellow', ...anchor })} -->`;

const highlight = (id: string, quote: string) =>
  `> ${quote}\n> ${marker({
    kind: 'pdf',
    page: 3,
    exact: quote,
    prefix: 'Chapter Three. ',
    suffix: ' in the year',
    rects: [[0.2, 0.1, 0.3, 0.02]],
  })}\n\n^${id}\n`;

const literature = (title: string, file: string, id: string) =>
  `---\ntype: literature\nkind: pdf\ntitle: "${title}"\nfile: "[[${file}]]"\n---\n` +
  highlight(id, 'The last lamp was lit');

const READING =
  '# Reading notes\n\n![[The Lantern Keepers#^lamp03]]\n\n![[Lantern Summary Source#^sum001]]\n\n' +
  '- In a list: [[The Lantern Keepers#^lamp03|the last lamp]]\n\n' +
  'Shared name: [[reading.pdf]]\n';

async function openVault(page: Page) {
  const vault = await createVault();
  const files: Record<string, string | Buffer> = {
    [PDF]: lanternFixturePdf(),
    'Courses/Spring/reading.pdf': lanternFixturePdf(),
    'Courses/Autumn/reading.pdf': lanternFixturePdf(),
    'Library/The Lantern Keepers.md': literature('The Lantern Keepers', PDF, 'lamp03'),
    // kind: pdf, but the file: it names is a Markdown note.
    'Library/Lantern Summary Source.md': literature(
      'Lantern Summary Source',
      'Library/Lantern summary.md',
      'sum001',
    ),
    'Library/Lantern summary.md': '# Lantern summary\n\nA fictional summary.\n',
    'Courses/Spring Reading.md': literature(
      'Spring Reading',
      'Courses/Spring/reading.pdf',
      'spr001',
    ),
    'Courses/Autumn Reading.md': literature(
      'Autumn Reading',
      'Courses/Autumn/reading.pdf',
      'aut001',
    ),
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

const reader = (page: Page) => page.locator('.pdf-reader');
const pageOf = (page: Page, number: number) => page.locator(`[data-pdf-page="${number}"]`);

test('the chip, reached with the keyboard, opens the reader on Enter', async ({ page }) => {
  await openVault(page);
  const lamp = page.getByRole('link', { name: 'Open The Lantern Keepers, p. 3 in the reader' });
  await expect(lamp).toBeVisible();
  await lamp.focus();
  await expect(lamp).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(reader(page)).toBeVisible();
});

test('a PDF literature note whose file: is a Markdown note opens its note at the highlight', async ({
  page,
}) => {
  await openVault(page);
  const chip = page.getByRole('link', { name: /^Open Lantern Summary Source, p\. 3/ });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.getByRole('article', { name: 'Lantern Summary Source' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('[[reading.pdf]], a name two literature notes’ PDFs share, opens one of them', async ({
  page,
}) => {
  await openVault(page);
  await page.locator('.editor [data-wikilink="reading.pdf"]').click();
  await expect(reader(page)).toBeVisible();
  await expect(page.getByText('4 pages')).toBeVisible();
});

test('an aliased link to a highlight in a list item opens the reader at it', async ({ page }) => {
  await openVault(page);
  const note = page.getByRole('article', { name: 'Reading notes' });
  await note.locator('.editor li [data-wikilink="The Lantern Keepers"]').click();
  await expect(pageOf(page, 3).locator('.pdf-mark')).toBeInViewport();
});
