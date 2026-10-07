import { expect, test, type Page } from '@playwright/test';
import { createVault, expectFile, installHost, sidebarSection } from './host.ts';
import { dragCardTo, dragWithKeyboard } from './drag.ts';

const TASK_TYPE = [
  '---',
  'name: task',
  'properties:',
  '  status:',
  '    kind: select',
  '    options: [backlog, doing, done]',
  '  phase: number',
  '---',
  '',
].join('\n');

const BOARD = [
  '---',
  'atlas: view',
  'type: task',
  'layout: board',
  'groupBy: status',
  'columns: [status, phase]',
  'limit: 50',
  '---',
  '',
  '# Board',
  '',
].join('\n');

const task = (title: string, status: string) =>
  ['---', 'type: task', `status: ${status}`, 'phase: 1', '---', '', `# ${title}`, ''].join('\n');

async function openBoard(page: Page) {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/views');
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  await vault.write('.atlas/views/Board.md', BOARD);
  await vault.write('first.md', task('First', 'backlog'));
  await vault.write('second.md', task('Second', 'doing'));

  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();

  await sidebarSection(page, 'views').getByRole('button', { name: 'Board', exact: true }).click();
  return vault;
}

const cardHandle = (page: Page, title: string) =>
  page.getByRole('button', { name: title, exact: true });

test('a board shows a column per status, with the cards in them', async ({ page }) => {
  await openBoard(page);

  await expect(page.getByRole('region', { name: 'backlog' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'doing' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'done' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'first', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'second', exact: true })).toBeVisible();
});

test('dragging a card writes the new status into its file', async ({ page }) => {
  const vault = await openBoard(page);
  await page.locator('[data-path="first.md"]').waitFor();

  await dragCardTo(page, 'first.md', 'done');

  await expectFile(vault, 'first.md').toContain('status: done');
  // And the note itself is otherwise untouched.
  expect(await vault.read('first.md')).toContain('# First');
});

test('a card can be moved to another column with the keyboard alone', async ({ page }) => {
  const vault = await openBoard(page);

  // backlog → doing → done: two presses, so a card that moved only once, or
  // not at all, leaves a different status in the file.
  await dragWithKeyboard(page, cardHandle(page, 'first'), ['ArrowRight', 'ArrowRight']);

  await expectFile(vault, 'first.md').toContain('status: done');
  expect(await vault.read('first.md')).toContain('# First');
  // The card is drawn anew in done; focus goes with it, so the next Tab
  // carries on from the card rather than from the top of the page.
  await expect(
    page.getByRole('region', { name: 'done' }).getByRole('button', { name: 'first', exact: true }),
  ).toBeFocused();
});

test('escape puts a keyboard-held card down without writing anything', async ({ page }) => {
  const vault = await openBoard(page);

  await dragWithKeyboard(page, cardHandle(page, 'first'), ['ArrowRight', 'ArrowRight'], {
    finish: 'Escape',
  });
  // A write that is known to happen, made after the cancel: once it has
  // landed, one the cancel made would have landed too.
  await dragWithKeyboard(page, cardHandle(page, 'second'), ['ArrowRight']);
  await expectFile(vault, 'second.md').toContain('status: done');

  expect(await vault.read('first.md')).toContain('status: backlog');
});

test('clicking a card after dragging another still opens it', async ({ page }) => {
  const vault = await openBoard(page);
  await dragCardTo(page, 'second.md', 'done');
  await expectFile(vault, 'second.md').toContain('status: done');

  await page.getByRole('button', { name: 'first', exact: true }).click();
  await expect(page.getByRole('article', { name: 'first' })).toBeVisible();
});

test('adding a card puts it in the column it was added to', async ({ page }) => {
  const vault = await openBoard(page);

  await page.getByRole('button', { name: 'Add to doing' }).click();
  const input = page.getByRole('textbox', { name: 'New card in doing' });
  await input.fill('A new card');
  await input.press('Enter');

  await expectFile(vault, 'A new card.md').toContain('status: doing');
  expect(await vault.read('A new card.md')).toContain('type: task');
});

