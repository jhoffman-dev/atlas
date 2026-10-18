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
  'Right sidebar',
];
const THEMES = ['light', 'dark'] as const;
/** Long enough for the toast's shadow and the menu to finish painting. */
const SETTLE_MS = 300;

const slug = (words: string) => words.toLowerCase().replace(/[^a-z]+/g, '-');

async function shootRow(page: Page, theme: string, title: string): Promise<void> {
  const row = page
    .locator(`.gallery-page__panel[data-theme="${theme}"] .gallery-page__row`)
    .filter({ has: page.getByRole('heading', { level: 2, name: title, exact: true }) });
  await expect(row).toHaveCount(1);
  const path = join(OUT, `gallery-${slug(title)}-${theme}.png`);
  await row.screenshot({ path, animations: 'disabled' });
  console.log(path);
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
  }
});
