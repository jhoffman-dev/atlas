import { expect, test, type Locator, type Page } from '../../e2e/fixtures.ts';

/**
 * Attack on PR #417 (slice 6a), in a real engine: the peek's focus when what
 * held it is replaced by a step, and the preview card when the note scrolls
 * under it or the window is the app's smallest.
 */
const ROWS = [
  'Phase 16 — The look, rebuilt',
  'Book the hall for the autumn fête',
  'Leftovers from A15-02: templates in views',
  'Water the garden',
];

function title(index: number): string {
  const row = ROWS[index];
  if (row === undefined) throw new Error(`The gallery has no row ${index}`);
  return row;
}

function peekRow(page: Page): Locator {
  return page
    .locator('.gallery-page__panel[data-theme="light"] .gallery-page__row')
    .filter({ has: page.getByRole('heading', { level: 2, name: 'Peek', exact: true }) });
}

/** Opens a row's peek from the keyboard, as a focused table row is opened. */
async function openPeek(page: Page, row: number): Promise<Locator> {
  await peekRow(page)
    .getByRole('button', { name: title(row), exact: true })
    .focus();
  await page.keyboard.press('Enter');
  const peek = page.getByRole('dialog', { name: title(row) });
  await expect(peek).toBeVisible();
  return peek;
}

test.describe('the peek keeps its keys across steps', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/gallery.html');
    await expect(page.locator('.gallery-page__panel')).toHaveCount(2);
  });

  test('steps twice on ⌥↓ ⌥↓ from the text, though the first step replaced the text', async ({
    page,
  }) => {
    const peek = await openPeek(page, 0);
    await peek.locator('.ProseMirror').click();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(page.getByRole('dialog', { name: title(1) })).toContainText('2 of 4');
    await page.keyboard.press('Alt+ArrowDown');
    await expect(page.getByRole('dialog', { name: title(2) })).toContainText('3 of 4');
  });

  test('keeps the focus in the peek after ⌥↓ from a property field', async ({ page }) => {
    const peek = await openPeek(page, 0);
    await peek.locator('.props-strip input[type="number"]').focus();
    await page.keyboard.press('Alt+ArrowDown');
    const second = page.getByRole('dialog', { name: title(1) });
    await expect(second).toContainText('2 of 4');
    expect(await second.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
  });

  test('steps back with ↑ after ↓ on "Next row" reached the last row and disabled it', async ({
    page,
  }) => {
    await openPeek(page, 2);
    await page.getByRole('dialog').getByRole('button', { name: 'Next row' }).focus();
    await page.keyboard.press('ArrowDown');
    const last = page.getByRole('dialog', { name: title(3) });
    await expect(last.getByRole('button', { name: 'Next row' })).toBeDisabled();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('dialog', { name: title(2) })).toContainText('3 of 4');
  });

  test('guard: Esc after a step hands the focus back to the row that opened the peek', async ({
    page,
  }) => {
    await openPeek(page, 1);
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('dialog', { name: title(2) })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(peekRow(page).getByRole('button', { name: title(1), exact: true })).toBeFocused();
  });
});

test.describe('the preview card', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
    await page.goto('/gallery.html');
    await expect(page.locator('.gallery-page__panel')).toHaveCount(2);
  });

  /** Stops the clock once the peek is up, so only `runFor` moves it. */
  async function pause(page: Page): Promise<void> {
    await page.clock.pauseAt(new Date(Date.now() + 60_000));
  }

  async function cardFor(page: Page, link: Locator): Promise<Locator> {
    await link.hover();
    await page.clock.runFor(400);
    const card = page.getByRole('tooltip');
    await expect(card).toBeVisible();
    return card;
  }

  test('guard: goes when the note scrolls under a still pointer', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 600 });
    const peek = await openPeek(page, 0);
    await expect(peek.locator('.ProseMirror')).toBeVisible();
    // Room to scroll, as a long note has; outside the editor, which would put its own DOM back.
    await peek
      .locator('.peek__page')
      .evaluate((note) => note.style.setProperty('padding-bottom', '3000px'));
    const link = peek.locator('a.wikilink[data-wikilink="P16-04"]');
    await pause(page);
    await cardFor(page, link);
    const scrolled = await peek.locator('.peek__body').evaluate((body) => {
      // At once: a smooth scroll would wait on the paused clock.
      body.scrollBy({ top: 200, behavior: 'instant' });
      return body.scrollTop;
    });
    expect(scrolled).toBeGreaterThan(0);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  });

  test('guard: shows no card for a link taken out of the note before its 400 ms were up', async ({
    page,
  }) => {
    const peek = await openPeek(page, 0);
    await expect(peek.locator('.ProseMirror')).toBeVisible();
    await pause(page);
    const link = peek.locator('a.wikilink[data-wikilink="P16-04"]');
    await link.hover();
    await page.clock.runFor(200);
    await link.evaluate((element) => element.remove());
    await page.clock.runFor(400);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  });

  test('guard: takes the card away with its link, under a still pointer', async ({ page }) => {
    const peek = await openPeek(page, 0);
    await expect(peek.locator('.ProseMirror')).toBeVisible();
    await pause(page);
    const link = peek.locator('a.wikilink[data-wikilink="P16-04"]');
    await cardFor(page, link);
    await link.evaluate((element) => element.remove());
    await page.clock.runFor(100);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  });

  test('goes when the window is resized under it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const peek = await openPeek(page, 0);
    await expect(peek.locator('.ProseMirror')).toBeVisible();
    await pause(page);
    await cardFor(page, peek.locator('a.wikilink[data-wikilink="P16-04"]'));
    await page.setViewportSize({ width: 760, height: 520 });
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  });

  test('guard: stays inside the app’s smallest window, clear of its link', async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 480 });
    const peek = await openPeek(page, 0);
    await expect(peek.locator('.ProseMirror')).toBeVisible();
    await pause(page);
    for (const link of [
      peek.locator('a.wikilink[data-wikilink="P16-04"]'),
      peek.locator('.props-strip [data-link-path="Tasks/A15-02.md"]'),
    ]) {
      const card = await cardFor(page, link);
      const [linkBox, cardBox] = [await link.boundingBox(), await card.boundingBox()];
      expect(cardBox!.x).toBeGreaterThanOrEqual(0);
      expect(cardBox!.y).toBeGreaterThanOrEqual(0);
      expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(720);
      expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(480);
      const overlaps =
        cardBox!.y < linkBox!.y + linkBox!.height && cardBox!.y + cardBox!.height > linkBox!.y;
      expect(overlaps).toBe(false);
      await page.mouse.move(0, 0);
      await expect(page.getByRole('tooltip')).toHaveCount(0);
    }
  });
});
