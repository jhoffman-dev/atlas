import { expect, test, type Page } from '@playwright/test';
import { createVault, installHost } from './host.ts';

/**
 * #130, in WebKit: the Inbox's offers are read once it opens, and one that
 * lands above rows already drawn pushes them down, so a click aimed at a row
 * falls on something else. Here the tidy's read of the one loose note is held
 * until the rows are on screen; letting it go must not move them, and a click
 * where a row was must open that row.
 */

const ROWS = 4;

async function openVault(page: Page) {
  const vault = await createVault();
  await vault.mkdir('Inbox');
  for (let n = 1; n <= ROWS; n++) await vault.write(`Inbox/Item ${n}.md`, `Body of item ${n}.\n`);
  // Loose at the root, so the tidy offers to move it to Notes/<year>.
  await vault.write('Loose idea.md', 'A thought.\n');
  const host = await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible({ timeout: 60_000 });
  return host;
}

/** How far, at most, the Inbox row titled `title` moved up or down over the next `frames` frames. */
function largestMove(page: Page, title: string, frames: number): Promise<number> {
  return page.evaluate(
    async ({ title, frames }) => {
      const row = () =>
        [...document.querySelectorAll('.inbox__grid button')].find(
          (button) => button.textContent?.trim() === title,
        );
      const at = () => row()?.getBoundingClientRect().top ?? Number.NaN;
      const start = at();
      let largest = 0;
      for (let frame = 0; frame < frames; frame++) {
        await new Promise((done) => requestAnimationFrame(done));
        largest = Math.max(largest, Math.abs(at() - start));
      }
      return largest;
    },
    { title, frames },
  );
}

test('an offer read after the rows are drawn does not move them, and a click hits the row aimed at (#130)', async ({
  page,
}) => {
  const host = await openVault(page);
  const release = host.holdReads('Loose idea.md');
  await page.getByRole('button', { name: /^Inbox/ }).click();
  const inbox = page.getByRole('article', { name: 'Inbox' });
  const target = inbox.getByRole('button', { name: 'Item 3', exact: true });
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box).not.toBeNull();

  release();
  // The tidy's read is answered now; watch the row while the app takes it in.
  expect(await largestMove(page, 'Item 3', 60)).toBe(0);
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(page.getByText('Body of item 3.')).toBeVisible();

  // The offer that was read late is there the next time the Inbox opens.
  await page.getByRole('button', { name: /^Inbox/ }).click();
  await expect(page.getByRole('region', { name: 'Tidy the vault' })).toBeVisible();
});
