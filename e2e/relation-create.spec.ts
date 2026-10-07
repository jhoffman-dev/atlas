/**
 * Issue #15, as James met it: in a person's note he chose to make a new
 * company from the Company dropdown, renamed what opened and filled it in —
 * and it was the Company template he had renamed. No company was made, the
 * template was gone, and the person linked the template.
 *
 * A new company is a new note of the type, made from the template and named
 * as typed; the template is never offered, never linked and never renamed
 * from a note's title.
 */
import { expect, test, type Page } from '@playwright/test';
import { createVault, expectFile, installHost, type FakeVault } from './host.ts';

const PERSON_TYPE = [
  '---',
  'name: person',
  'label: Person',
  'properties:',
  '  company:',
  '    kind: relation',
  '    target: company',
  '---',
  '',
].join('\n');
const COMPANY_TYPE = '---\nname: company\nlabel: Company\nproperties:\n  site: url\n---\n';
const COMPANY_TEMPLATE = '---\ntype: company\nstage:\nsite:\n---\n';

async function open(page: Page): Promise<FakeVault> {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/templates');
  await vault.write('.atlas/types/person.md', PERSON_TYPE);
  await vault.write('.atlas/types/company.md', COMPANY_TYPE);
  await vault.write('.atlas/templates/Company.md', COMPANY_TEMPLATE);
  await vault.write('Acme.md', '---\ntype: company\n---\n');
  await vault.write('Sam Rivera.md', '---\ntype: person\n---\n');
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

test('a new company from a person’s Company picker is a new note, and the template is left alone', async ({
  page,
}) => {
  const vault = await open(page);
  await openNote(page, 'Sam Rivera');

  const company = properties(page).getByRole('combobox', { name: 'Company' });
  // The real company is offered; the template that says `type: company` is not.
  await expect.poll(() => company.locator('option').allTextContents()).toContain('Acme');
  await expect(company.locator('option')).toHaveText(['— no company —', 'Acme', 'New company…']);

  await company.selectOption({ label: 'New company…' });
  const name = properties(page).getByRole('textbox', { name: 'Name of the new company' });
  await name.fill('Larkspur Payroll');
  await name.press('Enter');

  await expectFile(vault, 'Sam Rivera.md').toContain('company: "[[Larkspur Payroll]]"');
  await expectFile(vault, 'Larkspur Payroll.md').toContain('type: company');
  expect(await vault.read('.atlas/templates/Company.md')).toBe(COMPANY_TEMPLATE);
  expect(await vault.exists('.atlas/templates/Larkspur Payroll.md')).toBe(false);

  // The chip opens the new company, which renames as any note does.
  await properties(page).getByRole('button', { name: 'Open Larkspur Payroll' }).click();
  await expect(page.getByRole('article', { name: 'Larkspur Payroll' })).toBeVisible();
});
