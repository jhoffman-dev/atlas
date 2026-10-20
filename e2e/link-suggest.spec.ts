import { expect, test, type Page } from './fixtures.ts';
import { createVault, expectFile, installHost, type FakeVault } from './host.ts';
import { suggestion } from './link-suggest.ts';

/**
 * #465: a link field suggests notes as you type — here the Inbox's project
 * field, where James otherwise had to remember what a project is called and
 * how it is written. Every claim about a file reads the disk.
 */

const TASK_TYPE = [
  '---',
  'name: task',
  'label: Task',
  'properties:',
  '  status:',
  '    kind: select',
  '    options: [inbox, backlog, next-action, in-progress, waiting, someday, longterm, archive]',
  '    done: archive',
  '  waiting_on:',
  '    kind: relation',
  '    target: person',
  '  project:',
  '    kind: relation',
  '    targets: [project, area]',
  '  due: date',
  '---',
  '',
  '# Task',
  '',
].join('\n');

const note = (frontmatter: string[], body: string) =>
  ['---', ...frontmatter, '---', '', body, ''].join('\n');

// A fixed day, so the folder a task is filed into does not move with the real one.
const NOW = new Date(2026, 9, 14, 12);
const TODAY = NOW.toLocaleDateString('en-CA');
const FILED = `Tasks/${TODAY.slice(0, 4)}/${TODAY.slice(5, 7)}/Call the bank.md`;

async function vaultWithProjects(): Promise<FakeVault> {
  const vault = await createVault();
  for (const folder of ['.atlas/types', 'Projects', 'Tasks', 'Inbox']) await vault.mkdir(folder);
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  await vault.write(
    'Projects/Larkspur Payroll migration.md',
    note(['type: project', 'aliases: [LPM]'], 'Moving payroll.'),
  );
  await vault.write('Projects/Larkspur onboarding.md', note(['type: project'], 'New starters.'));
  await vault.write('Projects/Atlas.md', note(['type: project'], 'The app.'));
  await vault.write('Inbox/Call the bank.md', note(['type: task', 'status: inbox'], 'The loan.'));
  return vault;
}

async function openInbox(page: Page, vault: FakeVault) {
  await page.clock.setFixedTime(NOW);
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible({ timeout: 20_000 });
  await page
    .getByRole('list', { name: 'Go to' })
    .getByRole('button', { name: /^Inbox/ })
    .click();
  const inbox = page.getByRole('article', { name: 'Inbox' });
  await expect(inbox.getByRole('table')).toBeVisible();
  return inbox;
}

test('in the Inbox, a task’s project is set by typing a few letters and picking the suggestion', async ({
  page,
}) => {
  const vault = await vaultWithProjects();
  const inbox = await openInbox(page, vault);
  const project = inbox.getByRole('combobox', { name: 'File Call the bank under' });

  await project.click();
  await page.keyboard.type('lark');
  // Both Larkspur projects meet "lark"; Atlas does not.
  await expect(suggestion(project, 'Larkspur Payroll migration')).toBeVisible();
  await expect(suggestion(project, 'Larkspur onboarding')).toBeVisible();
  await expect(suggestion(project, 'Atlas')).toHaveCount(0);

  // An alias finds its note too, and says so.
  await project.fill('lpm');
  const byAlias = suggestion(project, 'Larkspur Payroll migration');
  await expect(byAlias).toHaveAttribute('aria-label', /also LPM/);
  await byAlias.click();
  await expect(project).toHaveValue('Larkspur Payroll migration');

  // Nothing is written until Save; then the file holds the exact link.
  expect(await vault.read('Inbox/Call the bank.md')).not.toContain('project');
  await inbox
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: 'Call the bank', exact: true }) })
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await expectFile(vault, FILED).toContain('project: "[[Larkspur Payroll migration]]"');
});

test('the P key opens the project field: three letters and Enter file the task', async ({
  page,
}) => {
  const vault = await vaultWithProjects();
  const inbox = await openInbox(page, vault);
  await inbox
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: 'Call the bank', exact: true }) })
    .focus();
  await page.keyboard.press('p');
  const project = inbox.getByRole('combobox', { name: 'File Call the bank under' });
  await expect(project).toBeFocused();
  await page.keyboard.type('atl');
  await expect(suggestion(project, 'Atlas')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expectFile(vault, FILED).toContain('project: "[[Atlas]]"');
  expect(await vault.read(FILED)).toContain('status: inbox');
});
