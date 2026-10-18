import { expect, test, type Page } from '@playwright/test';
import { createVault, installHost } from './host.ts';

/**
 * The virtualised lists place a row by an estimate until it is measured, and
 * a row measured at its estimate does not place the list again. The estimates
 * are what WebKit draws under the system font (UI v2, #269), pinned here so a
 * font or padding change moves the constant with it:
 *
 *   packages/ui/src/today-page.tsx        GROUP_NAME_HEIGHT
 *   packages/ui/src/inbox/inbox-rows.tsx  ROW_HEIGHT
 */
const GROUP_NAME_HEIGHT = 18;
const INBOX_ROW_HEIGHT = 59;

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
