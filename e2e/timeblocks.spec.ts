import { expect, test, type Page } from '@playwright/test';
import { createVault, emitVaultChanged, expectFile, installHost, type FakeVault } from './host.ts';

/**
 * P31-01: timeblocks are notes of the Block type, written into a vault whose
 * tasks follow GTD as it opens. A task's page shows its estimate beside what its
 * blocks schedule and what is done, and says when it is over-scheduled.
 */

const note = (frontmatter: string[], body: string) =>
  ['---', ...frontmatter, '---', '', body, ''].join('\n');

const TASK_TYPE = [
  '---',
  'name: task',
  'label: Task',
  'properties:',
  '  status:',
  '    kind: select',
  '    options: [inbox, backlog, next-action, in-progress, waiting, someday, longterm, archive]',
  '    done: archive',
  '  estimate:',
  '    kind: number',
  '    label: Estimate (minutes)',
  '---',
  '',
  '# Task',
  '',
].join('\n');

const task = (estimate: number) =>
  note(['type: task', 'status: next-action', `estimate: ${estimate}`], 'Something to do.');

const block = (start: string, end: string, tasks: readonly string[]) =>
  note(
    [
      'type: block',
      `start: ${start}`,
      `end: ${end}`,
      'tasks:',
      ...tasks.map((name) => `  - "[[${name}]]"`),
    ],
    'Time set aside.',
  );

async function openVault(page: Page): Promise<FakeVault> {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  await vault.write('Quarterly report.md', task(120));
  await vault.write('Invoice Larkspur.md', task(20));
  await vault.write('Call Mara.md', task(20));
  await vault.write('Reply to Tobias.md', task(20));
  // The report, split over three blocks: 1h, 30m and 30m.
  // Notes at the top of the vault, so the tree lists each without opening a folder.
  await vault.write(
    'Monday focus.md',
    block('2026-10-12T09:00', '2026-10-12T10:00', ['Quarterly report']),
  );
  await vault.write(
    'Tuesday focus.md',
    block('2026-10-13T14:00', '2026-10-13T14:30', ['Quarterly report']),
  );
  await vault.write(
    'Late push.md',
    block('2026-10-14T23:45', '2026-10-15T00:15', ['Quarterly report']),
  );
  // An hour of admin, shared by three 20-minute tasks; Mara's call also has a half hour of its own.
  await vault.write(
    'Admin.md',
    block('2026-10-12T13:00', '2026-10-12T14:00', [
      'Invoice Larkspur',
      'Call Mara',
      'Reply to Tobias',
    ]),
  );
  await vault.write('Call slot.md', block('2026-10-12T16:00', '2026-10-12T16:30', ['Call Mara']));

  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

async function openNote(page: Page, name: string) {
  await page.getByRole('treeitem', { name, exact: true }).click();
  await expect(page.getByRole('article', { name })).toBeVisible();
}

const schedule = (page: Page) => page.getByRole('region', { name: 'Schedule' });

test('a vault whose tasks follow GTD gets the Block type as it opens', async ({ page }) => {
  const vault = await openVault(page);

  await expectFile(vault, '.atlas/types/block.md').toContain('name: block\n');
  const type = await vault.read('.atlas/types/block.md');
  expect(type).toContain('  tasks:\n    kind: relation\n    target: task\n    many: true\n');
  expect(await vault.read('.atlas/types/task.md')).toBe(TASK_TYPE);
});

test('a 2h task split over 1h, 30m and 30m blocks reads 2h scheduled of 2h', async ({ page }) => {
  await openVault(page);
  await openNote(page, 'Quarterly report');

  await expect(schedule(page)).toContainText('Scheduled2h of 2h');
  await expect(schedule(page)).toContainText('Done0m of 2h');
  await expect(schedule(page)).not.toContainText('over the estimate');
});

test('a container shares its hour among its tasks, and over-scheduling is said', async ({
  page,
}) => {
  await openVault(page);

  await openNote(page, 'Invoice Larkspur');
  await expect(schedule(page)).toContainText('Scheduled20m of 20m');

  await openNote(page, 'Call Mara');
  await expect(schedule(page)).toContainText('Scheduled50m of 20m');
  await expect(schedule(page)).toContainText('30m over the estimate');
});

test('the schedule follows an estimate edited on the task’s page', async ({ page }) => {
  const vault = await openVault(page);
  await openNote(page, 'Quarterly report');
  await expect(schedule(page)).toContainText('Scheduled2h of 2h');

  const estimate = page
    .getByRole('region', { name: 'Properties' })
    .getByLabel('Estimate (minutes)', { exact: true });
  await estimate.fill('90');
  await estimate.press('Enter');

  await expectFile(vault, 'Quarterly report.md').toContain('estimate: 90\n');
  // The watcher tells the app its own save landed, and the index takes it in.
  await emitVaultChanged(page, ['Quarterly report.md']);
  await expect(schedule(page)).toContainText('Scheduled2h of 1h 30m');
  await expect(schedule(page)).toContainText('30m over the estimate');
});

test('a note that is not a task shows no schedule', async ({ page }) => {
  await openVault(page);
  await openNote(page, 'Admin');
  await expect(page.getByRole('region', { name: 'Properties' })).toBeVisible();
  await expect(schedule(page)).toHaveCount(0);
});
