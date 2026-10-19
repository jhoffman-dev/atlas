import { expect, test, type Page } from '@playwright/test';
import {
  createVault,
  emitVaultChanged,
  installHost,
  sidebarSection,
  splitWindow,
  type FakeVault,
} from './host.ts';

/**
 * Performance 9 (#325): each pane reads again only for news of what it shows.
 * What it shows still always follows another program's edit — the note in
 * it, the block it embeds, and on Today the tasks — while the other pane,
 * which shows none of it, keeps what it shows.
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
  '---',
  '',
  '# Task',
  '',
].join('\n');

const PLANS = '# Plans\n\nThe summer, roughly.\n\nPack the tent ^p1\n';
const task = (status: string) => `---\ntype: task\nstatus: ${status}\n---\n\n# Call the bank\n`;

async function openVault(page: Page): Promise<FakeVault> {
  const vault = await createVault();
  for (const folder of ['.atlas/types', 'Tasks']) await vault.mkdir(folder);
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  await vault.write('Plans.md', PLANS);
  await vault.write('Journal.md', '# Journal\n\nToday.\n\n![[Plans#^p1]]\n');
  await vault.write('Elsewhere.md', '# Elsewhere\n\nNothing to do with it.\n');
  await vault.write('Tasks/Call the bank.md', task('next-action'));
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

const pane = (page: Page, which: 1 | 2) => page.getByRole('region', { name: `Pane ${which}` });
const noteIn = (page: Page, which: 1 | 2) => pane(page, which).getByLabel('Note', { exact: true });

async function openNote(page: Page, name: string, which: 1 | 2) {
  await sidebarSection(page, 'userSpace').getByRole('treeitem', { name, exact: true }).click();
  await expect(pane(page, which).getByRole('article', { name })).toBeVisible();
}

/** Another program writes `path`, and the host's watcher says so. */
async function writeOutside(page: Page, vault: FakeVault, path: string, text: string) {
  await vault.write(path, text);
  await emitVaultChanged(page, [path]);
}

test('each pane shows another program’s edit to what it shows, and the other keeps its own', async ({
  page,
}) => {
  const vault = await openVault(page);
  await openNote(page, 'Journal', 1);
  await splitWindow(page);
  await openNote(page, 'Elsewhere', 2);
  const embedded = pane(page, 1).getByLabel('Embedded block', { exact: true });
  await expect(embedded).toHaveText('Pack the tent');

  // The block pane 1 embeds, edited in its own note by another program.
  await writeOutside(page, vault, 'Plans.md', PLANS.replace('Pack the tent', 'Pack the big tent'));
  await expect(embedded).toHaveText('Pack the big tent');
  await expect(noteIn(page, 2)).toContainText('Nothing to do with it.');

  // The note pane 2 shows, edited by another program: pane 1 keeps its block.
  await writeOutside(page, vault, 'Elsewhere.md', '# Elsewhere\n\nNow it says more.\n');
  await expect(noteIn(page, 2)).toContainText('Now it says more.');
  await expect(embedded).toHaveText('Pack the big tent');

  // The note pane 1 shows itself, edited by another program.
  await writeOutside(page, vault, 'Journal.md', '# Journal\n\nTomorrow.\n\n![[Plans#^p1]]\n');
  await expect(noteIn(page, 1)).toContainText('Tomorrow.');
  await expect(embedded).toHaveText('Pack the big tent');
});

test('Today in one pane shows another program’s change to a task, a note open in the other', async ({
  page,
}) => {
  const vault = await openVault(page);
  await openNote(page, 'Elsewhere', 1);
  await splitWindow(page);
  await page.getByRole('list', { name: 'Go to' }).getByRole('button', { name: 'Today' }).click();
  const today = pane(page, 2).getByRole('article', { name: 'Today' });
  const nextActions = today
    .getByRole('region', { name: 'Next actions', exact: true })
    .locator('.table__title');
  await expect(nextActions).toHaveText(['Call the bank']);

  // A note the page does not read, edited elsewhere: Today still shows the task.
  await writeOutside(page, vault, 'Elsewhere.md', '# Elsewhere\n\nEdited.\n');
  await expect(noteIn(page, 1)).toContainText('Edited.');
  await expect(nextActions).toHaveText(['Call the bank']);

  // The task, put under way by another program, moves to In progress.
  await writeOutside(page, vault, 'Tasks/Call the bank.md', task('in-progress'));
  await expect(
    today.getByRole('region', { name: 'In progress', exact: true }).locator('.table__title'),
  ).toHaveText(['Call the bank']);
  await expect(nextActions).toHaveCount(0);
});
