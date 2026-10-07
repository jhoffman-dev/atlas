import { expect, test, type Page } from '@playwright/test';
import { createVault, expectSaved, installHost, saveNow } from './host.ts';

const NOTE = [
  '# Today',
  '',
  'A link to [[Another Note]] and some text.',
  '',
  '> [!warning] Be careful',
  '> This is a callout.',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  '```ts',
  'const answer = 42;',
  '```',
  '',
].join('\n');

async function openVaultWith(page: Page) {
  const vault = await createVault();
  await vault.write('today.md', NOTE);
  await vault.write('Another Note.md', '# Another Note\n\nLinked from today.\n');
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  return vault;
}

test('a wiki link opens the note it names', async ({ page }) => {
  await openVaultWith(page);
  await page.getByRole('treeitem', { name: 'today', exact: true }).click();

  await page.getByRole('link', { name: 'Another Note' }).click();
  await expect(page.getByRole('article', { name: 'Another Note' })).toBeVisible();
  await expect(page.getByText('Linked from today.')).toBeVisible();
});

test('links, collapsed at the foot of a note, list the notes pointing here and from here', async ({
  page,
}) => {
  await openVaultWith(page);
  await page.getByRole('treeitem', { name: 'Another Note', exact: true }).click();

  const panel = page.getByRole('region', { name: 'Links', exact: true });
  const toggle = panel.getByRole('button', { name: /^Links/ });
  await expect(toggle).toContainText('1 linked here · 0 linked from here');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const here = panel.getByRole('region', { name: 'Links here' });
  await expect(here).toHaveCount(0);
  await toggle.click();
  await expect(here.getByRole('button', { name: /today/i })).toBeVisible();

  // And it goes the other way: the linking note lists the note it links to.
  await page.getByRole('treeitem', { name: 'today', exact: true }).click();
  await expect(page.getByRole('article', { name: 'today' })).toBeVisible();
  await expect(toggle).toContainText('0 linked here · 1 linked from here');
});

test('a callout renders with its kind and title', async ({ page }) => {
  await openVaultWith(page);
  await page.getByRole('treeitem', { name: 'today', exact: true }).click();

  const callout = page.locator('.callout[data-callout="warning"]');
  await expect(callout).toBeVisible();
  await expect(callout.locator('.callout__title')).toHaveText('Be careful');
  await expect(callout).toContainText('This is a callout.');
});

test('a table is a real table, not a block of source', async ({ page }) => {
  await openVaultWith(page);
  await page.getByRole('treeitem', { name: 'today', exact: true }).click();

  await expect(page.locator('.editor table')).toBeVisible();
  await expect(page.locator('.editor th').first()).toHaveText('a');
  await expect(page.locator('.raw-block')).toHaveCount(0);
});

test('code is highlighted', async ({ page }) => {
  await openVaultWith(page);
  await page.getByRole('treeitem', { name: 'today', exact: true }).click();

  await expect(page.locator('.editor pre code .hljs-keyword').first()).toBeVisible();
});

test('typing [[ offers notes and inserts a link', async ({ page }) => {
  const vault = await openVaultWith(page);
  await page.getByRole('treeitem', { name: 'today', exact: true }).click();

  await page.getByText('A link to').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' [[Anot');

  const popup = page.getByRole('listbox', { name: 'Link to note' });
  await expect(popup).toBeVisible();
  const option = popup.getByRole('option', { name: /Another Note/ });
  await expect(option).toBeVisible();
  // The hint says where the note lives, as the search palette does, not its filename.
  await expect(option).toContainText('Pages');
  await expect(option).not.toContainText('.md');

  await page.keyboard.press('Enter');
  await saveNow(page);
  await expectSaved(page);

  // The fixture already links Another Note, so the check is on the one typed.
  expect(await vault.read('today.md')).toContain('and some text. [[Another Note]]');
});

test('typing / offers blocks to insert', async ({ page }) => {
  await openVaultWith(page);
  await page.getByRole('treeitem', { name: 'today', exact: true }).click();

  await page.getByText('A link to').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/quote');

  const popup = page.getByRole('listbox', { name: 'Insert block' });
  await expect(popup).toBeVisible();
  await expect(popup.getByRole('option', { name: /Quote/ })).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(page.locator('.editor blockquote')).toBeVisible();
});

test('editing leaves the table and callout byte-identical', async ({ page }) => {
  const vault = await openVaultWith(page);
  await page.getByRole('treeitem', { name: 'today', exact: true }).click();

  await page.getByText('A link to').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Edited.');
  await saveNow(page);
  await expectSaved(page);

  const saved = await vault.read('today.md');
  expect(saved).toContain('| a | b |\n| - | - |\n| 1 | 2 |');
  expect(saved).toContain('> [!warning] Be careful\n> This is a callout.');
  expect(saved).toContain('```ts\nconst answer = 42;\n```');
  expect(saved).toContain('A link to [[Another Note]] and some text. Edited.');
});
