// Editing in place, wired to the app (#300): a cell's editor writes the
// note it came from, typed by the column's kind, and a picker is one of the
// pane's popups under the one-overlay rule.
import { expect, test, type Page } from './fixtures.ts';
import { createVault, expectFile, installHost, sidebarSection } from './host.ts';
import { pickSuggestion } from './link-suggest.ts';

const TASK_TYPE = [
  '---',
  'name: task',
  'properties:',
  '  status:',
  '    kind: select',
  '    options: [backlog, doing, done]',
  '  owner:',
  '    kind: relation',
  '    target: person',
  '  phase: number',
  '---',
  '',
].join('\n');

const PERSON_TYPE = ['---', 'name: person', 'properties: {}', '---', ''].join('\n');

const VIEW = [
  '---',
  'atlas: view',
  'type: task',
  'columns: [status, owner, phase]',
  'sorts:',
  '  - key: phase',
  '    direction: asc',
  '---',
  '',
  '# Payroll tasks',
  '',
].join('\n');

const FIRST = [
  '---',
  'type: task',
  'status: doing',
  'phase: 1 # set at kickoff',
  '---',
  '',
  '# Run the Larkspur Payroll',
  '',
  'Body text that stays exactly as written.',
  '',
].join('\n');

async function openTable(page: Page) {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/views');
  await vault.mkdir('people');
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  await vault.write('.atlas/types/person.md', PERSON_TYPE);
  await vault.write('.atlas/views/Payroll tasks.md', VIEW);
  await vault.write('first.md', FIRST);
  await vault.write('people/Mara Quill.md', '---\ntype: person\n---\n\n# Mara Quill\n');
  await vault.write('people/Tobias Fenn.md', '---\ntype: person\n---\n\n# Tobias Fenn\n');
  await installHost(page, vault);

  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  await sidebarSection(page, 'views')
    .getByRole('button', { name: 'Payroll tasks', exact: true })
    .click();
  await expect(statusCell(page)).toBeVisible();
  return vault;
}

const statusCell = (page: Page) => page.locator('.table [data-cell-stop="status"]').first();
const picker = (page: Page, label: string) => page.getByRole('dialog', { name: `Set ${label}` });

test('a status set by its number key writes that option, and only that line', async ({ page }) => {
  const vault = await openTable(page);
  await statusCell(page).click();
  await expect(picker(page, 'Status')).toBeVisible();
  await page.keyboard.press('3');

  await expectFile(vault, 'first.md').toBe(FIRST.replace('status: doing', 'status: done'));
  await expect(picker(page, 'Status')).toHaveCount(0);
  await expect(statusCell(page)).toBeFocused();
  await expect(statusCell(page)).toHaveText(/Done/);
});

test('a relation linked from its picker writes the link into the note', async ({ page }) => {
  const vault = await openTable(page);
  await page.locator('.table [data-cell-stop="owner"]').first().click();
  const relation = picker(page, 'Owner');
  await expect(relation).toBeVisible();
  await pickSuggestion(relation.getByRole('combobox'), 'Mara Quill');

  await expectFile(vault, 'first.md').toMatch(/^owner: .*\[\[Mara Quill\]\]/m);
  const written = await vault.read('first.md');
  // Byte-preserving: the comment on phase and the body are as they were.
  expect(written).toContain('phase: 1 # set at kickoff');
  expect(written).toContain('Body text that stays exactly as written.');
});

test('Esc closes the picker with nothing written, and the cell has the focus back', async ({
  page,
}) => {
  const vault = await openTable(page);
  await statusCell(page).click();
  await expect(picker(page, 'Status')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker(page, 'Status')).toHaveCount(0);
  await expect(statusCell(page)).toBeFocused();

  // A later edit lands; had Esc written anything, the status would have moved too.
  await page.locator('.table [data-cell-stop="phase"]').first().click();
  const input = page.locator('.table__input');
  await input.fill('2');
  await input.press('Enter');
  await expectFile(vault, 'first.md').toContain('phase: 2');
  expect(await vault.read('first.md')).toContain('status: doing');
});
