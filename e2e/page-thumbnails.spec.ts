/**
 * U-15: a Thumbnail property any type can have. Added to a type in the type
 * editor, it fronts a gallery of that type with a picture of each note's own
 * page — made by the host (stubbed here, answering with `STUB_THUMBNAIL`) and
 * kept in the cache, never in the vault. Choose image… puts a picture of the
 * person's own in its place, Clear takes it off for good, and a note that
 * changes is pictured again once it rests.
 */
import { readdir } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  createVault,
  expectFile,
  expectSaved,
  installHost,
  saveNow,
  sidebarSection,
  solidPng,
  STUB_THUMBNAIL,
  type FakeHost,
  type FakeVault,
} from './host.ts';

const BOOK_TYPE = ['---', 'name: book', 'label: Book', 'properties:', '  author: text', '---', ''];

const GALLERY = [
  '---',
  'atlas: view',
  'type: book',
  'layout: gallery',
  'columns: [author]',
  'limit: 50',
  '---',
  '',
  '# Books',
  '',
];

const THUMBNAIL_WIDTH = STUB_THUMBNAIL.readUInt32BE(16);
const CHOSEN = solidPng(40, 25, [20, 120, 40]);
const BODY_IMAGE = solidPng(30, 20, [200, 120, 40]);

async function open(page: Page): Promise<{ vault: FakeVault; host: FakeHost }> {
  const vault = await createVault();
  for (const folder of ['.atlas/types', '.atlas/views', '.atlas/templates', 'pictures']) {
    await vault.mkdir(folder);
  }
  await vault.write('.atlas/types/book.md', BOOK_TYPE.join('\n'));
  await vault.write('.atlas/views/Books.md', GALLERY.join('\n'));
  const { writeFile } = await import('node:fs/promises');
  await writeFile(`${vault.root}/pictures/sand.png`, BODY_IMAGE);
  await vault.write(
    'Dune.md',
    '---\ntype: book\nauthor: Herbert\n---\n\n# Dune\n\nA desert planet.\n\n<script>alert(1)</script>\n',
  );
  await vault.write(
    'Emma.md',
    '---\ntype: book\nauthor: Austen\n---\n\n# Emma\n\nHandsome, clever and rich.\n\n![sand](pictures/sand.png)\n',
  );
  const host = await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return { vault, host };
}

/** Resolves to an image's natural width once it has loaded: 0 while it is broken. */
const naturalWidth = (image: Locator) =>
  image.evaluate((element) => (element as HTMLImageElement).naturalWidth);

const thumbnailRow = (page: Page) =>
  page.getByRole('region', { name: 'Properties' }).locator('.thumbnail-value');

const card = (page: Page, title: string) =>
  page.getByRole('list', { name: 'Notes' }).getByRole('listitem').filter({ hasText: title });

async function openBooks(page: Page) {
  await sidebarSection(page, 'views').getByRole('button', { name: 'Books', exact: true }).click();
  await expect(card(page, 'Dune')).toBeVisible();
}

async function addThumbnailToBook(page: Page, vault: FakeVault) {
  await sidebarSection(page, 'types')
    .getByRole('button', { name: /^Book, / })
    .click();
  // Book has a view, so the type opens on it; the type itself is a press away.
  await page.getByRole('button', { name: 'Edit Book type' }).click();
  await page.getByRole('button', { name: 'Add property' }).click();
  const name = page.getByRole('textbox', { name: 'Name of Property' });
  await name.fill('Thumbnail');
  await name.press('Enter');
  const key = page.getByRole('textbox', { name: 'Key of Thumbnail' });
  await key.fill('thumbnail');
  await key.press('Enter');
  await page.getByRole('combobox', { name: 'Kind of Thumbnail' }).selectOption('thumbnail');
  await expectFile(vault, '.atlas/types/book.md').toMatch(/ {2}thumbnail: thumbnail\n---/);
}

/** The cached pictures, by name: kept under `.atlas-cache`, never beside the notes. */
/** The pictures in the cache — each kept beside the record of which version of its note it is of. */
async function cached(vault: FakeVault): Promise<string[]> {
  const names = await readdir(`${vault.root}/.atlas-cache/thumbnails`).catch(() => []);
  return names.filter((name) => name.endsWith('.png'));
}

