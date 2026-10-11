import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createVault, emitVaultChanged, expectFile, installHost, type FakeVault } from './host.ts';

/**
 * P29-04: a meeting let in by the import is linked to its people and company
 * — an attendee whose address is a person's, and the company at its domain —
 * and an attendee the vault does not know waits in the Inbox as a person
 * proposal, never a guess. Accepting it makes the person and links them to
 * the meeting. Every claim about a file reads the disk.
 */

const shipped = (path: string) =>
  readFileSync(new URL(`../vault/${path}`, import.meta.url), 'utf8');

const MEETING = 'Inbox/Meetings/2026-10-06 Payroll sync.md';
const MEETING_TEXT = [
  '---',
  'type: meeting',
  'atlas_import: meeting/v1',
  "title: 'Payroll sync'",
  "date: '2026-10-06'",
  "start: '09:30'",
  'provider: gemini',
  "external_id: 'gemini-5b1d0e77'",
  'attendees:',
  '  - name: Mara Quill',
  '    email: mara@larkspur.example',
  '  - name: Ada Venn',
  '    email: ada@larkspur.example',
  '  - name: payroll-team',
  '    email: payroll-team@larkspur.example',
  '    group: true',
  '---',
  '',
  '## Summary',
  '',
  'Larkspur Payroll go-live moves a week.',
  '',
].join('\n');

async function openVault(page: Page): Promise<FakeVault> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const vault = await createVault();
  for (const folder of ['.atlas/types', 'Inbox/Meetings', 'People', 'Companies']) {
    await vault.mkdir(folder);
  }
  for (const type of ['task', 'meeting', 'person', 'company', 'project', 'proposal']) {
    await vault.write(`.atlas/types/${type}.md`, shipped(`.atlas/types/${type}.md`));
  }
  await vault.write(
    'People/Mara Quill.md',
    '---\ntype: person\nemail: mara@larkspur.example\n---\n\n# Mara Quill\n',
  );
  await vault.write(
    'Companies/Larkspur Payroll.md',
    '---\ntype: company\ndomains:\n  - larkspur.example\n---\n\n# Larkspur Payroll\n',
  );
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

/** The meeting landing as a pull lands it: written, then the watcher says so. */
async function arrive(page: Page, vault: FakeVault) {
  await vault.write(MEETING, MEETING_TEXT);
  await emitVaultChanged(page, [MEETING]);
}

const properties = (page: Page) => page.getByRole('region', { name: 'Properties' });

test('an arriving meeting links its people and company, and an unknown attendee is proposed; accepting makes and links them', async ({
  page,
}) => {
  const vault = await openVault(page);
  await arrive(page, vault);

  await expectFile(vault, MEETING).toMatch(/\npeople:\n {2}- "\[\[Mara Quill\]\]"\n/);
  const linked = await vault.read(MEETING);
  expect(linked).toMatch(/\ncompanies:\n {2}- "\[\[Larkspur Payroll\]\]"\n/);
  expect(linked).not.toContain('Ada Venn]]');
  expect(linked).not.toContain('payroll-team]]');

  // The meeting shows who it is linked to.
  await page.getByRole('button', { name: /^Inbox/ }).click();
  await page.getByRole('main').getByText('Payroll sync', { exact: true }).click();
  const people = properties(page)
    .getByRole('list', { name: /people/i })
    .getByRole('listitem');
  await expect(people).toHaveText(['Mara Quill']);
  const companies = properties(page)
    .getByRole('list', { name: /companies/i })
    .getByRole('listitem');
  await expect(companies).toHaveText(['Larkspur Payroll']);

  // Ada is proposed as a person, with her address and company; the group never is.
  await page.getByRole('button', { name: /^Inbox/ }).click();
  const card = page.getByRole('region', { name: 'Person: Ada Venn' });
  await expect(card).toBeVisible();
  await expect(card.getByText('ada@larkspur.example')).toBeVisible();
  await expect(card.getByText('[[Larkspur Payroll]]')).toBeVisible();
  await expect(card.getByText(/And adds it to/)).toHaveText(
    'And adds it to people of 2026-10-06 Payroll sync.',
  );
  await expect(page.getByRole('region', { name: /payroll-team/ })).toHaveCount(0);

  await card.getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Accepted: Ada Venn.' })).toBeVisible();

  await expectFile(vault, 'People/Ada Venn.md').toContain('type: person');
  const ada = await vault.read('People/Ada Venn.md');
  expect(ada).toContain('email: ada@larkspur.example');
  expect(ada).toContain('company: "[[Larkspur Payroll]]"');
  await expectFile(vault, MEETING).toMatch(
    /\npeople:\n {2}- "\[\[Mara Quill\]\]"\n {2}- "\[\[Ada Venn\]\]"\n/,
  );
});
