/**
 * Attack on #255 (#249): Shift-click runs in WebKit — across 2,000 grouped
 * rows with the anchor scrolled out and a middle group folded, a run archived
 * in bulk and what is chosen once its rows leave, and where a run starts once
 * the choice has been cleared.
 */
import { expect, test, type Page } from './fixtures.ts';
import { createVault, installHost, sidebarSection } from './host.ts';

const STATUSES = ['backlog', 'doing', 'done'] as const;

const TASK_TYPE = [
  '---',
  'name: task',
  'properties:',
  '  status:',
  '    kind: select',
  `    options: [${STATUSES.join(', ')}]`,
  '---',
  '',
].join('\n');

const title = (at: number) => `Chore ${String(at).padStart(4, '0')}`;

/** Backlog, Doing and Done in turn by thirds of `tasks`. */
const statusOf = (at: number, tasks: number) =>
  STATUSES[Math.min(2, Math.floor(((at - 1) * 3) / tasks))];

async function openTable(page: Page, { tasks, groupBy }: { tasks: number; groupBy: boolean }) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/views');
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  await vault.write(
    '.atlas/views/Chores.md',
    [
      '---',
      'atlas: view',
      'type: task',
      'layout: table',
      ...(groupBy ? ['groupBy: status'] : []),
      'columns: [status]',
      `limit: ${tasks * 2}`,
      '---',
      '',
    ].join('\n'),
  );
  await vault.mkdir('Chores');
  for (let at = 1; at <= tasks; at += 1) {
    await vault.write(
      `Chores/${title(at)}.md`,
      ['---', 'type: task', `status: ${statusOf(at, tasks)}`, '---', '', `# ${title(at)}`, ''].join(
        '\n',
      ),
    );
  }
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible({ timeout: 30_000 });
  await sidebarSection(page, 'views').getByRole('button', { name: 'Chores', exact: true }).click();
  await expect(page.locator('.table__row').first()).toBeVisible();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  return vault;
}

const box = (page: Page, at: number) =>
  page.getByRole('checkbox', { name: `Select ${title(at)}`, exact: true });
const count = (page: Page) => page.locator('.selection-bar__count');
const toBottom = (page: Page) =>
  page.locator('.table__sheet').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });

test('a run across 2,000 grouped rows leaves out a folded group in the middle', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const tasks = 2000;
  await openTable(page, { tasks, groupBy: true });
  const inGroup = (status: string) =>
    Array.from({ length: tasks }, (_, at) => statusOf(at + 1, tasks)).filter((s) => s === status)
      .length;

  await box(page, 1).click();
  await expect(count(page)).toHaveText('1 selected');
  // Doing's header is far below, so the sheet is scrolled until it is drawn.
  // Looked for before each step, not after: a count taken right after a scroll
  // reads the lines drawn for the position before it, and the header can be
  // among them yet fall out of the band drawn for the new one.
  const doing = page.locator('.table__group-toggle', { hasText: /^Doing/ });
  await expect
    .poll(
      async () => {
        if ((await doing.count()) === 1) return 1;
        await page.locator('.table__sheet').evaluate((element) => {
          element.scrollTop += 600;
        });
        return 0;
      },
      { timeout: 60_000, intervals: [100] },
    )
    .toBe(1);
  await doing.click();
  await expect(box(page, 1)).toHaveCount(0);
  await toBottom(page);
  await box(page, tasks).click({ modifiers: ['Shift'] });
  await expect(count(page)).toHaveText(`${inGroup('backlog') + inGroup('done')} selected`);
});

test('a run archived in bulk leaves nothing chosen, and the next Shift-click starts afresh', async ({
  page,
}) => {
  const vault = await openTable(page, { tasks: 30, groupBy: false });
  await box(page, 5).click();
  await box(page, 9).click({ modifiers: ['Shift'] });
  await expect(count(page)).toHaveText('5 selected');
  await page.getByRole('button', { name: 'Archive 5 notes' }).click();
  await expect.poll(() => vault.exists(`Archive/Chores/${title(9)}.md`)).toBe(true);
  await expect(box(page, 7)).toHaveCount(0);
  await expect(count(page)).toHaveCount(0);

  await box(page, 20).click({ modifiers: ['Shift'] });
  await expect(count(page)).toHaveText('1 selected');
});

test('after Clear, a Shift-click chooses its own row alone', async ({ page }) => {
  await openTable(page, { tasks: 30, groupBy: false });
  await box(page, 3).click();
  await expect(count(page)).toHaveText('1 selected');
  await page.locator('.selection-bar__clear').click();
  await expect(count(page)).toHaveCount(0);

  await box(page, 7).click({ modifiers: ['Shift'] });
  await expect(count(page)).toHaveText('1 selected');
  await expect(box(page, 3)).not.toBeChecked();
});
