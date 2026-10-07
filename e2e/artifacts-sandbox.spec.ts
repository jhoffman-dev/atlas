import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { createVault, installHost } from './host.ts';

/*
 * Adversarial: a saved copy is a stranger's page. Atlas's policy, put first in
 * its head, is what keeps it from calling home — "a picture cannot be a
 * beacon". Each page here tries to load a picture from another site, then
 * marks itself done; the test waits for the mark and then counts what reached
 * the network. The first page is the control: a well-formed page's beacon is
 * blocked, so a count above zero below is the policy failing, not the probe.
 */

const REPO_ATLAS = new URL('../vault/.atlas/', import.meta.url);
const BEACON = 'https://beacon.test';

const beaconScript = (tag: string) =>
  `<script>const i = new Image(); i.onload = i.onerror = () => { document.documentElement.dataset.done = "yes"; }; i.src = "${BEACON}/${tag}";</script>`;

async function openVault(page: Page): Promise<void> {
  const vault = await createVault();
  for (const folder of ['.atlas/types', '.atlas/templates', '.atlas/views']) {
    await vault.mkdir(folder);
  }
  for (const file of ['types/artifact.md', 'templates/Artifact.md', 'views/Artifacts.md']) {
    await vault.write(`.atlas/${file}`, await readFile(new URL(file, REPO_ATLAS), 'utf8'));
  }
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
}

async function saveDroppedPage(page: Page, name: string, html: string): Promise<void> {
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Claude artifact…' }).click();
  const dialog = page.getByRole('dialog', { name: 'New artifact' });
  const transfer = await page.evaluateHandle(
    ([fileName, text]) => {
      const data = new DataTransfer();
      data.items.add(new File([text], fileName, { type: 'text/html' }));
      return data;
    },
    [name, html] as const,
  );
  await dialog
    .getByRole('group', { name: 'Drop the page here' })
    .dispatchEvent('drop', { dataTransfer: transfer });
  await expect(dialog.getByText(/Saving a copy/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Save artifact' }).click();
}

/** Opens the page as a saved copy and resolves to the beacon requests it made. */
async function beaconsFrom(page: Page, name: string, html: string): Promise<string[]> {
  const hits: string[] = [];
  await page.route(`${BEACON}/**`, async (route) => {
    hits.push(route.request().url());
    await route.fulfill({ status: 404, body: '' });
  });
  await openVault(page);
  await saveDroppedPage(page, `${name}.html`, html);
  const inside = page.frameLocator(`iframe[title="Saved copy of ${name}"]`);
  await expect(inside.locator('html')).toHaveAttribute('data-done', 'yes');
  return hits;
}

test('control: a well-formed page cannot load a picture from another site', async ({ page }) => {
  const html = `<!doctype html><html><head><title>t</title></head><body>${beaconScript('control')}</body></html>`;
  expect(await beaconsFrom(page, 'Control', html)).toEqual([]);
});

test('a <head> inside a comment does not lift the policy', async ({ page }) => {
  const html = `<!doctype html><!-- <head> --><html><head><title>t</title></head><body>${beaconScript('comment')}</body></html>`;
  expect(await beaconsFrom(page, 'Commented', html)).toEqual([]);
});

test('a script before the <head> tag runs under the policy', async ({ page }) => {
  const html = `<!doctype html>${beaconScript('early')}<head><title>t</title></head><body></body>`;
  expect(await beaconsFrom(page, 'Early', html)).toEqual([]);
});

test('a <head> inside <noscript> does not lift the policy', async ({ page }) => {
  // With scripting on, <noscript> in the head is raw text: a meta written into it is not an element.
  const html = `<!doctype html><html><noscript><head></noscript><head></head><body>${beaconScript('noscript')}</body></html>`;
  expect(await beaconsFrom(page, 'Noscript', html)).toEqual([]);
});

test('a <head> inside an attribute value does not lift the policy', async ({ page }) => {
  const html = `<!doctype html><html lang="<head>"><head><title>t</title></head><body>${beaconScript('attribute')}</body></html>`;
  expect(await beaconsFrom(page, 'Attribute', html)).toEqual([]);
});

test('content before a late <head> tag does not push the policy into the body', async ({
  page,
}) => {
  const html = `<!doctype html><p>hi</p><head><title>t</title></head><body>${beaconScript('late')}</body>`;
  expect(await beaconsFrom(page, 'Late', html)).toEqual([]);
});

test('a page saved with a byte order mark runs under the policy', async ({ page }) => {
  const bom = String.fromCharCode(0xfeff);
  const html = `${bom}<!doctype html><html><head><title>t</title></head><body>${beaconScript('bom')}</body></html>`;
  expect(await beaconsFrom(page, 'Marked', html)).toEqual([]);
});

test('the frame cannot navigate itself to another site', async ({ page }) => {
  // The policy governs one document. A refresh or `location = …` replaces it
  // with a live remote page — under no policy at all, inside the app's pane —
  // and the URL itself carries whatever the page read. The sandbox stops the
  // top window and popups (probed: they are blocked); nothing stops this.
  const navigations: string[] = [];
  await page.route(`${BEACON}/**`, async (route) => {
    navigations.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<p>elsewhere</p>' });
  });
  await openVault(page);
  const attempt = page
    .waitForRequest(`${BEACON}/refresh`, { timeout: 3_000 })
    .then(() => 'navigated')
    .catch(() => 'stayed');
  await saveDroppedPage(
    page,
    'Refresh.html',
    `<!doctype html><html><head><meta http-equiv="refresh" content="0;url=${BEACON}/refresh"></head><body>x</body></html>`,
  );
  // No event marks a navigation that never happens, so the passing case waits out the bound.
  expect(await attempt).toBe('stayed');
  expect(navigations).toEqual([]);
});
