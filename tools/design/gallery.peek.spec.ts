import { expect, test, type Locator, type Page } from '../../e2e/fixtures.ts';

/**
 * UI v2 slice 6a (#301): the center peek and the link preview card as the
 * gallery draws them (apps/desktop/gallery.html), in a real engine — open a
 * row, step with ↑ ↓ and ⌥↑ ⌥↓ (Q6), close with Esc and get the focus back,
 * and the 400 ms preview on a wikilink and a relation value (Q22). Then the
 * contrast of what the peek draws in ink-3, and its rings, in both themes.
 * The app's own `peek.spec.ts` lands with slice 6b, which wires the peek to
 * the panes.
 */
const THEMES = ['light', 'dark'] as const;
const ROWS = [
  'Phase 16 — The look, rebuilt',
  'Book the hall for the autumn fête',
  'Leftovers from A15-02: templates in views',
  'Water the garden',
];

/** The gallery's row `index` by its title. */
function title(index: number): string {
  const row = ROWS[index];
  if (row === undefined) throw new Error(`The gallery has no row ${index}`);
  return row;
}

test.use({ viewport: { width: 1440, height: 900 } });

function peekRow(page: Page, theme: string): Locator {
  return page
    .locator(`.gallery-page__panel[data-theme="${theme}"] .gallery-page__row`)
    .filter({ has: page.getByRole('heading', { level: 2, name: 'Peek', exact: true }) });
}

/**
 * Opens a row's peek from the keyboard, as a focused table row is opened:
 * WebKit does not focus a button it clicks, so a click would leave nothing
 * for the focus to return to.
 */
async function openPeek(page: Page, theme: string, row: number): Promise<Locator> {
  const opener = peekRow(page, theme).getByRole('button', { name: title(row), exact: true });
  await opener.focus();
  await page.keyboard.press('Enter');
  const peek = page.getByRole('dialog', { name: title(row) });
  await expect(peek).toBeVisible();
  return peek;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/gallery.html');
  await expect(page.locator('.gallery-page__panel')).toHaveCount(2);
});

test('opens a row, steps with ↑ ↓ from the chrome, and closes on Esc back to the row', async ({
  page,
}) => {
  const peek = await openPeek(page, 'light', 1);
  await expect(peek).toContainText('2 of 4 in Task table');
  await expect(peek).toBeFocused();

  await page.keyboard.press('ArrowDown');
  const third = page.getByRole('dialog', { name: title(2) });
  await expect(third).toContainText('3 of 4 in Task table');
  await expect(third.getByRole('heading', { level: 1 })).toContainText(title(2));
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  const first = page.getByRole('dialog', { name: title(0) });
  await expect(first).toContainText('1 of 4 in Task table');
  await expect(first.getByRole('button', { name: 'Previous row' })).toBeDisabled();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    peekRow(page, 'light').getByRole('button', { name: title(1), exact: true }),
  ).toBeFocused();
});

test('leaves ↓ to the text, where it moves the caret, and steps on ⌥↓ from there', async ({
  page,
}) => {
  const peek = await openPeek(page, 'light', 0);
  const text = peek.locator('.ProseMirror');
  await expect(text).toBeVisible();
  await text.click();
  await page.keyboard.press('ArrowDown');
  await expect(peek).toContainText('1 of 4 in Task table');

  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.getByRole('dialog', { name: title(1) })).toContainText('2 of 4 in Task table');
});

