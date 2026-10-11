/**
 * Live query blocks (P30-05): `/query` on a person's page makes a block
 * whose query names the page as `this`; it shows that person's meetings,
 * follows its text as it is edited, is asked again when a meeting arrives
 * from another app, and is written as a fenced `atlas-query` block — which a
 * save of the page's other words leaves byte for byte. The compiled
 * statement runs for real against SQLite in the stand-in host.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  createVault,
  emitVaultChanged,
  expectFile,
  expectSaved,
  installHost,
  saveNow,
  sidebarSection,
  type FakeVault,
} from './host.ts';

const front = (lines: string[], body: string) => ['---', ...lines, '---', '', body, ''].join('\n');

const MEETING_TYPE = front(
  [
    'name: meeting',
    'label: Meeting',
    'properties:',
    '  people:',
    '    kind: relation',
    '    target: person',
    '    many: true',
  ],
  '# Meeting',
);
const PERSON_TYPE = front(['name: person', 'label: Person'], '# Person');

const meeting = (...people: string[]) =>
  front(['type: meeting', `people: [${people.map((name) => `"[[${name}]]"`).join(', ')}]`], '');

/** Tobias's page, as another app wrote it: a query block between two paragraphs. */
const TOBIAS_BODY =
  '# Tobias Fenn\n\nWorks on payroll at Larkspur Payroll.\n\n' +
  '~~~atlas-query\nlayout: list\nFROM meeting WHERE people = this SORT BY title\n~~~\n\n' +
  'Prefers mornings.\n';

async function openVault(page: Page): Promise<FakeVault> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const vault = await createVault();
  for (const folder of ['.atlas/types', 'people', 'meetings']) await vault.mkdir(folder);
  await vault.write('.atlas/types/meeting.md', MEETING_TYPE);
  await vault.write('.atlas/types/person.md', PERSON_TYPE);
  await vault.write(
    'people/Mara Quill.md',
    front(['type: person'], '# Mara Quill\n\nMeets weekly.'),
  );
  await vault.write('people/Tobias Fenn.md', front(['type: person'], TOBIAS_BODY.trimEnd()));
  await vault.write('meetings/Kickoff.md', meeting('Mara Quill'));
  await vault.write('meetings/Retro.md', meeting('Tobias Fenn'));
  await vault.write('meetings/Review.md', meeting('Mara Quill', 'Tobias Fenn'));

  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

async function openPerson(page: Page, name: string) {
  const pages = sidebarSection(page, 'userSpace');
  await pages.getByRole('treeitem', { name: 'people', exact: true }).click();
  await pages.getByRole('treeitem', { name, exact: true }).click();
  await expect(page.getByRole('article', { name })).toBeVisible();
}

const block = (page: Page) => page.getByRole('group', { name: 'Query block' });
const titles = (page: Page) => block(page).locator('.qresult__title, .list-view__title');

test('a query block added to a page shows its meetings, follows its text and the vault, and is written as a fence', async ({
  page,
}) => {
  const vault = await openVault(page);
  await openPerson(page, 'Mara Quill');

  // `/query` on a new line makes the block, open at its text.
  await page.getByLabel('Note', { exact: true }).getByText('Meets weekly.').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/query');
  const commands = page.getByRole('listbox', { name: 'Insert block' });
  await expect(commands.getByRole('option', { name: /^Query/ })).toBeVisible();
  await page.keyboard.press('Enter');
  const text = block(page).getByRole('textbox', { name: 'Query text' });
  await expect(text).toBeFocused();
  await page.keyboard.type('FROM meeting WHERE people = this SORT BY title');

  // `this` is Mara's page: her meetings, and not Tobias's alone.
  await expect(titles(page)).toHaveText(['Kickoff', 'Review']);
  await expect(block(page).getByRole('table')).toBeVisible();

  await block(page).getByRole('button', { name: 'Done' }).click();
  await expect(text).toHaveCount(0);
  await saveNow(page);
  await expectSaved(page);
  await expectFile(vault, 'people/Mara Quill.md').toBe(
    front(
      ['type: person'],
      '# Mara Quill\n\nMeets weekly.\n\n```atlas-query\nFROM meeting WHERE people = this SORT BY title\n```',
    ),
  );

  // Its text, edited in place, changes what it shows — and how.
  await block(page).getByRole('button', { name: 'Edit query' }).click();
  await text.fill("layout: list\nFROM meeting WHERE people = this AND title != 'Kickoff'");
  await expect(titles(page)).toHaveText(['Review']);
  await expect(block(page).getByRole('list', { name: 'Notes' })).toBeVisible();
  await expect(block(page).getByRole('table')).toHaveCount(0);

  // A problem in it is said, in words, in place of the rows.
  await text.fill('FROM meeting WHERE stauts = done');
  await expect(block(page).getByRole('alert')).toHaveText('A meeting has no field called stauts.');
  await text.fill('FROM meeting WHERE people = this SORT BY title');
  await expect(titles(page)).toHaveText(['Kickoff', 'Review']);

  // A meeting written by another app reaches it once the index hears of it.
  await vault.write('meetings/Standup.md', meeting('Mara Quill'));
  await emitVaultChanged(page, ['meetings/Standup.md']);
  await expect(titles(page)).toHaveText(['Kickoff', 'Review', 'Standup']);

  // A row opens its note.
  await titles(page).filter({ hasText: 'Standup' }).click();
  await expect(page.getByRole('article', { name: 'Standup' })).toBeVisible();
});

test('a query block from another app is shown for its own page and kept byte for byte', async ({
  page,
}) => {
  const vault = await openVault(page);
  await openPerson(page, 'Tobias Fenn');

  // Read from the file: a list of Tobias's meetings, its text out of the way.
  await expect(titles(page)).toHaveText(['Retro', 'Review']);
  await expect(block(page).getByRole('list', { name: 'Notes' })).toBeVisible();
  await expect(block(page).getByRole('textbox', { name: 'Query text' })).toHaveCount(0);

  // The page's other words change; the fence, tildes and all, does not.
  await page.getByLabel('Note', { exact: true }).getByText('Prefers mornings.').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' And tea.');
  await saveNow(page);
  await expectSaved(page);
  await expectFile(vault, 'people/Tobias Fenn.md').toBe(
    front(
      ['type: person'],
      TOBIAS_BODY.replace('Prefers mornings.', 'Prefers mornings. And tea.').trimEnd(),
    ),
  );
});
