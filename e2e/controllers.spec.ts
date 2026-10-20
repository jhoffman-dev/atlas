import { expect, test, type Page } from './fixtures.ts';
import { createVault, emitVaultChanged, expectFile, installHost, type FakeVault } from './host.ts';

/**
 * Performance 10 (#326): sync and the automations run in their own runners,
 * outside the window, and hear the index's news of what concerns them. The
 * Automations page still follows a rule another program edits, and a rule a
 * note sets off still runs on that note's change, and on no other.
 */

const TASK_TYPE = [
  '---',
  'name: task',
  'properties:',
  '  status:',
  '    kind: select',
  '    options: [backlog, doing, done]',
  '---',
  '',
].join('\n');

const RULE = '.atlas/automations/Sweep.md';
const LOG = '.atlas/automations/log/Sweep.md';

const rule = ({ name, when }: { name: string; when: string }) =>
  [
    '---',
    'atlas: automation',
    `name: ${name}`,
    'id: Sweep',
    'enabled: true',
    `when: ${when}`,
    'which: FROM task WHERE status = done',
    'do: archive',
    '---',
    '',
  ].join('\n');

const task = (status: string, title = 'Call the bank') =>
  `---\ntype: task\nstatus: ${status}\n---\n\n# ${title}\n`;
const PLANTS = 'Tasks/Water the plants.md';

async function openVault(page: Page, when: string): Promise<FakeVault> {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/automations');
  await vault.mkdir('Tasks');
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  await vault.write(RULE, rule({ name: 'Sweep', when }));
  await vault.write('Tasks/Call the bank.md', task('doing'));
  await vault.write(PLANTS, task('doing', 'Water the plants'));
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

test('the Automations page, while shown, follows a rule another program edits (#326)', async ({
  page,
}) => {
  const vault = await openVault(page, 'manually');
  await page.getByRole('button', { name: 'Automations', exact: true }).click();
  const list = page.getByRole('list', { name: 'All automations' });
  await expect(list.getByText('Sweep', { exact: true })).toBeVisible();

  await vault.write(RULE, rule({ name: 'Sweep the desk', when: 'manually' }));
  await emitVaultChanged(page, [RULE]);
  await expect(list.getByText('Sweep the desk', { exact: true })).toBeVisible();
  await expect(list.getByText('Sweep', { exact: true })).toHaveCount(0);
});

test('a rule a task sets off acts on a changed task its query takes, and on no other changed task (#326)', async ({
  page,
}) => {
  const vault = await openVault(page, 'a task is changed');

  // A task changes without becoming done: it sets the rule off, and its query does not take it.
  await vault.write(PLANTS, task('backlog', 'Water the plants'));
  await emitVaultChanged(page, [PLANTS]);

  // A task is done: its change sets the rule off, which archives it. Runs go one at a
  // time in the order their news came, so the one before has run by now.
  await vault.write('Tasks/Call the bank.md', task('done'));
  await emitVaultChanged(page, ['Tasks/Call the bank.md']);
  await expect.poll(() => vault.exists('Archive/Tasks/Call the bank.md')).toBe(true);
  await expectFile(vault, LOG).toContain('triggered by `"Tasks/Call the bank.md"`');
  expect(await vault.exists(PLANTS)).toBe(true);
  expect(await vault.exists('Archive/Tasks/Water the plants.md')).toBe(false);
  expect(await vault.read(LOG)).not.toContain('Water the plants');
});
