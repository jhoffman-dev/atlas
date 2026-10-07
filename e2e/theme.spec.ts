import { expect, test, type Page } from '@playwright/test';
import { createVault, installHost } from './host.ts';

// P13-02, moved by P16-02: light or dark, a sun and a moon in the sidebar's
// foot, remembered per viewer.

const openVault = async (page: Page) => {
  const vault = await createVault();
  await vault.write('note.md', '# Note\n\nBody.\n');
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByRole('navigation', { name: 'Vault' })).toBeVisible();
  return vault;
};

const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset['theme']);

const themes = (page: Page) => page.getByRole('radiogroup', { name: 'Theme' });
const option = (page: Page, name: 'Light theme' | 'Dark theme') =>
  themes(page).getByRole('radio', { name });

test('the switch turns the whole app over, and back', async ({ page }) => {
  await openVault(page);

  await option(page, 'Dark theme').click();
  expect(await theme(page)).toBe('dark');
  await expect(option(page, 'Dark theme')).toHaveAttribute('aria-checked', 'true');
  await expect(option(page, 'Light theme')).toHaveAttribute('aria-checked', 'false');

  await option(page, 'Light theme').click();
  expect(await theme(page)).toBe('light');
  await expect(option(page, 'Light theme')).toHaveAttribute('aria-checked', 'true');
});

test('the switch lives in the sidebar, beside Settings', async ({ page }) => {
  await openVault(page);
  const sidebar = page.getByRole('navigation', { name: 'Vault' });
  await expect(sidebar.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
});

test('the choice survives a reload', async ({ page }) => {
  await openVault(page);
  await option(page, 'Dark theme').click();
  expect(await theme(page)).toBe('dark');

  // The host stub is installed on the page, not the document, so it survives a
  // reload — which is what makes this a real second visit.
  await page.reload();
  await expect(option(page, 'Dark theme')).toBeVisible();

  expect(await theme(page)).toBe('dark');
  await expect(option(page, 'Dark theme')).toHaveAttribute('aria-checked', 'true');
});

/**
 * WCAG 2.1 contrast, computed in the page from the tokens as they actually
 * resolve rather than from the values written in the stylesheet.
 */
const ratios = (page: Page, pairs: readonly (readonly [string, string])[]) =>
  page.evaluate((wanted) => {
    const root = getComputedStyle(document.documentElement);
    const channels = (token: string): [number, number, number] => {
      const hex = root.getPropertyValue(token).trim().replace('#', '');
      const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
      return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
    };
    const luminance = (token: string) => {
      const [r, g, b] = channels(token).map((value) => {
        const scaled = value / 255;
        return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    return wanted.map(([fore, back]) => {
      const [lighter, darker] = [luminance(fore), luminance(back)].sort((a, b) => b - a) as [
        number,
        number,
      ];
      return { pair: `${fore} on ${back}`, ratio: (lighter + 0.05) / (darker + 0.05) };
    });
  }, pairs);

/**
 * The reference's mid-greys on a tinted ground are exactly where contrast
 * slips, so the dim and faint text colours are held to AA (4.5:1) by a test
 * rather than by having been checked once.
 */
test('the text colours clear WCAG AA on both themes', async ({ page }) => {
  await openVault(page);
  // Every text role on every surface it is drawn on: the sidebar is on the
  // ground, the work on the panel, cards and controls on raised.
  const pairs = [
    ['--ink', '--ground'],
    ['--ink', '--panel'],
    ['--ink', '--raised'],
    ['--ink-2', '--ground'],
    ['--ink-2', '--panel'],
    ['--ink-2', '--raised'],
    ['--ink-2', '--track'],
    ['--ink-3', '--ground'],
    ['--ink-3', '--panel'],
    ['--ink-3', '--raised'],
    ['--accent-text', '--panel'],
    ['--accent-text', '--raised'],
    ['--danger', '--ground'],
    ['--danger', '--panel'],
    ['--danger', '--raised'],
    ['--accent-ink', '--accent'],
  ] as const;

  for (const named of ['light', 'dark'] as const) {
    await page.evaluate((value) => {
      document.documentElement.dataset['theme'] = value;
    }, named);
    for (const { pair, ratio } of await ratios(page, pairs)) {
      expect(ratio, `${named}: ${pair}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

// The shell is the ground with the sidebar sitting straight on it, and the work
// in a panel that is a different surface, lifted and rounded — in both themes.
test('the work sits in a panel on the ground; the sidebar sits on the ground itself', async ({
  page,
}) => {
  await openVault(page);
  const surfaces = () =>
    page.evaluate(() => {
      const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
      return {
        shell: style('.shell').backgroundColor,
        sidebar: style('.shell__sidebar').backgroundColor,
        panel: style('.panel').backgroundColor,
        radius: style('.panel').borderTopLeftRadius,
        shadow: style('.panel').boxShadow,
      };
    });

  const light = await surfaces();
  expect(light.shell).toBe('rgb(227, 231, 240)');
  expect(light.sidebar).toBe('rgba(0, 0, 0, 0)');
  expect(light.panel).toBe('rgb(242, 244, 249)');
  expect(light.radius).toBe('22px');
  expect(light.shadow).not.toBe('none');

  await option(page, 'Dark theme').click();
  const dark = await surfaces();
  expect(dark.shell).toBe('rgb(7, 15, 36)');
  expect(dark.sidebar).toBe('rgba(0, 0, 0, 0)');
  expect(dark.panel).toBe('rgb(12, 24, 52)');
});

test('the app is set in Manrope, bundled rather than fetched', async ({ page }) => {
  const fetched: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://localhost')) fetched.push(request.url());
  });
  await openVault(page);

  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain(
    'Manrope',
  );
  // `load` resolves to the faces it found; with no @font-face for the family it
  // finds none, which is the failure this is here to catch.
  const loaded = await page.evaluate(async () =>
    (await document.fonts.load('600 13.5px "Manrope Variable"')).map((face) => face.status),
  );
  expect(loaded.length).toBeGreaterThan(0);
  expect(loaded.every((status) => status === 'loaded')).toBe(true);
  expect(fetched).toEqual([]);
});
