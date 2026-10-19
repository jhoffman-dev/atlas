import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createVault, emitVaultChanged, expectFile, installHost, type FakeVault } from './host.ts';

/**
 * Issue #400: a term named like a company already in the vault. Its note would
 * take `[[Larkspur Payroll]]` from the company, so the misheard spellings go
 * into the company's own `variants` instead — the rest of its file as it was —
 * and a meeting that mishears the name arrives corrected to it.
 */

const shipped = (path: string) =>
  readFileSync(new URL(`../vault/${path}`, import.meta.url), 'utf8');
const VALID = readFileSync(
  new URL(
    '../packages/domain/src/meetings/fixtures/valid/gemini-platform-sync.md',
    import.meta.url,
  ),
  'utf8',
);

/** Deeper than `Terms/`, so a new `Terms/Larkspur Payroll.md` would win its links. */
const COMPANY_PATH = 'Areas/Vendors/Larkspur Payroll.md';
const COMPANY = ['---', 'type: company', 'aliases:', '  - LP', '---', '', 'Payroll vendor.', ''];
const MEETING = 'Inbox/Meetings/2026-09-29 Platform weekly sync.md';

async function openVault(page: Page): Promise<FakeVault> {
  const vault = await createVault();
  for (const folder of ['.atlas/types', '.atlas/views', 'Inbox/Meetings', 'Areas/Vendors']) {
    await vault.mkdir(folder);
  }
  for (const type of ['task', 'meeting', 'person', 'company', 'project', 'term']) {
    await vault.write(`.atlas/types/${type}.md`, shipped(`.atlas/types/${type}.md`));
  }
  await vault.write('.atlas/views/Inbox.md', shipped('.atlas/views/Inbox.md'));
  await vault.write(COMPANY_PATH, COMPANY.join('\n'));
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

test('a term named like a company adds its misheard spellings to the company, which then corrects a meeting', async ({
  page,
}) => {
  const vault = await openVault(page);
  await page.getByRole('list', { name: 'Go to' }).getByRole('button', { name: 'Terms' }).click();

  await page.getByRole('button', { name: 'New term' }).click();
  const form = page.getByRole('form', { name: 'New term' });
  await form.getByRole('textbox', { name: 'Right spelling' }).fill('Larkspur Payroll');
  await form.getByRole('textbox', { name: 'Misheard as' }).fill('Larkspar Payroll');
  await form.getByRole('button', { name: 'Add term' }).click();

  await expectFile(vault, COMPANY_PATH).toBe(
    [
      '---',
      'type: company',
      'aliases:',
      '  - LP',
      'variants:',
      '  - Larkspar Payroll',
      '---',
      '',
      'Payroll vendor.',
      '',
    ].join('\n'),
  );
  expect(await vault.exists('Terms/Larkspur Payroll.md')).toBe(false);
  await expect(page.getByRole('status').filter({ hasText: /^Added to / })).toHaveText(
    `Added to ${COMPANY_PATH}: Larkspar Payroll, now corrected to “Larkspur Payroll”.`,
  );
  await expect(page.getByRole('alert')).toHaveCount(0);

  // Listed among the terms, saying whose note holds it.
  const terms = page.getByRole('article', { name: 'Terms' });
  const row = terms.getByRole('row').filter({ hasText: 'Larkspur Payroll' });
  await expect(row.getByText(`Company · ${COMPANY_PATH}`)).toBeVisible();
  await expect(
    row.getByRole('textbox', { name: 'Misheard spellings of Larkspur Payroll' }),
  ).toHaveValue('Larkspar Payroll');

  // A change to the company's note made outside the Terms page reaches the page and the vocabulary.
  await vault.write(
    COMPANY_PATH,
    (await vault.read(COMPANY_PATH)).replace(
      '  - Larkspar Payroll\n',
      '  - Larkspar Payroll\n  - Larks Burr Payroll\n',
    ),
  );
  await emitVaultChanged(page, [COMPANY_PATH]);
  await expect(
    row.getByRole('textbox', { name: 'Misheard spellings of Larkspur Payroll' }),
  ).toHaveValue('Larkspar Payroll, Larks Burr Payroll');

  await vault.write(
    MEETING,
    VALID.replace(
      'start with the cache?',
      'start with Larkspar Payroll? Ask LP, or Larks Burr Payroll.',
    ),
  );
  await emitVaultChanged(page, [MEETING]);
  // Both variants correct, the one written outside the page too; the alias, LP, is left as written.
  await expectFile(vault, MEETING).toContain(
    'start with Larkspur Payroll? Ask LP, or Larkspur Payroll.',
  );
});