test('a Thumbnail added to a type fronts its gallery with pictures of each page, kept in the cache', async ({
  page,
}) => {
  const { vault, host } = await open(page);

  // Before: a card is fronted by the first image in its body, or by nothing.
  await openBooks(page);
  await expect.poll(() => naturalWidth(card(page, 'Emma').locator('img.card-cover'))).toBe(30);
  await expect(card(page, 'Dune').locator('img.card-cover')).toHaveCount(0);
  expect(host.snapshots.pages()).toEqual([]);

  await addThumbnailToBook(page, vault);
  await openBooks(page);

  for (const title of ['Dune', 'Emma']) {
    const cover = card(page, title).locator('img.card-cover');
    await expect.poll(() => naturalWidth(cover)).toBe(THUMBNAIL_WIDTH);
  }
  await expect.poll(async () => (await cached(vault)).length).toBe(2);
  // The notes themselves are not written: the pictures are derived.
  expect(await vault.read('Dune.md')).not.toContain('thumbnail');

  const pages = host.snapshots.pages();
  expect(pages).toHaveLength(2);
  const dune = pages.find((html) => html.includes('<title>Dune</title>')) ?? '';
  const emma = pages.find((html) => html.includes('<title>Emma</title>')) ?? '';
  // The page as it reads: its title, its words, its images written in.
  expect(dune).toContain('A desert planet.');
  expect(emma).toContain('Handsome, clever and rich.');
  expect(emma).toMatch(/<img src="data:image\/png;base64,[^"]+"/);
  // The policy is the first thing the parser meets; nothing runs, nothing is fetched.
  expect(dune.indexOf('Content-Security-Policy')).toBeGreaterThan(-1);
  expect(dune.indexOf('Content-Security-Policy')).toBeLessThan(dune.indexOf('<style'));
  expect(dune).toContain("script-src 'none'");
  expect(dune).toContain("connect-src 'none'");
  // Raw HTML in the note is shown as its source, as the editor shows it — never run.
  expect(dune).not.toMatch(/<script/i);
  expect(dune).toContain('&lt;script&gt;');
});

test('Choose image… sets a picture from the vault, and Clear takes it off for good', async ({
  page,
}) => {
  const { vault, host } = await open(page);
  await addThumbnailToBook(page, vault);
  await openBooks(page);
  await expect.poll(() => host.snapshots.pages().length).toBe(2);

  await card(page, 'Dune').getByRole('button', { name: 'Dune' }).click();
  const row = thumbnailRow(page);
  await expect.poll(() => naturalWidth(row.getByRole('img'))).toBe(THUMBNAIL_WIDTH);

  await row.getByLabel('Choose a thumbnail image').setInputFiles({
    name: 'my cover.png',
    mimeType: 'image/png',
    buffer: CHOSEN,
  });
  await expect.poll(() => vault.read('Dune.md')).toMatch(/^thumbnail: \/attachments\/.+\.png$/m);
  await expect.poll(() => naturalWidth(row.getByRole('img'))).toBe(40);

  await openBooks(page);
  await expect.poll(() => naturalWidth(card(page, 'Dune').locator('img.card-cover'))).toBe(40);

  await card(page, 'Dune').getByRole('button', { name: 'Dune' }).click();
  await thumbnailRow(page).getByRole('button', { name: 'Clear' }).click();
  await expect.poll(() => vault.read('Dune.md')).toContain('thumbnail: false');
  await expect(thumbnailRow(page).getByText('None', { exact: true })).toBeVisible();
  await expect(thumbnailRow(page).getByRole('button', { name: 'Clear' })).toHaveCount(0);

  // Cleared stays cleared: an edit to the note makes no picture of it. Emma,
  // edited after it, is the clock — once Emma is pictured again, Dune would
  // have been too.
  const duneBefore = pagesOf(host, 'Dune').length;
  await editBody(page, 'A desert planet.', ' Spice.');
  await openBooks(page);
  await card(page, 'Emma').getByRole('button', { name: 'Emma' }).click();
  await editBody(page, 'Handsome, clever and rich.', ' Witty.');
  await openBooks(page);
  await expect
    .poll(() => pagesOf(host, 'Emma').filter((html) => html.includes('Witty.')), {
      timeout: 20_000,
    })
    .toHaveLength(1);
  expect(pagesOf(host, 'Dune')).toHaveLength(duneBefore);
  await expect(card(page, 'Dune').locator('img.card-cover')).toHaveCount(0);
  expect(await vault.read('Dune.md')).toMatch(/thumbnail: false[\s\S]*Spice\./);
});

const pagesOf = (host: FakeHost, title: string) =>
  host.snapshots.pages().filter((html) => html.includes(`<title>${title}</title>`));

async function editBody(page: Page, text: string, added: string) {
  await page.getByText(text).click();
  await page.keyboard.press('End');
  await page.keyboard.type(added);
  await saveNow(page);
  await expectSaved(page);
}

test('a note that changes is pictured again once it rests', async ({ page }) => {
  const { vault, host } = await open(page);
  await addThumbnailToBook(page, vault);
  await openBooks(page);
  await expect.poll(() => host.snapshots.pages().length).toBe(2);

  await card(page, 'Emma').getByRole('button', { name: 'Emma' }).click();
  await editBody(page, 'Handsome, clever and rich.', ' With a happy disposition.');

  await expect
    .poll(() => host.snapshots.pages().filter((html) => html.includes('happy disposition')), {
      timeout: 20_000,
    })
    .toHaveLength(1);
  // Still two pictures in the cache: the same note's picture is replaced.
  expect(await cached(vault)).toHaveLength(2);
});
