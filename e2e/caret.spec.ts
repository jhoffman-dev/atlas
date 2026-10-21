import { expect, test } from './fixtures.ts';
import { createVault, installHost } from './host.ts';
import { caretAtLineEnd, caretAtLineStart } from './caret.ts';
import type { Page } from '@playwright/test';

/** The helpers in caret.ts, on the lines around and inside a table (#489). */
const NOTE = [
  '# Tables',
  '',
  'Above the table.',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  'Below the table.',
  '',
].join('\n');

async function openNote(page: Page): Promise<void> {
  const vault = await createVault();
  await vault.write('tables.md', NOTE);
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await page.getByRole('treeitem', { name: 'tables', exact: true }).click();
  await expect(page.locator('.editor table')).toBeVisible();
}

test('the caret reaches the end and start of the lines next to and inside a table', async ({
  page,
}) => {
  await openNote(page);
  const above = page.getByText('Above the table.');
  const below = page.getByText('Below the table.');
  const cell = page.locator('.editor td p').filter({ hasText: /^1$/ });

  await caretAtLineEnd(above);
  await page.keyboard.type('!');
  await expect(above).toHaveText('Above the table.!');

  await caretAtLineStart(below);
  await page.keyboard.type('>');
  await expect(page.getByText('Below the table.')).toHaveText('>Below the table.');

  await caretAtLineEnd(cell);
  await page.keyboard.type('0');
  await expect(page.locator('.editor td p').filter({ hasText: /^10$/ })).toHaveCount(1);
});

test('the caret still reaches the line when the editor puts its old caret back after the click', async ({
  page,
}) => {
  await openNote(page);
  // What ProseMirror's focus handler does when it loses the race with the
  // click (#489): it puts the selection it had — the note's start — back on
  // the page. Done once, on the first click's mouseup, so it always loses.
  await page.getByLabel('Note', { exact: true }).evaluate((editor) => {
    editor.addEventListener(
      'mouseup',
      () => {
        const heading = editor.querySelector('h1')?.firstChild;
        if (!heading) throw new Error('the note has no heading');
        document.getSelection()?.collapse(heading, 0);
        (window as { caretPutBack?: boolean }).caretPutBack = true;
      },
      { once: true },
    );
  });
  const above = page.getByText('Above the table.');

  await caretAtLineEnd(above);
  await page.keyboard.type('!');

  expect(await page.evaluate(() => (window as { caretPutBack?: boolean }).caretPutBack)).toBe(true);
  await expect(above).toHaveText('Above the table.!');
  await expect(page.getByRole('heading', { name: 'Tables', level: 1 })).toBeVisible();
});