test('a card opens the note behind it', async ({ page }) => {
  await openBoard(page);

  await page.getByRole('button', { name: 'first', exact: true }).click();
  await expect(page.getByRole('article', { name: 'first' })).toBeVisible();
});

test('a note can be renamed from its pane', async ({ page }) => {
  const vault = await openBoard(page);

  await page.getByRole('button', { name: 'first', exact: true }).click();
  await expect(page.getByRole('article', { name: 'first' })).toBeVisible();

  await page
    .getByRole('article', { name: 'first' })
    .getByRole('button', { name: 'first', exact: true })
    .click();
  const input = page.getByRole('textbox', { name: 'Note name' });
  await input.fill('Renamed task');
  await input.press('Enter');

  await expectFile(vault, 'Renamed task.md').toContain('# First');
  await expect(page.getByRole('article', { name: 'Renamed task' })).toBeVisible();
});

// Reported: the board is squeezed into a narrow column and there is no usable
// way to add a card.
test('the board uses the width of the window, not the width of prose', async ({ page }) => {
  await openBoard(page);
  await page.locator('[data-path="first.md"]').waitFor();

  const measured = await page.evaluate(() => {
    const board = document.querySelector('.board');
    const main = document.querySelector('.shell__main');
    if (board === null || main === null) return null;
    return {
      board: Math.round(board.getBoundingClientRect().width),
      available: Math.round(main.getBoundingClientRect().width),
    };
  });

  expect(measured).not.toBeNull();
  // Prose is capped at 78ch, about 700px. A board must not be.
  expect(measured?.board ?? 0).toBeGreaterThan((measured?.available ?? 0) * 0.8);
});

test('the board fills the height available to it', async ({ page }) => {
  await openBoard(page);
  await page.locator('[data-path="first.md"]').waitFor();

  const measured = await page.evaluate(() => {
    const column = document.querySelector('.board__column');
    const main = document.querySelector('.shell__main');
    if (column === null || main === null) return null;
    return {
      column: Math.round(column.getBoundingClientRect().height),
      available: Math.round(main.getBoundingClientRect().height),
    };
  });

  expect(measured?.column ?? 0).toBeGreaterThan((measured?.available ?? 0) * 0.5);
});

test('a card can be added with a name, from the column', async ({ page }) => {
  const vault = await openBoard(page);
  await page.locator('[data-path="first.md"]').waitFor();

  await page.getByRole('button', { name: 'Add to doing' }).click();
  const input = page.getByRole('textbox', { name: 'New card in doing' });
  await input.fill('Write the release notes');
  await input.press('Enter');

  await expectFile(vault, 'Write the release notes.md').toContain('status: doing');
  // Exact, and inside the column: once the sidebar catches up with the new note
  // its favourites star matches this name too, and a loose locator then fails
  // for a reason that has nothing to do with the board.
  await expect(
    page
      .getByRole('region', { name: 'doing' })
      .getByRole('button', { name: 'Write the release notes', exact: true }),
  ).toBeVisible();
});

test('adding another card keeps the field open for the next one', async ({ page }) => {
  const vault = await openBoard(page);
  await page.locator('[data-path="first.md"]').waitFor();

  await page.getByRole('button', { name: 'Add to backlog' }).click();
  const input = page.getByRole('textbox', { name: 'New card in backlog' });
  await input.fill('First idea');
  await input.press('Enter');
  await input.fill('Second idea');
  await input.press('Enter');

  await expectFile(vault, 'First idea.md').toContain('status: backlog');
  await expectFile(vault, 'Second idea.md').toContain('status: backlog');
});

test('escape closes the add field without making a card', async ({ page }) => {
  await openBoard(page);
  await page.locator('[data-path="first.md"]').waitFor();

  await page.getByRole('button', { name: 'Add to doing' }).click();
  await page.getByRole('textbox', { name: 'New card in doing' }).press('Escape');

  await expect(page.getByRole('textbox', { name: 'New card in doing' })).toHaveCount(0);
});
