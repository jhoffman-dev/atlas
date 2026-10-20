// Attack on PR #425 (#300): editing a saved view's cells in place. Each test
// names one invariant a cell's write must hold for the note it lands in.
import { expect, test, type Page } from './fixtures.ts';
import { createVault, emitVaultChanged, expectFile, installHost, sidebarSection } from './host.ts';
import { pickSuggestion, suggestion } from './link-suggest.ts';

const TASK_TYPE = [
  '---',
  'name: task',
  'properties:',
  '  status:',
  '    kind: select',
  '    options: [backlog, doing, done]',
  '  owners:',
  '    kind: relation',
  '    target: person',
  '    many: true',
  '  tags:',
  '    kind: multiSelect',
  '    options: [red, blue, green]',
  '  phase: number',
  '  note: text',
  '---',
  '',
].join('\n');

const PERSON_TYPE = ['---', 'name: person', 'properties: {}', '---', ''].join('\n');

const VIEW = [
  '---',
  'atlas: view',
  'type: task',
  'columns: [status, owners, tags, phase, note]',
  '---',
  '',
  '# Payroll tasks',
  '',
].join('\n');

const FIRST = [
  '---',
  'type: task',
  'status: doing',
  'owners:',
  '  - "[[Mara Quill]]"',
  '  - "[[Tobias Fenn]]"',
  'tags: [red, blue]',
  'phase: 1 # set at kickoff',
  'note: plain',
  '---',
  '',
  '# Run the Larkspur Payroll',
  '',
  'Body text that stays exactly as written.',
  '',
].join('\n');

async function openTable(page: Page, first = FIRST) {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/views');
  await vault.mkdir('people');
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  await vault.write('.atlas/types/person.md', PERSON_TYPE);
  await vault.write('.atlas/views/Payroll tasks.md', VIEW);
  await vault.write('first.md', first);
  for (const name of ['Mara Quill', 'Tobias Fenn', 'Ada Lim']) {
    await vault.write(`people/${name}.md`, `---\ntype: person\n---\n\n# ${name}\n`);
  }
  await installHost(page, vault);

  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  await sidebarSection(page, 'views')
    .getByRole('button', { name: 'Payroll tasks', exact: true })
    .click();
  await expect(cell(page, 'status')).toBeVisible();
  return vault;
}

const cell = (page: Page, column: string) =>
  page.locator(`.table [data-cell-stop="${column}"]`).first();
const picker = (page: Page, label: string) => page.getByRole('dialog', { name: `Set ${label}` });

test('linking a third note to a many-relation keeps the two it held as two links', async ({
  page,
}) => {
  const vault = await openTable(page);
  await cell(page, 'owners').click();
  const relation = picker(page, 'Owners');
  await expect(relation).toBeVisible();
  await pickSuggestion(relation.getByRole('combobox'), 'Ada Lim');

  await expectFile(vault, 'first.md').toContain('Ada Lim');
  const written = await vault.read('first.md');
  // Three links, each its own list item — not the cell's comma-joined text as one item.
  expect(written).not.toContain('[[Mara Quill]], [[Tobias Fenn]]');
  expect(written).toMatch(
    /- "?\[\[Mara Quill\]\]"?\n\s*- "?\[\[Tobias Fenn\]\]"?\n\s*- "?\[\[Ada Lim\]\]"?/,
  );
});

