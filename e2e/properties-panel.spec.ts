/**
 * U-09 track 1, as James met it: "Add a property" on a note of a type saved
 * nothing he could see and offered no kind, and a relation set to "Several
 * notes" still linked only one.
 */
import { expect, test, type Page } from '@playwright/test';
import { createVault, expectFile, installHost, type FakeVault } from './host.ts';

const BOOK_TYPE = '---\nname: book\nlabel: Book\nproperties:\n  author: text\n---\n';

const TASK_TYPE = [
  '---',
  'name: task',
  'label: Task',
  'properties:',
  '  status:',
  '    kind: select',
  '    options: [next, done]',
  '---',
  '',
].join('\n');

async function open(page: Page, files: Record<string, string>): Promise<FakeVault> {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  for (const [path, text] of Object.entries(files)) await vault.write(path, text);
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

const properties = (page: Page) => page.getByRole('region', { name: 'Properties' });

async function openNote(page: Page, name: string) {
  await page.getByRole('treeitem', { name, exact: true }).click();
  await expect(page.getByRole('article', { name })).toBeVisible();
}

test.describe('Add a property on a note of a type', () => {
  const files = {
    '.atlas/types/book.md': BOOK_TYPE,
    'Dune.md': '---\ntype: book\n---\n\n# Dune\n',
    'Emma.md': '---\ntype: book\n---\n\n# Emma\n',
  };

  test('adds it to the type by default: a kind chosen, on every book, and its value saved', async ({
    page,
  }) => {
    const vault = await open(page, files);
    await openNote(page, 'Dune');

    await properties(page).getByRole('button', { name: 'Add a property' }).click();
    const popover = page.getByRole('dialog', { name: 'Add a property' });
    await popover.getByRole('textbox', { name: 'Property name' }).fill('Pages');
    await popover.getByRole('combobox', { name: 'Kind' }).selectOption('number');
    await expect(popover.getByRole('radio', { name: 'Add to Book (every book)' })).toBeChecked();
    await popover.getByRole('button', { name: 'Add property' }).click();

    await expect(popover).toBeHidden();
    await expectFile(vault, '.atlas/types/book.md').toMatch(/\n {2}pages: number\n/);
    // The row is there at once, with a number field, and it has the keyboard.
    const pages = properties(page).getByRole('spinbutton', { name: 'Pages' });
    await expect(pages).toBeFocused();
    await page.keyboard.type('412');
    await expectFile(vault, 'Dune.md').toMatch(/\npages: 412\n/);

    await openNote(page, 'Emma');
    await expect(properties(page).getByRole('spinbutton', { name: 'Pages' })).toBeVisible();
  });

  test('"Only this note" writes a typed default into the note and leaves the type alone', async ({
    page,
  }) => {
    const vault = await open(page, files);
    await openNote(page, 'Dune');

    await properties(page).getByRole('button', { name: 'Add a property' }).click();
    const popover = page.getByRole('dialog', { name: 'Add a property' });
    await popover.getByRole('textbox', { name: 'Property name' }).fill('Signed');
    await popover.getByRole('combobox', { name: 'Kind' }).selectOption('checkbox');
    await popover.getByRole('radio', { name: 'Only this note' }).check();
    await popover.getByRole('textbox', { name: 'Property name' }).press('Enter');

    await expectFile(vault, 'Dune.md').toMatch(/\nsigned: false\n/);
    const signed = properties(page).getByRole('checkbox', { name: 'Signed' });
    await expect(signed).toBeFocused();
    await signed.click();
    await expectFile(vault, 'Dune.md').toMatch(/\nsigned: true\n/);
    expect(await vault.read('.atlas/types/book.md')).toBe(BOOK_TYPE);
  });

  test('refuses a key Atlas keeps for itself', async ({ page }) => {
    await open(page, files);
    await openNote(page, 'Dune');

    await properties(page).getByRole('button', { name: 'Add a property' }).click();
    const popover = page.getByRole('dialog', { name: 'Add a property' });
    await popover.getByRole('textbox', { name: 'Property name' }).fill('modified');
    await expect(popover.getByRole('alert')).toBeVisible();
    await expect(popover.getByRole('button', { name: 'Add property' })).toBeDisabled();
  });
});

test('a relation to several tasks, set up in the type editor, links two and keeps both', async ({
  page,
}) => {
  const vault = await open(page, {
    '.atlas/types/task.md': TASK_TYPE,
    'Write report.md': '---\ntype: task\nstatus: next\n---\n\n# Write report\n',
    'Book flights.md': '---\ntype: task\nstatus: next\n---\n\n# Book flights\n',
  });

  await page
    .getByRole('region', { name: 'Types' })
    .getByRole('button', { name: 'New type' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'New type' });
  await dialog.getByRole('textbox', { name: 'Type name' }).fill('Meeting');
  await dialog.getByRole('button', { name: 'Create type' }).click();
  await expect(dialog).toBeHidden();

  // Each change waits for the type file to have it, so the editor is never
  // being re-read from a file a change behind the one about to be made.
  const typeFile = () => expectFile(vault, '.atlas/types/meeting.md');
  await page.getByRole('button', { name: 'Add property' }).click();
  await typeFile().toMatch(/ {2}property: text\n/);
  await page.getByRole('textbox', { name: 'Name of Property' }).fill('Tasks');
  await page.getByRole('textbox', { name: 'Name of Property' }).press('Enter');
  // Stored under the name it was given, not the placeholder it started as.
  await typeFile().toMatch(/ {2}tasks: text\n/);
  await page.getByRole('combobox', { name: 'Kind of Tasks' }).selectOption('relation');
  await typeFile().toMatch(/ {2}tasks:\n {4}kind: relation\n/);
  await page.getByRole('combobox', { name: 'Type Tasks points at' }).selectOption('task');
  await typeFile().toMatch(/ {4}target: task\n/);
  await page.getByRole('switch', { name: 'Tasks holds several notes' }).click();
  await typeFile().toMatch(/ {2}tasks:\n {4}kind: relation\n {4}target: task\n {4}many: true\n/);

  await page.getByRole('radio', { name: 'Notes' }).click();
  await page.getByRole('button', { name: 'New meeting' }).click();
  const tasks = properties(page).getByRole('combobox', { name: 'Tasks' });
  await expect.poll(() => tasks.locator('option').allTextContents()).toContain('Book flights');
  await tasks.selectOption({ label: 'Write report' });
  // The add control stays, and offers what is not linked yet.
  await tasks.selectOption({ label: 'Book flights' });
  await expectFile(vault, 'New Meeting.md').toMatch(
    /\ntasks:\n {2}- "\[\[Write report\]\]"\n {2}- "\[\[Book flights\]\]"\n/,
  );

  await openNote(page, 'Write report');
  await openNote(page, 'New Meeting');
  const chips = properties(page).getByRole('list', { name: 'Tasks' }).getByRole('listitem');
  await expect(chips).toHaveText(['Write report', 'Book flights']);

  await properties(page).getByRole('button', { name: 'Remove Write report from Tasks' }).click();
  await expectFile(vault, 'New Meeting.md').toMatch(/\ntasks:\n {2}- "\[\[Book flights\]\]"\n/);
  await expect(chips).toHaveText(['Book flights']);
});
