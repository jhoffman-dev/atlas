import { expect, test, type Page } from '@playwright/test';
import {
  createVault,
  expectFile,
  expectSaved,
  installHost,
  sidebarSection,
  type FakeVault,
  saveNow,
} from './host.ts';

const SOURCE = [
  '---',
  'atlas: source',
  // A source note lives in `.atlas`, which user space no longer lists, so it is
  // reached the way a person reaches one now: starred, from Favorites.
  'favorite: true',
  'format: csv',
  'file: feeds/people.csv',
  'into: People',
  'type: person',
  'key: id',
  'name: name',
  'body: note',
  'map:',
  '  role: role',
  '---',
  '',
  'The team, from a CSV someone else maintains.',
  '',
].join('\n');

const FETCHED_SOURCE = [
  '---',
  'atlas: source',
  'favorite: true',
  'format: csv',
  'url: https://example.test/people.csv',
  'into: People',
  'type: person',
  'key: id',
  'name: name',
  '---',
  '',
].join('\n');

/** The second source note in the vault, for the tests that fetch. */
const FETCHED_NOTE = 'Fetched.md';

const people = (rows: string): string => `id,name,role,note\n${rows}`;

const TWO_PEOPLE = people('1,Ada,engineer,Writes the notes\n2,Grace,admiral,Compiles things\n');

async function openSource(page: Page, feeds: Record<string, string> = {}): Promise<FakeVault> {
  const vault = await createVault();
  await vault.mkdir('.atlas/sources');
  await vault.mkdir('feeds');
  // The folder a source writes into has to exist: creating a note never makes
  // one, because that is the guard that stops a path escaping the vault.
  await vault.mkdir('People');
  await vault.write('.atlas/sources/People.md', SOURCE);
  await vault.write(`.atlas/sources/${FETCHED_NOTE}`, FETCHED_SOURCE);
  await vault.write('feeds/people.csv', TWO_PEOPLE);

  await installHost(page, vault, feeds);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();

  await starred(page, 'People').click();
  await expect(panel(page)).toBeVisible();
  return vault;
}

const panel = (page: Page) => page.getByLabel('Source');

/** Rows are named by the file they show, so the folder People and the note
 *  People.md are told apart by an exact name rather than by position. */
const treeItem = (page: Page, name: string) => page.getByRole('treeitem', { name, exact: true });

/** A favourite, by its name without the extension — which is how it is shown. */
const starred = (page: Page, name: string) =>
  sidebarSection(page, 'favorites').getByRole('button', { name, exact: true });

const refresh = async (page: Page) => {
  // Exact, or it also names the busy button, which reads Refreshing….
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
};

test('a source says where it reads from and where its notes land', async ({ page }) => {
  await openSource(page);
  await expect(panel(page).getByText('feeds/people.csv')).toBeVisible();
  await expect(panel(page).getByText('CSV', { exact: true })).toBeVisible();
  await expect(panel(page).getByRole('definition').filter({ hasText: 'as person' })).toBeVisible();
  await expect(page.getByText('Not refreshed yet.')).toBeVisible();
});

test('a source shows its card, not its raw frontmatter, until asked for it', async ({ page }) => {
  await openSource(page);
  await expect(panel(page)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Properties' })).toHaveCount(0);

  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: /^Page properties/ }).click();
  await expect(page.getByRole('region', { name: 'Properties' })).toBeVisible();
});

test('subscribing to a file in the vault turns its records into notes', async ({ page }) => {
  const vault = await openSource(page);

  await refresh(page);

  await expect(page.getByLabel('2 created')).toBeVisible();
  await expectFile(vault, 'People/1.md').toContain('title: Ada');
  await expectFile(vault, 'People/2.md').toContain('title: Grace');
  // The notes are ordinary notes: they show up in the tree like anything else.
  await treeItem(page, 'People').click();
  await expect(treeItem(page, '1')).toBeVisible();
});

test('refreshing after the file changes rewrites the notes it owns', async ({ page }) => {
  const vault = await openSource(page);
  await refresh(page);
  await expect(page.getByLabel('2 created')).toBeVisible();

  await vault.write('feeds/people.csv', people('1,Ada,director,Runs the place\n'));
  await refresh(page);

  await expect(page.getByLabel('1 refreshed')).toBeVisible();
  await expectFile(vault, 'People/1.md').toContain('role: director');
  await expectFile(vault, 'People/1.md').toContain('Runs the place');
});

test('a note whose body you edited keeps your text while its properties refresh', async ({
  page,
}) => {
  const vault = await openSource(page);
  await refresh(page);
  await expect(page.getByLabel('2 created')).toBeVisible();

  await treeItem(page, 'People').click();
  await treeItem(page, '1').click();
  await page.getByText('Writes the notes').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' — and I added this.');
  await saveNow(page);
  await expectSaved(page);

  await vault.write('feeds/people.csv', people('1,Ada,director,Writes the notes\n'));
  await starred(page, 'People').click();
  await expect(panel(page)).toBeVisible();
  await refresh(page);

  await expect(page.getByLabel('1 kept your text')).toBeVisible();
  await expectFile(vault, 'People/1.md').toContain('and I added this.');
  await expectFile(vault, 'People/1.md').toContain('role: director');
});

test('a record that vanishes from the feed is marked, not deleted', async ({ page }) => {
  const vault = await openSource(page);
  await refresh(page);
  await expect(page.getByLabel('2 created')).toBeVisible();

  await vault.write('feeds/people.csv', people('1,Ada,engineer,Writes the notes\n'));
  await refresh(page);

  await expect(page.getByLabel('1 no longer in the feed')).toBeVisible();
  await expect(page.getByText(/marked, never deleted/)).toBeVisible();
  await expectFile(vault, 'People/2.md').toContain('atlas_source_missing: true');
  await expectFile(vault, 'People/2.md').toContain('title: Grace');
});

test('a record that comes back loses the mark again', async ({ page }) => {
  const vault = await openSource(page);
  await refresh(page);
  // Waited for before the feed changes: the click only starts the refresh, and
  // one that reads the feed after the write below never creates Grace at all.
  await expect(page.getByLabel('2 created')).toBeVisible();
  await vault.write('feeds/people.csv', people('1,Ada,engineer,Writes the notes\n'));
  await refresh(page);
  await expectFile(vault, 'People/2.md').toContain('atlas_source_missing: true');

  await vault.write('feeds/people.csv', TWO_PEOPLE);
  await refresh(page);

  await expect(page.getByLabel('2 refreshed')).toBeVisible();
  await expectFile(vault, 'People/2.md').not.toContain('atlas_source_missing');
  await expectFile(vault, 'People/2.md').toContain('title: Grace');
});

test('a source that fetches reads what the feed answers', async ({ page }) => {
  const vault = await openSource(page, { 'https://example.test/people.csv': TWO_PEOPLE });

  await starred(page, 'Fetched').click();
  await expect(panel(page).getByText('https://example.test/people.csv')).toBeVisible();
  await refresh(page);

  await expect(page.getByLabel('2 created')).toBeVisible();
  await expectFile(vault, 'People/1.md').toContain('title: Ada');
});

test('a feed that is not there is reported on the source rather than swallowed', async ({
  page,
}) => {
  await openSource(page);

  await starred(page, 'Fetched').click();
  await expect(panel(page).getByText('https://example.test/people.csv')).toBeVisible();
  await refresh(page);

  await expect(page.getByRole('alert').filter({ hasText: '404' })).toBeVisible();
});
