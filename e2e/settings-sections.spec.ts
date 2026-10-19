import { expect, test, type Page } from '@playwright/test';
import { createVault, installHost } from './host.ts';

/**
 * UI v2 slice 13f (#315): Settings lists its sections on the left, at 28px
 * rows, and each row brings its section into view. The list is written down
 * in `settings-sections.ts` rather than gathered from the sections as they
 * mount (which would cost opening Settings a commit), so this is what holds
 * the list and what the app draws in step — with a vault open and without.
 */

const settings = (page: Page) => page.getByRole('dialog', { name: 'Settings' });
const list = (page: Page) => settings(page).getByRole('navigation', { name: 'Settings sections' });

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(settings(page)).toBeVisible();
}

/** The titles of the sections drawn, in order, as their headings say them. */
const drawn = (page: Page) =>
  settings(page)
    .locator('.settings__body h2.settings__heading')
    .evaluateAll((headings) => headings.map((heading) => heading.textContent));

const listed = (page: Page) =>
  list(page)
    .getByRole('button')
    .evaluateAll((rows) => rows.map((row) => row.textContent));

test('the list names every section drawn, in order, with a vault open', async ({ page }) => {
  const vault = await createVault();
  await vault.write('note.md', '# Note\n\nBody.\n');
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByRole('navigation', { name: 'Vault' })).toBeVisible();
  await openSettings(page);

  const sections = await drawn(page);
  expect(sections.length).toBeGreaterThan(4);
  expect(sections).toContain('Sync');
  expect(await listed(page)).toEqual(sections);
  const heights = await list(page)
    .getByRole('button')
    .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
  for (const height of heights) expect(height).toBeCloseTo(28, 0);
});

test('the list leaves out the sections that want a vault, before one is open', async ({ page }) => {
  await installHost(page, await createVault());
  await page.goto('/');
  await openSettings(page);

  const sections = await drawn(page);
  expect(sections).toContain('Appearance');
  expect(sections).not.toContain('Sync');
  expect(await listed(page)).toEqual(sections);
});

test('a row brings its section into view and hands it the focus', async ({ page }) => {
  const vault = await createVault();
  await vault.write('note.md', '# Note\n\nBody.\n');
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByRole('navigation', { name: 'Vault' })).toBeVisible();
  await openSettings(page);
  const sync = settings(page).getByRole('heading', { name: 'Sync', exact: true });
  await expect(sync).not.toBeInViewport();

  await list(page).getByRole('button', { name: 'Sync', exact: true }).click();

  await expect(sync).toBeInViewport();
  await expect(sync).toBeFocused();
});
