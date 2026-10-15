import { expect, test, type Page } from '@playwright/test';
import {
  createVault,
  emitVaultChanged,
  expectFile,
  expectSaved,
  installHost,
  saveNow,
} from './host.ts';

const ALPHA = '# Alpha\n\nAbout #project/atlas and #idea.\n';
const BETA = '---\ntags: [idea]\n---\n# Beta\n\nMore #Idea here.\n';
const CODE = '# Code\n\nNot a tag: `#idea`.\n';

async function openVault(page: Page, files: Record<string, string>) {
  const vault = await createVault();
  for (const [path, text] of Object.entries(files)) await vault.write(path, text);
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

const openNote = (page: Page, name: string) =>
  page.getByRole('treeitem', { name, exact: true }).click();

const tagTree = (page: Page) => page.getByRole('list', { name: 'Tags', exact: true });
const tagRow = (page: Page, label: string) =>
  tagTree(page).getByRole('button', { name: new RegExp(`^${label} \\d+ uses?$`) });

test('a tag typed with suggestions is counted in the tags page and renamed in every file', async ({
  page,
}) => {
  const vault = await openVault(page, {
    'Alpha.md': ALPHA,
    'Beta.md': BETA,
    'Gamma.md': '# Gamma\n\nNothing yet.\n',
    'Code.md': CODE,
  });

  await openNote(page, 'Gamma');
  await page.getByText('Nothing yet.').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' #id');
  const suggestions = page.getByRole('listbox', { name: 'Tag' });
  // Three uses: Alpha's, and Beta's property and body; the one in code is not a tag.
  await expect(suggestions.getByRole('option', { name: '#idea 3' })).toBeVisible();
  // What was typed comes first, so Enter alone would write `#id`: pick `#idea` below it.
  await expect(suggestions.getByRole('option').first()).toHaveAccessibleName('Create #id New tag');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(suggestions).toHaveCount(0);
  await page.keyboard.type('and #brandnew');
  await expect(suggestions.getByRole('option', { name: /Create #brandnew/ })).toBeVisible();
  // A space on a new word just keeps typing.
  await page.keyboard.type(' too');
  await expect(suggestions).toHaveCount(0);

  // `# ` still starts a heading.
  await page.keyboard.press('Enter');
  await page.keyboard.type('# Later');
  await expect(page.getByRole('heading', { name: 'Later', level: 1 })).toBeVisible();

  await saveNow(page);
  await expectSaved(page);
  await expectFile(vault, 'Gamma.md').toBe(
    '# Gamma\n\nNothing yet. #idea and #brandnew too\n\n# Later\n',
  );
  await emitVaultChanged(page, ['Gamma.md']);

  // A tag in the note is drawn as one, and opens the tags page on it.
  const tagInNote = page.locator('.editor .tag[data-tag="idea"]');
  await expect(tagInNote).toHaveText('#idea');
  await tagInNote.click();
  await expect(page.getByRole('heading', { name: 'Tags', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '#idea', level: 2 })).toBeVisible();
  await expect(tagRow(page, 'idea')).toHaveAccessibleName('idea 4 uses');
  await expect(tagRow(page, 'brandnew')).toHaveAccessibleName('brandnew 1 use');
  // A nested tag sits under its parent, which counts it.
  await expect(tagRow(page, 'project')).toHaveAccessibleName('project 1 use');
  await expect(tagRow(page, 'atlas')).toBeVisible();

  const notes = page.getByRole('list', { name: 'Notes', exact: true });
  await expect(notes.getByRole('button')).toHaveText([/Alpha/, /Beta/, /Gamma/]);

  // By frequency, the most used tag comes first.
  await page.getByRole('radio', { name: 'Frequency' }).click();
  await expect(tagTree(page).getByRole('button').first()).toHaveAccessibleName('idea 4 uses');

  await page.getByRole('button', { name: 'Rename' }).click();
  const form = page.getByRole('form', { name: 'Rename #idea' });
  await form.getByLabel('New name').fill('thought');
  await form.getByRole('button', { name: 'Preview' }).click();
  await expect(form.getByText('4 uses in 3 notes will become #thought:')).toBeVisible();
  await expect(form.getByText('Alpha.md')).toBeVisible();
  await form.getByRole('button', { name: 'Rename 4 uses' }).click();

  await expectFile(vault, 'Alpha.md').toBe('# Alpha\n\nAbout #project/atlas and #thought.\n');
  await expectFile(vault, 'Beta.md').toBe(
    '---\ntags: [thought]\n---\n# Beta\n\nMore #thought here.\n',
  );
  await expectFile(vault, 'Gamma.md').toBe(
    '# Gamma\n\nNothing yet. #thought and #brandnew too\n\n# Later\n',
  );
  expect(await vault.read('Code.md')).toBe(CODE);
  await expect(page.getByRole('status').filter({ hasText: 'Renamed in 3 notes.' })).toBeVisible();
  await expect(tagRow(page, 'thought')).toHaveAccessibleName('thought 4 uses');
  await expect(tagRow(page, 'idea')).toHaveCount(0);
});

test('renaming into a tag already in use asks before merging the two', async ({ page }) => {
  const vault = await openVault(page, {
    'One.md': '# One\n\n#draft here\n',
    'Two.md': '# Two\n\n#wip there\n',
  });
  await page.getByRole('button', { name: 'Tags', exact: true }).click();
  await tagRow(page, 'wip').click();
  await page.getByRole('button', { name: 'Rename' }).click();
  const form = page.getByRole('form', { name: 'Rename #wip' });
  await form.getByLabel('New name').fill('#Draft');
  await form.getByRole('button', { name: 'Preview' }).click();
  await expect(form.getByRole('alert')).toHaveText(
    '#draft is already a tag. Its notes and these will share one tag.',
  );
  expect(await vault.read('Two.md')).toBe('# Two\n\n#wip there\n');
  await form.getByRole('button', { name: 'Merge into #draft' }).click();
  await expectFile(vault, 'Two.md').toBe('# Two\n\n#Draft there\n');
  await expect(tagRow(page, 'draft')).toHaveAccessibleName('draft 2 uses');
});

test('a tag whose last use is deleted leaves the tags page on its own', async ({ page }) => {
  const vault = await openVault(page, {
    'Only.md': '# Only\n\nOnce #fleeting here\n',
    'Other.md': '# Other\n\n#stays\n',
  });
  await page.getByRole('button', { name: 'Tags', exact: true }).click();
  await expect(tagRow(page, 'fleeting')).toBeVisible();

  await vault.write('Only.md', '# Only\n\nOnce here\n');
  await emitVaultChanged(page, ['Only.md']);
  await expect(tagRow(page, 'fleeting')).toHaveCount(0);
  await expect(tagRow(page, 'stays')).toBeVisible();
});