test('steps with its own buttons, and closes on its ×', async ({ page }) => {
  const peek = await openPeek(page, 'light', 2);
  await peek.getByRole('button', { name: 'Next row' }).click();
  const last = page.getByRole('dialog', { name: title(3) });
  await expect(last.getByRole('button', { name: 'Next row' })).toBeDisabled();
  await last.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('reveals the empty properties behind "+ N empty"', async ({ page }) => {
  const peek = await openPeek(page, 'light', 0);
  const strip = peek.locator('.props-strip');
  await expect(strip.getByRole('term')).toHaveCount(3);
  await strip.getByRole('button', { name: '+ 4 empty' }).click();
  await expect(strip.getByRole('term')).toHaveCount(7);
});

test.describe('the link preview', () => {
  test.beforeEach(async ({ page }) => {
    // The 400 ms rule, on a clock the test moves, not on the machine's.
    await page.clock.install();
    await page.goto('/gallery.html');
    await expect(page.locator('.gallery-page__panel')).toHaveCount(2);
  });

  /** Stops the clock once the peek is up, so only `runFor` moves it. */
  async function openPaused(page: Page): Promise<Locator> {
    const peek = await openPeek(page, 'light', 0);
    await expect(peek.locator('.ProseMirror')).toBeVisible();
    await page.clock.pauseAt(new Date(Date.now() + 60_000));
    return peek;
  }

  test('shows a wikilink’s card after 400 ms, and not after 399; hides it on leaving', async ({
    page,
  }) => {
    const peek = await openPaused(page);
    const link = peek.locator('a.wikilink[data-wikilink="P16-04"]');
    await expect(link).toBeVisible();
    await link.hover();
    await page.clock.runFor(399);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.clock.runFor(1);
    const card = page.getByRole('tooltip');
    await expect(card).toBeVisible();
    await expect(card).toContainText('P16-04');
    await expect(card).toContainText('Task · Phase 16');
    // Under the link, and inside the peek's width.
    const [linkBox, cardBox] = [await link.boundingBox(), await card.boundingBox()];
    expect(cardBox!.y).toBeGreaterThan(linkBox!.y);
    expect(cardBox!.width).toBe(360);

    await peek.getByRole('heading', { level: 1 }).hover();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  });

  test('shows a relation value’s card, and hides it on a key', async ({ page }) => {
    const peek = await openPaused(page);
    const value = peek.locator('.props-strip [data-link-path="Tasks/A15-02.md"]');
    await value.hover();
    await page.clock.runFor(400);
    await expect(page.getByRole('tooltip')).toContainText('Task · Phase 15');
    await page.keyboard.press('Shift');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  });
});

/** WCAG contrast of an element's text colour on the first opaque background behind it. */
async function contrastOf(target: Locator): Promise<number> {
  return target.evaluate((element) => {
    const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = ([r, g, b]: number[]) => {
      const lin = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
    };
    let behind: Element | null = element;
    let background = 'rgba(0, 0, 0, 0)';
    while (behind !== null) {
      const colour = getComputedStyle(behind).backgroundColor;
      const parts = rgb(colour);
      if (parts.length === 3 || (parts.length === 4 && parts[3]! >= 1)) {
        background = colour;
        break;
      }
      behind = behind.parentElement;
    }
    const fore = luminance(rgb(getComputedStyle(element).color));
    const back = luminance(rgb(background));
    return (Math.max(fore, back) + 0.05) / (Math.min(fore, back) + 0.05);
  });
}

/** WCAG contrast of an element's focus ring — its box-shadow's last colour — on the peek. */
async function ringContrastOf(target: Locator): Promise<number> {
  return target.evaluate((element) => {
    const colours = getComputedStyle(element).boxShadow.match(/rgba?\([^)]+\)/g) ?? [];
    const ring = colours.at(-1);
    if (ring === undefined) return 0;
    const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = ([r, g, b]: number[]) => {
      const lin = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
    };
    const peek = element.closest('.peek');
    const fore = luminance(rgb(ring));
    const back = luminance(rgb(getComputedStyle(peek!).backgroundColor));
    return (Math.max(fore, back) + 0.05) / (Math.min(fore, back) + 0.05);
  });
}

for (const theme of THEMES) {
  test(`the peek's ink-3 reads at 4.5:1 and its rings at 3:1, ${theme}`, async ({ page }) => {
    const peek = await openPeek(page, theme, 0);
    const texts = [
      peek.locator('.peek__where'),
      peek.locator('.peek__status'),
      peek.locator('.props-strip__fold'),
      peek.locator('.props-strip .props__label').first(),
      peek.locator('.key-hints'),
    ];
    for (const text of texts) {
      await expect(text).toBeVisible();
      expect(await contrastOf(text)).toBeGreaterThanOrEqual(4.5);
    }
    // The keyboard's focus on the chrome: the ring drawn on :focus-visible.
    const next = peek.getByRole('button', { name: 'Next row' });
    await page.keyboard.press('Shift');
    await next.focus();
    expect(await next.evaluate((e) => e.matches(':focus-visible'))).toBe(true);
    expect(await ringContrastOf(next)).toBeGreaterThanOrEqual(3);
  });
}
