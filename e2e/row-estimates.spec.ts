import { expect, test, type Page } from '@playwright/test';
import { createVault, installHost, sidebarSection } from './host.ts';

/**
 * The virtualised lists place a row by an estimate until it is measured, and
 * a row measured at its estimate does not place the list again. The estimates
 * are what WebKit draws under the system font (UI v2, #269), pinned here so a
 * font or padding change moves the constant with it:
 *
 *   packages/ui/src/today-page.tsx        GROUP_NAME_HEIGHT, ROW_HEIGHT
 *   packages/ui/src/inbox/inbox-rows.tsx  ROW_HEIGHT
 *   packages/ui/src/grouped-rows.tsx      LINE_HEIGHT (row, group, new)
 *
 * The table's sticky header is pinned with them: a row the arrow keys focus
 * is scrolled clear of it by the sheet's `scroll-padding-top` (#244), which
 * must be the header's height.
 */
const GROUP_NAME_HEIGHT = 18;
/** The table view's row, which Today's rows are since UI v2 slice 13a. */
const TODAY_ROW_HEIGHT = 34;
const INBOX_ROW_HEIGHT = 59;
const TABLE_ROW_HEIGHT = 34;
const TABLE_GROUP_HEIGHT = 32;
const TABLE_NEW_HEIGHT = 30;
const TABLE_HEADER_HEIGHT = 32;

const NOW = new Date(2026, 9, 13, 12, 0, 0);

async function openVault(page: Page) {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('Tasks');
  await vault.mkdir('Inbox');
  await vault.write(
    '.atlas/types/task.md',
    [
      '---',
      'name: task',
      'label: Task',
      'properties:',
      '  status:',
      '    kind: select',
      '    options: [inbox, backlog, next-action, in-progress, waiting, someday, longterm, archive]',
      '    done: archive',
      '  due: date',
      '---',
      '',
    ].join('\n'),
  );
  await vault.write(
    'Tasks/Send the figures.md',
    ['---', 'type: task', 'status: next-action', 'due: 2026-10-13', '---', '', 'A task.', ''].join(
      '\n',
    ),
  );
  // Undated, so Today lists it under Next actions, grouped by project: the
  // group name is that sub-heading.
  await vault.write(
    'Tasks/Call the bank.md',
    ['---', 'type: task', 'status: next-action', '---', '', 'A task.', ''].join('\n'),
  );
  await vault.write('Inbox/Captured.md', 'A captured line.\n');
  await vault.mkdir('.atlas/views');
  await vault.write(
    '.atlas/views/Grouped.md',
    [
      '---',
      'atlas: view',
      'type: task',
      'layout: table',
      'groupBy: status',
      'columns: [status, due]',
      '---',
      '',
      '# Grouped',
      '',
    ].join('\n'),
  );
  await installHost(page, vault);
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
}

test('a Today group name is drawn at the height the list places it by', async ({ page }) => {
  await openVault(page);
  await page.getByRole('list', { name: 'Go to' }).getByRole('button', { name: 'Today' }).click();
  const name = page.locator('.today__group-name').first();
  await expect(name).toBeVisible();
  expect((await name.boundingBox())!.height).toBeCloseTo(GROUP_NAME_HEIGHT, 1);
});

test('a Today row is drawn at the height the list places it by', async ({ page }) => {
  await openVault(page);
  await page.getByRole('list', { name: 'Go to' }).getByRole('button', { name: 'Today' }).click();
  const row = page.locator('.today [data-today-row]').first();
  await expect(row).toBeVisible();
  expect((await row.boundingBox())!.height).toBeCloseTo(TODAY_ROW_HEIGHT, 1);
});

test('a standard Inbox row is drawn at the height the list places it by', async ({ page }) => {
  await openVault(page);
  await page
    .getByRole('list', { name: 'Go to' })
    .getByRole('button', { name: /^Inbox/ })
    .click();
  const row = page.locator('.inbox__row').first();
  await expect(row).toBeVisible();
  expect((await row.boundingBox())!.height).toBeCloseTo(INBOX_ROW_HEIGHT, 1);
});

test('a table’s rows, group rows, "+ New" and sticky header are drawn at the heights the table places them by', async ({
  page,
}) => {
  await openVault(page);
  await sidebarSection(page, 'views').getByRole('button', { name: 'Grouped', exact: true }).click();
  const row = page.locator('.table__row').first();
  await expect(row).toBeVisible();
  const height = async (selector: string) =>
    (await page.locator(selector).first().boundingBox())!.height;
  expect(await height('.table__row')).toBeCloseTo(TABLE_ROW_HEIGHT, 1);
  expect(await height('tr.table__group')).toBeCloseTo(TABLE_GROUP_HEIGHT, 1);
  expect(await height('tr.table__group-new')).toBeCloseTo(TABLE_NEW_HEIGHT, 1);
  expect(await height('.table__grid thead th')).toBeCloseTo(TABLE_HEADER_HEIGHT, 1);

  // The header's bottom edge is where a focused row is scrolled clear to.
  const header = page.locator('.table__grid thead tr').first();
  const headerBottom = (await header.boundingBox())!.height;
  const padding = await page
    .locator('.table__sheet')
    .evaluate((sheet) => parseFloat(getComputedStyle(sheet).scrollPaddingTop));
  expect(padding).toBeGreaterThanOrEqual(headerBottom);
  expect(padding - headerBottom).toBeLessThan(2);
});
