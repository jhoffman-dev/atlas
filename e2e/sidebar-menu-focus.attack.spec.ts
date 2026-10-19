import { expect, test, type Page } from './fixtures.ts';
import { createVault, installHost, sidebarSection } from './host.ts';

// Attack on #250 / PR #251: the row menu's keyboard open, in a real WebKit
// where the key's default actions and a real click's `detail` are the browser's.

const focusedRow = (page: Page) => page.locator('[role="treeitem"]:focus');

/** As in sidebar-keyboard.spec.ts: Tab into the tree with no row clicked. */
async function tabToTree(page: Page): Promise<void> {
  await page.locator('.shell__main').click({ position: { x: 2, y: 2 } });
  for (let press = 0; press < 40 && (await focusedRow(page).count()) === 0; press += 1) {
    await page.keyboard.press('Tab');
  }
}

async function openAlphaVault(page: Page) {
  const vault = await createVault();
  await vault.write('alpha.md', '# Alpha\n');
  await vault.write('beta.md', '# Beta\n');
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  const userSpace = sidebarSection(page, 'userSpace');
  await expect(userSpace.getByRole('treeitem', { name: 'alpha', exact: true })).toBeVisible();
  return userSpace;
}

async function tabToAlphaMore(page: Page) {
  await tabToTree(page);
  await expect(focusedRow(page)).toHaveAttribute('aria-label', 'alpha');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const more = page.getByRole('button', { name: 'Options for alpha', exact: true });
  await expect(more).toBeFocused();
  return more;
}

test('Enter held on the "…" opens the menu and runs none of its commands', async ({ page }) => {
  const userSpace = await openAlphaVault(page);
  const rowsBefore = await userSpace.getByRole('treeitem').count();
  expect(rowsBefore).toBe(2);
  await tabToAlphaMore(page);

  await page.evaluate(() => {
    (window as unknown as { repeats: boolean[] }).repeats = [];
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Enter')
          (window as unknown as { repeats: boolean[] }).repeats.push(event.repeat);
      },
      true,
    );
  });
  // The first keydown opens the menu; the focus is on its first item a frame later.
  await page.keyboard.down('Enter');
  const menu = page.getByRole('menu', { name: 'Page' });
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  // The key is still down: the OS sends its repeats, now to the focused item.
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');

  // Only the first keydown was a fresh press; the rest were the key's repeats.
  expect(await page.evaluate(() => (window as unknown as { repeats: boolean[] }).repeats)).toEqual([
    false,
    true,
    true,
  ]);
  // The tree is as it was and the menu still up: no "New note here" ran.
  await expect(userSpace.getByRole('treeitem')).toHaveCount(rowsBefore);
  await expect(menu).toBeVisible();
});

test('a real click on the "…" opens on the menu box, no item focused', async ({ page }) => {
  await openAlphaVault(page);
  const more = await tabToAlphaMore(page);
  await more.click();
  const menu = page.getByRole('menu', { name: 'Page' });
  await expect(menu).toBeFocused();
  await expect(menu.locator('[role="menuitem"]:focus')).toHaveCount(0);
});

test('Shift+F10 on a row opens on the first item, and Escape returns to the row', async ({
  page,
}) => {
  await openAlphaVault(page);
  await tabToTree(page);
  await expect(focusedRow(page)).toHaveAttribute('aria-label', 'alpha');
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Page' });
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(focusedRow(page)).toHaveAttribute('aria-label', 'alpha');
});

test('Tab in a keyboard-opened menu never strands the focus on the page', async ({ page }) => {
  await openAlphaVault(page);
  await tabToAlphaMore(page);
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Page' });
  await expect(menu.getByRole('menuitem').first()).toBeFocused();

  // Each Tab must leave the focus on something a person can see and use: an
  // item of the menu, or, with the menu shut, a control of the page. Not one of
  // Base UI's invisible focus guards, and not <body> under an inert page.
  const stranded = () =>
    page.evaluate(
      () =>
        document.activeElement === null ||
        document.activeElement === document.body ||
        document.activeElement.hasAttribute('data-base-ui-focus-guard'),
    );
  await page.keyboard.press('Tab');
  await expect.poll(stranded).toBe(false);
  await page.keyboard.press('Tab');
  await expect.poll(stranded).toBe(false);
});
