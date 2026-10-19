// `pnpm shots:gallery` — screenshots the primitives gallery, whole and row by
// row, for side-by-side comparison with the components strip of
// design/target/Tokens.dc.html. Not part of `pnpm e2e`: it asserts nothing
// about behaviour.
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const OUT = join(import.meta.dirname, '..', '..', 'design', 'out', 'shots');
/** The rows a slice is judged by, as the gallery titles them. */
const ROWS = [
  'Button',
  'Input and select',
  'Chip',
  'Status pill',
  'Status dot',
  'Menu',
  'Key hints',
  'Toast',
  'Tab strip',
  'Table',
];
const THEMES = ['light', 'dark'] as const;
/** Long enough for the toast's shadow and the menu to finish painting. */
const SETTLE_MS = 300;

const slug = (words: string) => words.toLowerCase().replace(/[^a-z]+/g, '-');

function rowOf(page: Page, theme: string, title: string) {
  return page
    .locator(`.gallery-page__panel[data-theme="${theme}"] .gallery-page__row`)
    .filter({ has: page.getByRole('heading', { level: 2, name: title, exact: true }) });
}

async function shootRow(page: Page, theme: string, title: string): Promise<void> {
  const row = rowOf(page, theme, title);
  await expect(row).toHaveCount(1);
  const path = join(OUT, `gallery-${slug(title)}-${theme}.png`);
  await row.screenshot({ path, animations: 'disabled' });
  console.log(path);
}

/**
 * The table row twice more (#299): with the status picker open on its first
 * row, beside FlowTable.dc.html's, then with a date cell being edited, for
 * the ring. The picker opens under the cell, outside the row's box, so the
 * shot takes the panel from the row's top edge down.
 */
async function shootTableEditing(page: Page, theme: string): Promise<void> {
  const row = rowOf(page, theme, 'Table');
  const box = await row.boundingBox();
  if (box === null) throw new Error('The table row has no box');
  const clip = { x: box.x, y: box.y, width: box.width, height: box.height + 120 };

  await row.getByRole('button', { name: 'Next', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Set Status' });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('combobox')).toBeFocused();
  await page.waitForTimeout(SETTLE_MS);
  const picking = join(OUT, `gallery-table-picker-${theme}.png`);
  await page.screenshot({ path: picking, clip, animations: 'disabled' });
  console.log(picking);
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);

  await row.getByRole('button', { name: '2026-10-21', exact: true }).click();
  await expect(row.locator('.table__input')).toBeFocused();
  const editing = join(OUT, `gallery-table-editing-${theme}.png`);
  await row.screenshot({ path: editing, animations: 'disabled' });
  console.log(editing);
  await page.keyboard.press('Escape');
  await expect(row.locator('.table__input')).toHaveCount(0);
}

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

test('gallery shots', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/gallery.html');
  await expect(page.locator('.gallery-page__panel')).toHaveCount(2);
  await page.waitForTimeout(SETTLE_MS);

  const whole = join(OUT, 'gallery.png');
  await page.screenshot({ path: whole, fullPage: true, animations: 'disabled' });
  console.log(whole);

  for (const theme of THEMES) {
    for (const title of ROWS) await shootRow(page, theme, title);
    await shootTableEditing(page, theme);
  }
});
