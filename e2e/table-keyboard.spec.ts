/**
 * A long table is virtualised (#238): only the rows near the window are in
 * the page, and the rest are still reached — by scrolling, and from the
 * keyboard, where Up, Down, Home and End move between rows' names and a row
 * not yet drawn is scrolled into the page first.
 */
import { expect, test, type Page } from '@playwright/test';
import { createVault, installHost, sidebarSection } from './host.ts';

const TASKS = 150;

const TASK_TYPE = ['---', 'name: task', 'label: Task', '---', ''].join('\n');

const title = (at: number) => `Errand ${String(at).padStart(3, '0')}`;

async function openTaskTable(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  await vault.mkdir('Errands');
  for (let at = 1; at <= TASKS; at += 1) {
    await vault.write(
      `Errands/${title(at)}.md`,
      ['---', 'type: task', '---', '', `# ${title(at)}`, ''].join('\n'),
    );
  }
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  await sidebarSection(page, 'types')
    .getByRole('button', { name: /^Task, \d+ notes?$/ })
    .click();
  await expect(page.locator('.table__count', { hasText: `${TASKS} tasks` })).toBeVisible();
}

test('a long table draws a screenful, and the keyboard reaches its last row and back', async ({
  page,
}) => {
  await openTaskTable(page);
  const rows = page.locator('.table__row');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeLessThan(TASKS);

  const names = page.locator('.table__row .table__link');
  const first = (await names.first().textContent()) ?? '';
  await names.first().focus();

  await page.keyboard.press('End');
  const last = page.locator(`.table__row[data-index="${TASKS - 1}"] .table__link`);
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport();

  await page.keyboard.press('ArrowUp');
  await expect(page.locator(`.table__row[data-index="${TASKS - 2}"] .table__link`)).toBeFocused();

  await page.keyboard.press('Home');
  const top = page.locator('.table__row[data-index="0"] .table__link');
  await expect(top).toBeFocused();
  await expect(top).toHaveText(first);
});

test('a long table scrolls to its last row, which is then drawn', async ({ page }) => {
  await openTaskTable(page);
  const sheet = page.locator('.table__sheet');
  await expect(page.locator(`.table__row[data-index="${TASKS - 1}"]`)).toHaveCount(0);
  await sheet.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.locator(`.table__row[data-index="${TASKS - 1}"]`)).toBeInViewport();
});
