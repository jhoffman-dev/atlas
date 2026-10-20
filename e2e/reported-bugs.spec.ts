import { expect, test, type Page } from './fixtures.ts';
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

/**
 * Puts the caret at the end of the line with this text, and waits until the
 * editor holds it there (#445).
 *
 * The click lands at the line's start on purpose: where a click lands is not
 * to be relied on, so the key that follows must take the caret to the end
 * from anywhere on the line. End does not: in WebKit on macOS it scrolls and
 * leaves the caret where it was. ⌘→ is the Mac's end of line.
 *
 * And the key alone is not enough. For 20 ms after it is focused, ProseMirror
 * puts its own selection back on the page unless it has read the page's by
 * then; under load the caret the key moved is put back at the note's start,
 * and the Enter and the command after it land there. So the editor's own
 * selection is what is waited on, and the key pressed again if it was undone
 * (at the line's end it changes nothing).
 */
async function caretAtLineEnd(page: Page, text: string) {
  await page.getByText(text).click({ position: { x: 1, y: 5 } });
  await expect(async () => {
    await page.keyboard.press('Meta+ArrowRight');
    expect(await editorCaret(page)).toEqual({ line: text, offset: text.length });
  }).toPass({ timeout: 5_000 });
}

/** Where the note's editor has its caret: the text of that line and the offset in it. */
function editorCaret(page: Page) {
  return page.getByLabel('Note', { exact: true }).evaluate((element) => {
    // Tiptap hangs the editor on its element; its selection is not in the DOM.
    const { selection } = (
      element as HTMLElement & {
        editor: {
          state: {
            selection: { $head: { parent: { textContent: string }; parentOffset: number } };
          };
        };
      }
    ).editor.state;
    return { line: selection.$head.parent.textContent, offset: selection.$head.parentOffset };
  });
}

test('typing after a slash command puts the text where the cursor is', async ({ page }) => {
  const vault = await openNote(page, 'start\n');

  await caretAtLineEnd(page, 'start');
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

  await caretAtLineEnd(page, 'start');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/head');
  await page.getByRole('listbox', { name: 'Insert block' }).waitFor();
  await page.keyboard.press('Enter');
  await page.keyboard.type('A title');

  await saveNow(page);
  await expectSaved(page);

  expect(await vault.read('note.md')).toBe('start\n\n# A title\n');
});