test('a multi-select edited in its cell stays a list in the note', async ({ page }) => {
  const vault = await openTable(page);
  await cell(page, 'tags').click();
  // Since the fix (#425) a multi-select edits in a picker like a select's:
  // green, its third option, toggled on by its number key beside red and blue.
  await expect(picker(page, 'Tags').getByRole('option', { name: /Red/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('3');

  await expectFile(vault, 'first.md').toContain('green');
  const written = await vault.read('first.md');
  // A list three long, not the scalar text "red, blue, green".
  expect(written).not.toMatch(/^tags: red, blue, green$/m);
  expect(written).toMatch(/^tags: \[red, blue, green\]$|^tags:\n\s+- red\n\s+- blue\n\s+- green$/m);
});

test('a number edited in its cell keeps the comment on its line', async ({ page }) => {
  const vault = await openTable(page);
  await cell(page, 'phase').click();
  const input = page.locator('.table__input');
  await input.fill('2');
  await input.press('Enter');

  await expectFile(vault, 'first.md').toContain('phase: 2');
  expect(await vault.read('first.md')).toBe(
    FIRST.replace('phase: 1 # set at kickoff', 'phase: 2 # set at kickoff'),
  );
});

test('a cell edited in a CRLF note changes only its line and keeps CRLF', async ({ page }) => {
  const crlf = FIRST.replaceAll('\n', '\r\n');
  const vault = await openTable(page, crlf);
  await cell(page, 'note').click();
  const input = page.locator('.table__input');
  await input.fill('café — 日本語 🌱');
  await input.press('Enter');

  await expectFile(vault, 'first.md').toContain('café');
  expect(await vault.read('first.md')).toBe(crlf.replace('note: plain', 'note: café — 日本語 🌱'));
});

test('a status changed by another program while its picker is open is not written over', async ({
  page,
}) => {
  const vault = await openTable(page);
  await cell(page, 'status').click();
  await expect(picker(page, 'Status')).toBeVisible();

  await vault.write('first.md', FIRST.replace('status: doing', 'status: backlog'));
  await emitVaultChanged(page, ['first.md']);
  await expect(
    page
      .locator('.table')
      .getByText(/Backlog/)
      .first(),
  ).toBeVisible();

  await page.keyboard.press('3');
  await expect(page.getByRole('alert')).toContainText(/changed while it was being edited/);
  expect(await vault.read('first.md')).toContain('status: backlog');
});

test('removing one link from a many-relation keeps the other', async ({ page }) => {
  const vault = await openTable(page);
  await cell(page, 'owners').click();
  const relation = picker(page, 'Owners');
  await expect(relation).toBeVisible();
  await relation.getByRole('button', { name: /^Remove Mara Quill/ }).click();

  await expectFile(vault, 'first.md').not.toContain('Mara Quill');
  expect(await vault.read('first.md')).toContain('[[Tobias Fenn]]');
});

test('a many-relation picker does not offer a note already linked', async ({ page }) => {
  await openTable(page);
  await cell(page, 'owners').click();
  const field = picker(page, 'Owners').getByRole('combobox');
  // The picker's field suggests what is not linked yet.
  await field.click();
  await expect(suggestion(field, 'Ada Lim')).toHaveCount(1);
  await expect(suggestion(field, 'Tobias Fenn')).toHaveCount(0);
});

test('a cell edited again while its last commit is read back is not refused as changed', async ({
  page,
}) => {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/views');
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  await vault.write('.atlas/views/Payroll tasks.md', VIEW);
  await vault.write('first.md', FIRST);
  const host = await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  await sidebarSection(page, 'views')
    .getByRole('button', { name: 'Payroll tasks', exact: true })
    .click();
  await expect(cell(page, 'note')).toBeVisible();

  // The reader's own commit, with the spaces a paste brings; its write held.
  const release = host.holdWrites('first.md');
  await cell(page, 'note').click();
  await page.locator('.table__input').fill('  padded  ');
  await page.locator('.table__input').press('Enter');

  // Edited again while the commit is still drawn as pending; the read-back lands meanwhile.
  await cell(page, 'note').click();
  await page.locator('.table__input').fill('second');
  const reads = host.callsTo('read_notes');
  release();
  await expectFile(vault, 'first.md').toContain('padded');
  await expect.poll(() => host.callsTo('read_notes')).toBeGreaterThan(reads);
  await page.locator('.table__input').press('Enter');

  await expectFile(vault, 'first.md').toMatch(/note: "?second"?/);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a repeating task set to done in its cell rolls on once', async ({ page }) => {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/views');
  await vault.write(
    '.atlas/types/task.md',
    TASK_TYPE.replace('  phase: number', '  phase: number\n  due: date\n  recurrence: text'),
  );
  await vault.write(
    '.atlas/views/Payroll tasks.md',
    VIEW.replace('columns: [status, owners, tags, phase, note]', 'columns: [status, due]'),
  );
  await vault.write(
    'first.md',
    FIRST.replace('note: plain', 'note: plain\ndue: 2026-09-20\nrecurrence: weekly'),
  );
  const host = await installHost(page, vault, { echoWrites: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  await sidebarSection(page, 'views')
    .getByRole('button', { name: 'Payroll tasks', exact: true })
    .click();
  await cell(page, 'status').click();
  await expect(picker(page, 'Status')).toBeVisible();
  await page.keyboard.press('3');
  await page.keyboard.press('3');

  await expectFile(vault, 'first.md').toContain('due: 2026-09-27');
  await expect(cell(page, 'status')).toHaveText(/Backlog/);
  await expect.poll(() => host.echoesSent()).toBeGreaterThan(0);
  await expect(cell(page, 'due')).toHaveText(/27/);
  expect(host.writesTo('first.md')).toBe(1);
  expect(await vault.read('first.md')).toContain('status: backlog');
});

test('a cell committed after another program changed another line keeps that line', async ({
  page,
}) => {
  const vault = await openTable(page);
  await cell(page, 'note').click();
  await page.locator('.table__input').fill('mine');
  // Changed on disk, not yet heard by the watcher.
  const theirs = FIRST.replace('phase: 1 # set at kickoff', 'phase: 5 # theirs');
  await vault.write('first.md', theirs);
  await page.locator('.table__input').press('Enter');

  await expectFile(vault, 'first.md').toContain('note: mine');
  expect(await vault.read('first.md')).toBe(theirs.replace('note: plain', 'note: mine'));
});

test('a cell emptied takes its key out and leaves the rest as it was', async ({ page }) => {
  const vault = await openTable(page);
  await cell(page, 'phase').click();
  await page.locator('.table__input').fill('');
  await page.locator('.table__input').press('Enter');

  await expectFile(vault, 'first.md').not.toContain('phase:');
  expect(await vault.read('first.md')).toBe(FIRST.replace('phase: 1 # set at kickoff\n', ''));
});

test('Tab across a row writes each cell typed, in one note, none lost', async ({ page }) => {
  const vault = await openTable(page);
  await cell(page, 'phase').click();
  await page.locator('.table__input').fill('7');
  await page.keyboard.press('Tab');
  await page.locator('.table__input').fill('tabbed');
  await page.keyboard.press('Enter');

  await expectFile(vault, 'first.md').toContain('note: tabbed');
  const written = await vault.read('first.md');
  expect(written).toContain('phase: 7 # set at kickoff');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
