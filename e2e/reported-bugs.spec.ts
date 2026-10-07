import { expect, test, type Page } from '@playwright/test';
import { createVault, expectSaved, installHost, saveNow } from './host.ts';

async function openNote(page: Page, contents: string) {
  const vault = await createVault();
  await vault.write('note.md', contents);
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await page.getByRole('treeitem', { name: 'note', exact: true }).click();
  await expect(page.getByRole('article', { name: 'note' })).toBeVisible();
  return vault;
}

// U-01: spacing between task list items is double what it should be.
test('task list items are spaced like list items, not paragraphs', async ({ page }) => {
  await openNote(page, '- [ ] first\n- [x] second\n- [ ] third\n');

  const gaps = await page.locator('ul[data-type="taskList"] li').evaluateAll((items) =>
    items.map((item) => {
      const paragraph = item.querySelector('p');
      const style = paragraph === null ? null : getComputedStyle(paragraph);
      return {
        top: style === null ? -1 : parseFloat(style.marginTop),
        bottom: style === null ? -1 : parseFloat(style.marginBottom),
      };
    }),
  );

  expect(gaps.length).toBe(3);
  // The paragraph inside a task item must not add its own block margins on top
  // of the list's spacing; that is what makes the gap look doubled.
  for (const gap of gaps) {
    expect(gap.top).toBe(0);
    expect(gap.bottom).toBe(0);
  }
});

test('a plain bullet list and a task list are spaced the same', async ({ page }) => {
  // A paragraph between them, or markdown reads it as one continuing list.
  await openNote(page, '- one\n- two\n\nbetween\n\n- [ ] task one\n- [x] task two\n');

  const spacing = async (selector: string) =>
    page.locator(selector).evaluate((list) => {
      const items = [...list.querySelectorAll(':scope > li')];
      if (items.length < 2) return -1;
      const first = items[0]!.getBoundingClientRect();
      const second = items[1]!.getBoundingClientRect();
      return Math.round(second.top - first.bottom);
    });

  const bullets = await spacing('.ProseMirror ul:not([data-type="taskList"])');
  const tasks = await spacing('.ProseMirror ul[data-type="taskList"]');
  expect(Math.abs(tasks - bullets)).toBeLessThanOrEqual(2);
});

// U-02: after the '/' command the cursor sits one character ahead of the text.
/**
 * The caret itself cannot be measured reliably here: WebKit reports an empty rect
 * for a collapsed selection at an element boundary, which is where it sits while a
 * command is open. What went wrong is measurable though — the decoration around the
 * half-typed text was styled as a full-width padded box, which is what threw the
 * caret to the start of the line.
 */
async function decorationBox(page: Page) {
  return page.evaluate(() => {
    const span = document.querySelector('.editor p span');
    if (span === null) return null;
    const style = getComputedStyle(span);
    return {
      display: style.display,
      padding: style.padding,
      width: Math.round(span.getBoundingClientRect().width),
      paragraphWidth: Math.round(span.closest('p')!.getBoundingClientRect().width),
    };
  });
}

test('the text of a half-typed command stays ordinary inline text', async ({ page }) => {
  await openNote(page, 'start\n');

  await page.getByText('start').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/qu');
  await page.getByRole('listbox', { name: 'Insert block' }).waitFor();

  const box = await decorationBox(page);
  expect(box).not.toBeNull();
  expect(box?.display).toBe('inline');
  expect(box?.padding).toBe('0px');
  expect(box?.width ?? 0).toBeLessThan((box?.paragraphWidth ?? 0) / 2);
});

test('the same holds for a wiki link being typed', async ({ page }) => {
  await openNote(page, 'start\n');

  await page.getByText('start').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' [[No');
  await page.getByRole('listbox', { name: 'Link to note' }).waitFor();

  const box = await decorationBox(page);
  expect(box?.display).toBe('inline');
  expect(box?.padding).toBe('0px');
  expect(box?.width ?? 0).toBeLessThan((box?.paragraphWidth ?? 0) / 2);
});

test('typing after a slash command puts the text where the cursor is', async ({ page }) => {
  const vault = await openNote(page, 'start\n');

  await page.getByText('start').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/quote');
  await page.getByRole('listbox', { name: 'Insert block' }).waitFor();
  await page.keyboard.press('Enter');

  await page.keyboard.type('hello');
  await saveNow(page);
  await expectSaved(page);

  // No stray '/' and no character out of order.
  expect(await vault.read('note.md')).toBe('start\n\n> hello\n');
});

test('a slash-inserted heading takes the text that follows it', async ({ page }) => {
  const vault = await openNote(page, 'start\n');

  await page.getByText('start').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/head');
  await page.getByRole('listbox', { name: 'Insert block' }).waitFor();
  await page.keyboard.press('Enter');
  await page.keyboard.type('A title');

  await saveNow(page);
  await expectSaved(page);

  expect(await vault.read('note.md')).toBe('start\n\n# A title\n');
});
