import { expect, test } from '@playwright/test';
import { createVault, installHost } from './host.ts';

/*
 * A page whose chunk will not load in place, however often Reload asks: the
 * window can be loaded again, and Atlas starts afresh (#262).
 */

const GRAPH_PAGE = /\/assets\/graph-page-[^/]+\.js/;

test('offers to reload the window once Reload has failed too, and reloading starts Atlas again', async ({
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
  const reloaded = page.waitForEvent('load');
  await failed.getByRole('button', { name: 'Reload window' }).click();
  await reloaded;
  await expect(page.getByRole('button', { name: 'Choose folder…' })).toBeVisible();
  await expect(failed).toHaveCount(0);
});
