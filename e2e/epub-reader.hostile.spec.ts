import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Frame } from '@playwright/test';
import { expect, test, type Page } from './fixtures.ts';
import { createVault, installHost } from './host.ts';
import { hostileFixtureEpub, HOSTILE_ORIGIN } from '../tools/epub/fixture-epub.ts';

/*
 * A hostile EPUB in the reader (#505), end to end in WebKit: a book that
 * tries scripts in every form, pictures, fonts, stylesheets and frames on
 * another site, a refresh, a form and links out runs nothing and asks for
 * nothing outside the app, and its one link inside the book still goes
 * where it says.
 */

const BOOK = 'Library/hostile.epub';

/** Every request the page made that leaves the app's own server. */
async function openHostileBook(page: Page): Promise<{ outside: string[] }> {
  const outside: string[] = [];
  page.on('request', (request) => {
    if (!isOwn(request.url())) outside.push(request.url());
  });
  // Nothing outside may answer either, so a request that slipped through could not load.
  await page.route(`${HOSTILE_ORIGIN}/**`, (route) => route.abort());
  const vault = await createVault();
  await mkdir(join(vault.root, 'Library'), { recursive: true });
  await writeFile(join(vault.root, BOOK), hostileFixtureEpub());
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await page.getByRole('treeitem', { name: 'Library' }).click();
  await page.getByRole('treeitem', { name: 'hostile.epub' }).click();
  return { outside };
}

/** A request is the app's own when it goes to the page's own server, or never leaves the page (`blob:`, `data:`, `about:`). */
function isOwn(url: string): boolean {
  if (/^(blob|data|about):/.test(url)) return true;
  const { hostname } = new URL(url);
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

const text = (page: Page) => page.frameLocator('iframe.epub-frame').locator('body');

async function frameOf(page: Page): Promise<Frame> {
  const frame = await (await page.locator('iframe.epub-frame').elementHandle())?.contentFrame();
  if (frame === null || frame === undefined) throw new Error('the reader shows no chapter');
  return frame;
}

/** What any of the book's scripts would have left behind, in the app's window or the frame's. */
async function traces(page: Page): Promise<unknown[]> {
  const frame = await frameOf(page);
  return [
    await page.evaluate(() => (window as { __hostileRan?: unknown }).__hostileRan ?? null),
    await frame.evaluate(() => (window as { __hostileRan?: unknown }).__hostileRan ?? null),
  ].filter((trace) => trace !== null);
}

test('a hostile book runs no script and asks for nothing outside the app', async ({ page }) => {
  const { outside } = await openHostileBook(page);
  await expect(text(page)).toContainText('A Hare one day ridiculed the short feet');
  const frame = await frameOf(page);

  // The frame holds none of the book's scripts, frames or plug-ins, under the reader's policy.
  expect(
    await frame.evaluate(() => document.querySelectorAll('script, iframe, object, embed').length),
  ).toBe(0);
  expect(await page.locator('iframe.epub-frame').getAttribute('sandbox')).toBe(
    'allow-same-origin allow-scripts',
  );
  // The pictures have had their chance to load: the book's own one (missing) failed, nothing else was asked for.
  await expect
    .poll(() => frame.evaluate(() => [...document.images].every((image) => image.complete)))
    .toBe(true);

  await frame.locator('p', { hasText: 'Click this line.' }).click();
  await frame.locator('#send').click();
  await frame.locator('#out').click();
  await frame.locator('#js').click();
  await expect(text(page)).toContainText('A Hare one day ridiculed');
  expect(page.url()).not.toContain('beacon');
  expect(await traces(page)).toEqual([]);
  expect(outside).toEqual([]);
});

test("a hostile book's link inside the book goes to its chapter", async ({ page }) => {
  const { outside } = await openHostileBook(page);
  const frame = await frameOf(page);
  await expect(text(page)).toContainText('Go to the calm chapter');
  await frame.locator('#inside').click();
  await expect(text(page)).toContainText('Slow but steady wins the race.');
  await expect(page.getByText('2 of 2')).toBeVisible();
  expect(await traces(page)).toEqual([]);
  expect(outside).toEqual([]);
});

test("the chapter's frame refuses a script and a picture on another site even were one to get in", async ({
  page,
}) => {
  const { outside } = await openHostileBook(page);
  await expect(text(page)).toContainText('A Hare one day ridiculed');
  const frame = await frameOf(page);
  // Put in by the test, past the reader's cleaning: only the frame's own policy stands in their way.
  await frame.evaluate((origin) => {
    const script = document.createElement('script');
    script.textContent = "window.parent.__hostileRan = 'slipped in';";
    document.body.append(script);
    const image = document.createElement('img');
    image.src = `${origin}/slipped-in.png`;
    document.body.append(image);
  }, HOSTILE_ORIGIN);
  await expect
    .poll(() => frame.evaluate(() => [...document.images].every((image) => image.complete)))
    .toBe(true);
  expect(await traces(page)).toEqual([]);
  expect(outside).toEqual([]);
});
