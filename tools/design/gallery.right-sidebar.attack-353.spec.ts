import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Attack #353 on the gallery's right-sidebar specimens (apps/desktop/gallery.html):
 * contrast and focus rings in both themes, and long words in the 300px pane.
 * The gallery is served by Vite's dev server, as playwright.gallery.config.ts does.
 */
const THEMES = ['light', 'dark'] as const;

test.use({ viewport: { width: 1440, height: 900 } });

const asides = (page: Page, theme: string): Locator =>
  page.locator(`.gallery-page__panel[data-theme="${theme}"] .aside`);

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

test.beforeEach(async ({ page }) => {
  await page.goto('/gallery.html');
  await expect(page.locator('.gallery-page__panel')).toHaveCount(2);
});

for (const theme of THEMES) {
  test(`the aside's text reads at 4.5:1 and its × at 3:1, ${theme}`, async ({ page }) => {
    const aside = asides(page, theme);
    await expect(aside).toHaveCount(3);
    const first = aside.first();
    const backlinks = aside.nth(1);
    const outline = aside.nth(2);
    const texts: Locator[] = [
      first.locator('.aside__tab[aria-selected="false"]').first(),
      first.locator('.aside__tab[aria-selected="true"]'),
      first.locator('.aside__kicker').first(),
      first.locator('.aside-props__fold'),
      first.locator('.props__label').first(),
      backlinks.locator('.links__heading').first(),
      backlinks.locator('.mentions__path').first(),
      outline.locator('.aside-outline__heading').first(),
    ];
    for (const each of texts) {
      await expect(each).toBeVisible();
      expect(
        await contrastOf(each),
        await each.evaluate((e) => e.className),
      ).toBeGreaterThanOrEqual(4.5);
    }
    const hide = first.getByRole('button', { name: 'Hide right sidebar' });
    expect(await contrastOf(hide)).toBeGreaterThanOrEqual(3);
  });

  test(`every control in the aside draws a ring under the keyboard's focus, ${theme}`, async ({
    page,
  }) => {
    const aside = asides(page, theme);
    const controls: Locator[] = [
      aside.first().locator('.aside__tab[aria-selected="true"]'),
      aside.first().getByRole('button', { name: 'Hide right sidebar' }),
      aside.first().locator('.aside-props__fold'),
      aside.first().getByRole('button', { name: 'Open' }),
      aside.nth(1).locator('.mentions__link').first(),
      aside.nth(1).getByRole('button', { name: 'Unlinked mentions' }),
      aside.nth(2).locator('.aside-outline__heading').first(),
    ];
    await page.keyboard.press('Shift');
    for (const control of controls) {
      await control.focus();
      const ring = await control.evaluate((e) => ({
        visible: e.matches(':focus-visible'),
        shadow: getComputedStyle(e).boxShadow,
        outline: getComputedStyle(e).outlineStyle,
      }));
      expect(ring.visible).toBe(true);
      const label = await control.evaluate((e) => e.className);
      expect(ring.shadow !== 'none' || ring.outline !== 'none', label).toBe(true);
    }
  });

  test(`a long unbroken title does not scroll the 300px pane sideways, ${theme}`, async ({
    page,
  }) => {
    const first = asides(page, theme).first();
    await first
      .locator('.aside__title')
      .evaluate((e) => (e.textContent = 'Larkspur-payroll-import-'.repeat(12)));
    const panel = first.locator('.aside__panel');
    const { scroll, client } = await panel.evaluate((e) => ({
      scroll: e.scrollWidth,
      client: e.clientWidth,
    }));
    expect(scroll).toBeLessThanOrEqual(client);
  });

  test(`a long unbroken summary does not scroll the 300px pane sideways, ${theme}`, async ({
    page,
  }) => {
    const first = asides(page, theme).first();
    await first
      .locator('.aside__summary')
      .evaluate((e) => (e.textContent = 'apps/desktop/src/overlay/'.repeat(12)));
    const panel = first.locator('.aside__panel');
    const { scroll, client } = await panel.evaluate((e) => ({
      scroll: e.scrollWidth,
      client: e.clientWidth,
    }));
    expect(scroll).toBeLessThanOrEqual(client);
  });

  test(`a long link title and path do not scroll the Backlinks pane sideways, ${theme}`, async ({
    page,
  }) => {
    const links = asides(page, theme).nth(1);
    const row = links.locator('.mentions__link').first();
    await row
      .locator('.mentions__name')
      .evaluate((e) => (e.textContent = 'Tobias Fenn '.repeat(20)));
    await row
      .locator('.mentions__path')
      .evaluate((e) => (e.textContent = 'Meetings/2026/Larkspur/'.repeat(8)));
    const panel = links.locator('.aside__panel');
    const { scroll, client } = await panel.evaluate((e) => ({
      scroll: e.scrollWidth,
      client: e.clientWidth,
    }));
    expect(scroll).toBeLessThanOrEqual(client);
  });

  test(`the slot holds 300px whatever the panel holds, ${theme}`, async ({ page }) => {
    const first = asides(page, theme).first();
    await first
      .locator('.aside__title')
      .evaluate((e) => (e.textContent = 'Larkspur-payroll-import-'.repeat(12)));
    const width = await page
      .locator(`.gallery-page__panel[data-theme="${theme}"] .gallery-page__aside`)
      .first()
      .evaluate((e) => e.getBoundingClientRect().width);
    expect(Math.round(width)).toBeLessThanOrEqual(302);
  });
}
