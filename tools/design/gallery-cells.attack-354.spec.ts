// Attack on PR #354 (#299): the in-place cell editors as the gallery draws
// them, in a real engine — the row's height while editing, the ring's
// paint, the picker's bounds and the editors' contrast, in both themes.
import { expect, test } from '../../e2e/fixtures.ts';
import type { Locator, Page } from '@playwright/test';

const THEMES = ['light', 'dark'] as const;

test.use({ viewport: { width: 1440, height: 900 } });

function tableRow(page: Page, theme: string): Locator {
  return page
    .locator(`.gallery-page__panel[data-theme="${theme}"] .gallery-page__row`)
    .filter({ has: page.getByRole('heading', { level: 2, name: 'Table', exact: true }) });
}

async function openGallery(page: Page): Promise<void> {
  await page.goto('/gallery.html');
  await expect(page.locator('.gallery-page__panel')).toHaveCount(2);
}

/** The height of the table line holding an element. */
async function lineHeight(cell: Locator): Promise<number> {
  return cell.evaluate((element) => element.closest('tr')!.getBoundingClientRect().height);
}

/** The ancestors, up to the sheet, that clip and would cut a ring of `spread` px off. */
async function clippingAncestors(element: Locator, spread: number): Promise<string[]> {
  return element.evaluate((node, ring) => {
    const box = node.getBoundingClientRect();
    const cut: string[] = [];
    for (let at = node.parentElement; at !== null; at = at.parentElement) {
      const style = getComputedStyle(at);
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
        const clip = at.getBoundingClientRect();
        if (
          box.left - ring < clip.left ||
          box.right + ring > clip.right ||
          box.top - ring < clip.top ||
          box.bottom + ring > clip.bottom
        ) {
          cut.push(`${at.tagName.toLowerCase()}.${at.className}`);
        }
      }
      if (at.classList.contains('table__sheet')) break;
    }
    return cut;
  }, spread);
}

/** The WCAG contrast of an element's text against what is painted behind it. */
async function textContrast(element: Locator): Promise<number> {
  return element.evaluate((node) => {
    const rgba = (value: string) => {
      const parts = value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
      return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 };
    };
    let behind = { r: 255, g: 255, b: 255, a: 1 };
    for (let at: Element | null = node; at !== null; at = at.parentElement) {
      const colour = rgba(getComputedStyle(at).backgroundColor);
      if (colour.a > 0.5) {
        behind = colour;
        break;
      }
    }
    const ink = rgba(getComputedStyle(node).color);
    const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const channel = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const [hi, lo] = [lum(ink), lum(behind)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  });
}

for (const theme of THEMES) {
  test.describe(`attack #354 — the cell editors, ${theme}`, () => {
    test('a row stays 34px while its date cell is edited', async ({ page }) => {
      await openGallery(page);
      const row = tableRow(page, theme);
      const date = row.getByRole('button', { name: '2026-10-21', exact: true });
      expect(await lineHeight(date)).toBe(34);
      await date.click();
      const input = row.locator('.table__input');
      await expect(input).toBeFocused();
      expect(await lineHeight(input)).toBe(34);
    });

    test('a row stays 34px while its status picker is open', async ({ page }) => {
      await openGallery(page);
      const row = tableRow(page, theme);
      const status = row.getByRole('button', { name: 'Next', exact: true });
      await status.click();
      await expect(page.getByRole('dialog', { name: 'Set Status' })).toBeVisible();
      expect(await lineHeight(status)).toBe(34);
    });

    test('the editing field’s 1.5px ring is not clipped by any ancestor', async ({ page }) => {
      await openGallery(page);
      const row = tableRow(page, theme);
      await row.getByRole('button', { name: '2026-10-21', exact: true }).click();
      const input = row.locator('.table__input');
      await expect(input).toBeFocused();
      expect(await clippingAncestors(input, 1.5)).toEqual([]);
    });

    test('the status cell’s ring is not clipped while its picker is open', async ({ page }) => {
      await openGallery(page);
      const row = tableRow(page, theme);
      const status = row.getByRole('button', { name: 'Next', exact: true });
      await status.click();
      await expect(status).toHaveAttribute('data-editing', '');
      expect(await clippingAncestors(status, 1.5)).toEqual([]);
    });

    test('the status picker is bounded and scrolls, so a long option list stays on screen', async ({
      page,
    }) => {
      await openGallery(page);
      const row = tableRow(page, theme);
      await row.getByRole('button', { name: 'Next', exact: true }).click();
      const picker = page.getByRole('dialog', { name: 'Set Status' });
      await expect(picker).toBeVisible();
      const bounded = await picker.evaluate((popup) => {
        const list = popup.querySelector('[role="listbox"]') as HTMLElement;
        const scrolls = (element: Element) => {
          const style = getComputedStyle(element);
          return (
            style.maxHeight !== 'none' &&
            (style.overflowY === 'auto' || style.overflowY === 'scroll')
          );
        };
        return scrolls(popup) || scrolls(list);
      });
      expect(bounded).toBe(true);
    });

    test('the editing field’s text has 4.5:1 contrast', async ({ page }) => {
      await openGallery(page);
      const row = tableRow(page, theme);
      await row.getByRole('button', { name: 'Mara Quill', exact: true }).first().click();
      const input = row.locator('.table__input');
      await expect(input).toBeFocused();
      expect(await textContrast(input)).toBeGreaterThanOrEqual(4.5);
    });

    test('the picker’s option labels have 4.5:1 contrast', async ({ page }) => {
      await openGallery(page);
      const row = tableRow(page, theme);
      await row.getByRole('button', { name: 'Next', exact: true }).click();
      const labels = page
        .getByRole('dialog', { name: 'Set Status' })
        .locator('.cell-picker__label');
      await expect(labels.first()).toBeVisible();
      for (const label of await labels.all()) {
        expect(await textContrast(label)).toBeGreaterThanOrEqual(4.5);
      }
    });
  });
}
