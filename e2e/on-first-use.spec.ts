import { expect, test } from './fixtures.ts';
import { basename } from 'node:path';
import { createVault, installHost } from './host.ts';

/*
 * A page whose chunk will not load in place, however often Reload asks: the
 * window can be loaded again, and DFAI starts afresh with its vault (#262).
 */

const GRAPH_PAGE = /\/assets\/graph-page-[^/]+\.js/;

test('offers to reload the window once Reload has failed too, and reloading starts DFAI again on its vault', async ({
  page,
}) => {
  const vault = await createVault();
  await vault.write('one.md', '# One\n');
  await installHost(page, vault);
  // Every copy of the graph's chunk arrives cut short, fresh addresses included.
  let cutShort = true;
  await page.route(GRAPH_PAGE, async (route) => {
    if (!cutShort) return route.continue();
    const response = await route.fetch();
    const body = await response.text();
    return route.fulfill({ response, body: body.slice(0, Math.floor(body.length / 2)) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();

  await page.getByRole('list', { name: 'Go to' }).getByRole('button', { name: 'Graph' }).click();
  const failed = page.getByRole('alert').filter({ hasText: 'couldn’t load' });
  await expect(failed).toHaveCount(1);
  await expect(failed.getByRole('button', { name: 'Reload window' })).toHaveCount(0);

  await failed.getByRole('button', { name: 'Reload' }).click();
  await expect(failed).toContainText('Unsaved changes might be lost.');
  cutShort = false;
  // A mark on this window, which a reload leaves behind.
  await page.evaluate(() => Object.assign(window, { beforeReload: true }));
  await failed.getByRole('button', { name: 'Reload window' }).click();
  await expect
    .poll(() => page.evaluate(() => 'beforeReload' in window).catch(() => true))
    .toBe(false);
  // DFAI starts again and opens the vault it had open, with nothing failed.
  await expect(
    page
      .getByRole('navigation', { name: 'Vault' })
      .getByRole('button', { name: basename(vault.root), exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('list', { name: 'Go to' })).toBeVisible();
  await expect(failed).toHaveCount(0);
});

test('Reload draws a page whose chunk arrived cut short, from a fresh copy, in place', async ({
  page,
}) => {
  const vault = await createVault();
  await vault.write('one.md', '# One\n');
  await installHost(page, vault);
  let cutShort = true;
  await page.route(GRAPH_PAGE, async (route) => {
    if (!cutShort) return route.continue();
    const response = await route.fetch();
    const body = await response.text();
    return route.fulfill({ response, body: body.slice(0, Math.floor(body.length / 2)) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();

  await page.getByRole('list', { name: 'Go to' }).getByRole('button', { name: 'Graph' }).click();
  const failed = page.getByRole('alert').filter({ hasText: 'couldn’t load' });
  await expect(failed).toHaveCount(1);

  cutShort = false;
  // The browser keeps the broken module under its address, so only a fresh one can mend it:
  // which the build's map of chunks has to name, under the name the page asks for.
  const fresh = page.waitForRequest((request) =>
    /\/assets\/graph-page-[^/]+\.js\?attempt=\d+$/.test(request.url()),
  );
  await failed.getByRole('button', { name: 'Reload' }).click();
  await fresh;
  await expect(page.locator('.graph__surface')).toBeVisible();
  await expect(failed).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose folder…' })).toHaveCount(0);
});
