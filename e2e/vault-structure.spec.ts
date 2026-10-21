import { expect, test, type Page } from './fixtures.ts';
import { createVault, expectFile, installHost, type FakeVault } from './host.ts';
import { pickSuggestion } from './link-suggest.ts';

/**
 * #214: every type has a home folder. A meeting waits in the Inbox in its
 * month's folder and filing it only links it; the one-time tidy is previewed
 * move by move, moves nothing until asked, keeps links opening the same
 * notes, and has nothing left to do the second time.
 */

const note = (frontmatter: string[], body: string) =>
  ['---', ...frontmatter, '---', '', body, ''].join('\n');

const MEETING = 'Meetings/2026/10/2026-10-06 Larkspur sync.md';

async function openVault(page: Page): Promise<FakeVault> {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('Projects');
  await vault.mkdir('Clients');
  await vault.mkdir('Meetings/2026/10');
  await vault.write(
    '.atlas/types/project.md',
    note(['name: project', 'label: Project'], '# Project'),
  );
  await vault.write('Projects/DFAI.md', note(['type: project'], 'For [[Acme]]: [[Call Sam]].'));
  // Loose at the root, each with a home to go to.
  await vault.write('Acme.md', note(['type: company'], 'The client.'));
  await vault.write('Call Sam.md', note(['type: task', 'date: 2026-09-15'], 'About the loan.'));
  // A namesake one folder down, which [[Acme]] would open once the root one moved deeper.
  await vault.write('Clients/Acme.md', '# Another Acme\n');
  // A meeting the import let in, in its month.
  await vault.write(
    MEETING,
    note(
      [
        'type: meeting',
        'atlas_import: meeting/v1',
        'atlas_import_outcome: imported',
        "date: '2026-10-06'",
      ],
      'Who was there.',
    ),
  );

  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

const inboxPage = (page: Page) => page.getByRole('article', { name: 'Inbox' });

async function openInbox(page: Page) {
  await page
    .getByRole('list', { name: 'Go to' })
    .getByRole('button', { name: /^Inbox/ })
    .click();
  return inboxPage(page);
}

test('a meeting waits in the Inbox in its month’s folder, and filing it links it where it is', async ({
  page,
}) => {
  const vault = await openVault(page);
  const inbox = await openInbox(page);

  await expect(inbox.getByRole('button', { name: '2026-10-06 Larkspur sync' })).toBeVisible();
  await pickSuggestion(
    inbox.getByRole('combobox', { name: 'File 2026-10-06 Larkspur sync under' }),
    'DFAI',
  );

  await expectFile(vault, MEETING).toMatch(/^project: "?\[\[DFAI\]\]"?$/m);
  expect(await vault.exists('Projects/DFAI/2026-10-06 Larkspur sync.md')).toBe(false);
  await expect(inbox.getByRole('button', { name: '2026-10-06 Larkspur sync' })).toHaveCount(0);
});

test('the tidy previews each move, moves nothing until asked, and keeps links opening the same notes', async ({
  page,
}) => {
  const vault = await openVault(page);
  const inbox = await openInbox(page);
  const tidy = inbox.getByRole('region', { name: 'Tidy the vault' });

  await expect(tidy.getByText(/2 notes could move to theirs/)).toBeVisible();
  await tidy.getByRole('button', { name: 'Preview the tidy' }).click();
  const moves = tidy.getByRole('table', { name: 'Notes that move' });
  await expect(moves.getByRole('row', { name: 'Acme.md Companies/Acme.md' })).toBeVisible();
  await expect(
    moves.getByRole('row', { name: 'Call Sam.md Tasks/2026/09/Call Sam.md' }),
  ).toBeVisible();
  // Previewed, nothing has moved.
  expect(await vault.exists('Acme.md')).toBe(true);
  expect(await vault.exists('Call Sam.md')).toBe(true);

  await tidy.getByRole('button', { name: 'Move 2 notes' }).click();

  await expectFile(vault, 'Companies/Acme.md').toContain('The client.');
  await expectFile(vault, 'Tasks/2026/09/Call Sam.md').toContain('About the loan.');
  expect(await vault.exists('Acme.md')).toBe(false);
  // [[Acme]] alone would now open Clients/Acme.md: the link was rewritten to keep opening the company.
  await expectFile(vault, 'Projects/DFAI.md').toContain('[[Companies/Acme');
  await expectFile(vault, 'Projects/DFAI.md').toContain('[[Call Sam]]');
  await expect(tidy.getByRole('status')).toHaveText(/moved 2 notes to their home folders/);
  await expect(tidy.getByRole('button', { name: 'Preview the tidy' })).toHaveCount(0);
});
