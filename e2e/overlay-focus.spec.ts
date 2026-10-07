// The behaviours ADR-0015 adopted Base UI for, driven in a real engine: focus
// going in and coming back, Tab staying inside, and the page behind an open
// overlay being out of reach. jsdom can judge none of them — it has no layout,
// its tab order ignores what a browser would skip, and it has no hit testing —
// so they are asserted here rather than in the component tests.
import { expect, test, type Page } from '@playwright/test';
import { createVault, installHost } from './host.ts';

async function openVault(page: Page) {
  const vault = await createVault();
  await vault.write('recipes.md', '# Recipes\n\nSourdough needs a long cold proof.\n');
  await vault.mkdir('.atlas/templates');
  await vault.write('.atlas/templates/Person.md', '# Person\n');
  await installHost(page, vault);

  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

async function openSearch(page: Page) {
  await page.keyboard.down('Meta');
  await page.keyboard.press('k');
  await page.keyboard.up('Meta');
  await expect(page.getByRole('dialog', { name: 'Search notes' })).toBeVisible();
}

/**
 * Waits for focus to land where it should, rather than reading it once.
 *
 * Base UI moves focus a frame after the event that caused it, so a single read
 * races the restore — which passed alone and failed about one run in three
 * under parallel workers. A flaky test is a bug, so this waits for the
 * condition instead of assuming a frame has gone by.
 */
async function expectFocus(page: Page, selector: string): Promise<void> {
  await expect.poll(() => focused(page)).toBe(selector);
}

/** What the browser says has focus, as a tag and class we can compare. */
function focused(page: Page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (active === null) return 'none';
    return `${active.tagName.toLowerCase()}.${String(active.className) || '(no class)'}`;
  });
}

test('the search palette hands focus back to what opened it', async ({ page }) => {
  await openVault(page);

  const row = page.getByRole('treeitem', { name: 'recipes', exact: true });
  await row.click();
  await expect(page.getByRole('article', { name: 'recipes' })).toBeVisible();
  // Guard the guard: if the click left focus on the body, the assertion at the
  // end would pass without the palette restoring anything.
  await expect(row).toBeFocused();
  // The element itself, not its tag and classes: focus handed to another row
  // that happens to share them is not focus handed back.
  const opener = await page.evaluateHandle(() => document.activeElement);

  await openSearch(page);
  await expectFocus(page, 'input.palette__input');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Search notes' })).toHaveCount(0);
  await expect
    .poll(() => opener.evaluate((element) => element === document.activeElement))
    .toBe(true);
});

test('Tab cannot walk out of the search palette', async ({ page }) => {
  await openVault(page);
  await page.getByRole('treeitem', { name: 'recipes', exact: true }).click();
  await openSearch(page);

  await page.getByRole('searchbox', { name: 'Search the vault' }).fill('sourdough');
  await expect(page.getByRole('option', { name: /Recipes/ })).toBeVisible();

  // Tab may land on a focus guard for a frame; what matters is where it comes
  // to rest, so each press is given the frame the bounce needs.
  const insidePalette = () =>
    page.evaluate(() => document.activeElement?.closest('.palette') !== null);

  for (let press = 0; press < 5; press += 1) {
    await page.keyboard.press('Tab');
    await expect
      .poll(insidePalette, { message: `focus left the palette after ${press + 1} tabs` })
      .toBe(true);
  }
});

test('the page behind the search palette is out of reach', async ({ page }) => {
  await openVault(page);
  const row = page.getByRole('treeitem', { name: 'recipes', exact: true });
  const box = await row.boundingBox();
  if (box === null) throw new Error('the note row was not on screen');
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await expect(row).toBeVisible();
  // A press that reaches the row selects it in the same render as the click:
  // opening a note writes the pane layout synchronously, and selection is read
  // from it. The note's article only follows an async read, so its absence
  // straight after a press proves nothing — selection is what is asserted.
  await expect(row).toHaveAttribute('aria-selected', 'false');
  await openSearch(page);

  // Out of reach for a screen reader too: while the palette is open the rest
  // of the app is hidden from the accessibility tree, so nothing behind the
  // scrim can be found by its role.
  await expect(page.getByRole('treeitem')).toHaveCount(0);

  // A raw press at the row's own coordinates, so nothing skips the scrim on
  // the test's behalf. It dismisses the palette instead of reaching the note.
  await page.mouse.click(centre.x, centre.y);
  await expect(page.getByRole('dialog', { name: 'Search notes' })).toHaveCount(0);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('aria-selected', 'false');

  // The same press with nothing over it does open the note: the assertion above
  // is about the palette, not about coordinates that never worked.
  await page.mouse.click(centre.x, centre.y);
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('article', { name: 'recipes' })).toBeVisible();
});

test('the new-note menu is usable from the keyboard alone', async ({ page }) => {
  await openVault(page);

  const button = page.getByRole('button', { name: 'New note' });
  await button.click();
  await expect(page.getByRole('menuitem', { name: 'Blank note' })).toBeVisible();

  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Blank note' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: "Today's note" })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(button).toBeFocused();
});
