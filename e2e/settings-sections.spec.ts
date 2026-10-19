import { expect, test, type Page } from './fixtures.ts';
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

// Review of 05abaa6a: a row drawn as a block put its icon on one line and its
// title on a second, clipped line (`.icon` is `display: block`); the guard
// that measures a title's right edge could not see it. So each row's icon
// and title are held to one line, side by side.
test('a row draws its icon and its title on one line, side by side', async ({ page }) => {
  await installHost(page, await createVault());
  await page.goto('/');
  await openSettings(page);

  const rows = await list(page)
    .getByRole('button')
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const row = button.getBoundingClientRect();
        const icon = button.querySelector('svg')!.getBoundingClientRect();
        const text = [...button.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)!;
        const range = document.createRange();
        range.selectNodeContents(text);
        const title = range.getBoundingClientRect();
        const centre = (box: DOMRect) => box.top + box.height / 2;
        return {
          title: text.textContent,
          iconOffCentre: Math.abs(centre(icon) - centre(row)),
          titleOffCentre: Math.abs(centre(title) - centre(row)),
          titleAfterIcon: title.left > icon.right,
        };
      }),
    );
  expect(rows.length).toBeGreaterThan(3);
  for (const row of rows) {
    expect(row.iconOffCentre, `${row.title}: icon`).toBeLessThanOrEqual(2);
    expect(row.titleOffCentre, `${row.title}: title`).toBeLessThanOrEqual(2);
    expect(row.titleAfterIcon, `${row.title}: title after icon`).toBe(true);
  }
});
