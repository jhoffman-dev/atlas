/**
 * Phase 21: people and mentions (U-20). `@` offers the vault's people and
 * links the one picked with a plain `[[Name]]`, drawn as their chip; a new
 * name makes a person from the Person template; the person's page lists
 * where they are mentioned; and the built-in Person type cannot be deleted.
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
  type FakeHost,
  type FakeVault,
} from './host.ts';

const PERSON_TYPE = '---\nname: person\nlabel: Person\nproperties:\n  role: text\n---\n';
const COMPANY_TYPE = '---\nname: company\nlabel: Company\nproperties:\n  site: text\n---\n';
const PERSON_TEMPLATE = '---\ntype: person\nrole:\n---\n\nMet at:\n';
const person = (role: string) => `---\ntype: person\nrole: ${role}\n---\n`;
const STANDUP = '# Standup\n\nNotes here.\n';

async function openVault(page: Page): Promise<{ vault: FakeVault; host: FakeHost }> {
  const vault = await createVault();
  const files: Record<string, string> = {
    '.atlas/types/person.md': PERSON_TYPE,
    '.atlas/types/company.md': COMPANY_TYPE,
    '.atlas/templates/Person.md': PERSON_TEMPLATE,
    'People/Julie Brandt-Hoffer.md': person('partner'),
    'People/Bob.md': person('neighbour'),
    'Standup.md': STANDUP,
  };
  for (const folder of ['.atlas/types', '.atlas/templates', 'People']) await vault.mkdir(folder);
  for (const [path, text] of Object.entries(files)) await vault.write(path, text);
  const host = await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return { vault, host };
}

/** Puts the caret at the end of the Standup note's paragraph. */
async function typeInStandup(page: Page) {
  await page.getByRole('treeitem', { name: 'Standup', exact: true }).click();
  await page.getByText('Notes here.').click();
  await page.keyboard.press('End');
}

const mentions = (page: Page) => page.getByRole('listbox', { name: 'Mention a person' });

test('@ offers people, links the one picked as [[Name]] drawn as a chip, and their page lists it', async ({
  page,
}) => {
  const { vault } = await openVault(page);
  await typeInStandup(page);

  await page.keyboard.type(' Call @Jul');
  await expect(mentions(page).getByRole('option')).toHaveText([/Julie Brandt-Hoffer/, /Create/]);
  await page.keyboard.press('Enter');
  await expect(mentions(page)).toHaveCount(0);

  const chip = page.locator('.editor .wikilink--person');
  await expect(chip).toHaveText('Julie Brandt-Hoffer');
  await expect(chip).toHaveAttribute('data-initial', 'J');

  await page.keyboard.type('tomorrow');
  await saveNow(page);
  await expectSaved(page);
  await expectFile(vault, 'Standup.md').toBe(
    '# Standup\n\nNotes here. Call [[Julie Brandt-Hoffer]] tomorrow\n',
  );

  // An email address is not a mention: the popup that opened above stays shut
  // while its name part is typed, before any dot could close it.
  await page.keyboard.type(', mail julie@exam');
  await expect(page.locator('.editor')).toContainText('julie@exam');
  await expect(mentions(page)).toHaveCount(0);

  // Julie's page lists the note under where she is mentioned.
  await emitVaultChanged(page, ['Standup.md']);
  await chip.click();
  await expect(page.getByRole('heading', { name: 'Julie Brandt-Hoffer', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: /^Links/ }).click();
  const mentionedIn = page.getByRole('region', { name: 'Mentioned in' });
  await expect(mentionedIn.getByRole('button', { name: /Standup/ })).toBeVisible();
});

test('links picked last in a block, and emails typed, save as written (A21-01)', async ({
  page,
}) => {
  const { vault } = await openVault(page);
  await typeInStandup(page);

  await page.keyboard.type(' Ask @Jul');
  await page.keyboard.press('Enter');
  await expect(page.locator('.editor .wikilink--person')).toHaveText('Julie Brandt-Hoffer');
  await page.keyboard.press('Enter');
  await page.keyboard.type('See [[Bo');
  await expect(page.getByRole('listbox', { name: 'Link to note' })).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- item @Jul');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  // The first is linked by the editor as the space goes in; the second is not.
  await page.keyboard.type('Mail julie@example.com or bob@example.com');

  await saveNow(page);
  await expectSaved(page);
  await expectFile(vault, 'Standup.md').toBe(
    '# Standup\n\nNotes here. Ask [[Julie Brandt-Hoffer]]\n\nSee [[Bob]]\n\n- item [[Julie Brandt-Hoffer]]\n\nMail julie@example.com or bob@example.com\n',
  );
});

test('@ and a new name makes the person from the Person template and links them', async ({
  page,
}) => {
  const { vault } = await openVault(page);
  await typeInStandup(page);

  await page.keyboard.type(' With @Ann Lee');
  const create = mentions(page).getByRole('option', { name: /Create person “Ann Lee”/ });
  await expect(create).toBeVisible();
  // Never what Enter picks by itself (A21-02): ↓ selects it, then Enter.
  await expect(create).toHaveAttribute('aria-selected', 'false');
  await page.keyboard.press('ArrowDown');
  await expect(create).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');

  // Filed in People/, made for the purpose.
  await expectFile(vault, 'People/Ann Lee.md').toMatch(/^---\ntype: person\n[\s\S]*Met at:\n$/);
  const chip = page.locator('.editor .wikilink--person', { hasText: 'Ann Lee' });
  await expect(chip).toHaveAttribute('data-initial', 'A');

  await page.keyboard.type('today');
  await saveNow(page);
  await expectSaved(page);
  await expectFile(vault, 'Standup.md').toBe('# Standup\n\nNotes here. With [[Ann Lee]] today\n');
});

test('the Person type cannot be deleted, while a type of your own can', async ({ page }) => {
  const { host } = await openVault(page);

  await sidebarSection(page, 'types')
    .getByRole('button', { name: /^Person, \d+ notes?$/ })
    .click();
  await page.getByRole('radio', { name: 'Edit type' }).click();
  const deletePerson = page.getByRole('button', { name: 'Delete Person…' });
  await expect(deletePerson).toBeDisabled();
  await expect(page.getByText(/Person is built in — @ mentions find people by it/)).toBeVisible();
  // Its properties are still its own to change.
  await expect(page.getByRole('button', { name: 'Add property' })).toBeEnabled();

  await sidebarSection(page, 'types')
    .getByRole('button', { name: /^Company, \d+ notes?$/ })
    .click();
  await page.getByRole('radio', { name: 'Edit type' }).click();
  await expect(page.getByText(/is built in/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete Company…' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Move to Trash' }).click();
  await expect.poll(() => host.trashed()).toEqual(['.atlas/types/company.md']);
});
