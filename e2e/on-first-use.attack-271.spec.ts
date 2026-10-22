import { expect, test, type Page } from './fixtures.ts';
import { createVault, installHost, sidebarSection } from './host.ts';

/*
 * Attack on #271 (parts loaded on first use, #262). Each test fails a chunk
 * with `page.route` and checks what the person can still do. All of them fail
 * on b3729a63; see the PR's attack report.
 */

/** The chunk Settings, chat, dashboards and the rarer layouts share. */
const LATER_PARTS = '**/assets/later-parts-*.js';
const GRAPH_PAGE = '**/assets/graph-page-*.js';

const DASHBOARD = [
  '---',
  'atlas: dashboard',
  'widgets:',
  '  - title: Tasks',
  '    kind: number',
  '    type: task',
  '---',
  '',
  '# Progress',
  '',
].join('\n');

async function openVault(page: Page) {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/dashboards');
  await vault.write('.atlas/types/task.md', '---\nname: task\n---\n');
  await vault.write('.atlas/dashboards/Progress.md', DASHBOARD);
  await vault.write('one.md', '---\ntype: task\n---\n\nA task.\n');
  await installHost(page, vault);
}

/** Opens the vault, waiting for the background preload to have been answered. */
async function start(page: Page, chunk: string) {
  const asked = page.waitForRequest((request) => matches(request.url(), chunk));
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  await asked;
  // The preload's failure has reached the part once its warning is logged.
  await expect.poll(() => warnings.get(page) ?? 0).toBeGreaterThan(0);
}

const warnings = new WeakMap<Page, number>();
function countUnloadedWarnings(page: Page) {
  page.on('console', (message) => {
    if (message.text().startsWith('A part of DFAI could not load')) {
      warnings.set(page, (warnings.get(page) ?? 0) + 1);
    }
  });
}

// Whether `url` is the chunk the route glob names.
const matches = (url: string, glob: string) =>
  url.includes(glob.replace('**', '').replace('*.js', ''));

/** Fails `chunk` with a network error until `restore` is called. */
async function failUntilRestored(page: Page, chunk: string): Promise<() => void> {
  let failing = true;
  await page.route(chunk, (route) => (failing ? route.abort() : route.continue()));
  return () => {
    failing = false;
  };
}

const settingsDialog = (page: Page) => page.getByRole('dialog', { name: 'Settings' });
const unloaded = (page: Page) => page.getByRole('alert').filter({ hasText: 'couldn’t load' });

test.beforeEach(({ page }) => countUnloadedWarnings(page));

test('Settings whose chunk failed can be dismissed with Escape, like Settings itself', async ({
  page,
}) => {
  await openVault(page);
  await failUntilRestored(page, LATER_PARTS);
  await start(page, LATER_PARTS);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(unloaded(page)).toHaveCount(1);

  // Settings closes on Escape; its failed stand-in has no close at all, and sits
  // in the shell as an extra column beside the pane until a Reload succeeds.
  await page.keyboard.press('Escape');
  await expect(unloaded(page)).toHaveCount(0);
});

test('a part whose chunk failed only during the background preload opens once the network is back', async ({
  page,
}) => {
  await openVault(page);
  const restore = await failUntilRestored(page, LATER_PARTS);
  await start(page, LATER_PARTS);
  restore();

  // The person never saw the preload fail; the chunk is reachable now.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(settingsDialog(page)).toBeVisible();
  await expect(unloaded(page)).toHaveCount(0);
});

test('after Reload brings Settings back, its sections from the same chunk draw too', async ({
  page,
}) => {
  await openVault(page);
  const restore = await failUntilRestored(page, LATER_PARTS);
  await start(page, LATER_PARTS);
  // Still failing when Settings first opens: a preload's failure alone shows nothing (above).
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(unloaded(page)).toHaveCount(1);
  restore();

  await unloaded(page).getByRole('button', { name: 'Reload' }).click();
  await expect(settingsDialog(page)).toBeVisible();
  // The chunk is loaded, but each section keeps its own failed answer and wants its own Reload.
  await expect(
    settingsDialog(page).getByRole('region', { name: 'Quick capture from anywhere' }),
  ).toBeVisible();
  await expect(unloaded(page)).toHaveCount(0);
});

test('after Reload brings Settings back, a dashboard from the same chunk opens', async ({
  page,
}) => {
  await openVault(page);
  const restore = await failUntilRestored(page, LATER_PARTS);
  await start(page, LATER_PARTS);
  // Still failing when Settings first opens: a preload's failure alone shows nothing (above).
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(unloaded(page)).toHaveCount(1);
  restore();

  await unloaded(page).getByRole('button', { name: 'Reload' }).click();
  await expect(settingsDialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toHaveCount(0);

  await sidebarSection(page, 'dashboards')
    .getByRole('button', { name: 'Progress', exact: true })
    .click();
  await expect(page.getByLabel('Dashboard', { exact: true })).toBeVisible();
  await expect(unloaded(page)).toHaveCount(0);
});

test('Reload recovers a page whose chunk arrived cut short, once a whole copy can be fetched', async ({
  page,
}) => {
  await openVault(page);
  let truncate = true;
  await page.route(GRAPH_PAGE, async (route) => {
    if (!truncate) return route.continue();
    const response = await route.fetch();
    const body = await response.text();
    // A download interrupted halfway: the module fails to parse.
    return route.fulfill({ response, body: body.slice(0, Math.floor(body.length / 2)) });
  });
  await start(page, GRAPH_PAGE);
  truncate = false;

  await page.getByRole('list', { name: 'Go to' }).getByRole('button', { name: 'Graph' }).click();
  await unloaded(page).getByRole('button', { name: 'Reload' }).click();
  // The browser keeps the failed module under its URL, so the fresh import()
  // Reload makes fails the same way without fetching again.
  await expect(page.locator('.graph__surface')).toBeVisible();
});
