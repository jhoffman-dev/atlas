import { expect, test, type Page } from '@playwright/test';
import { createVault, emitVaultChanged, installHost, pageCommand, sidebarSection } from './host.ts';

const TASK_TYPE = [
  '---',
  'name: task',
  'properties:',
  '  status:',
  '    kind: select',
  '    options: [backlog, doing, done]',
  '  estimate: number',
  '  phase: number',
  '---',
  '',
].join('\n');

const DASHBOARD = [
  '---',
  'atlas: dashboard',
  'widgets:',
  '  - title: Tasks',
  '    kind: number',
  '    type: task',
  '  - title: Doing',
  '    kind: number',
  '    type: task',
  '    filters: [{ key: status, operator: is, value: doing }]',
  '  - title: By status',
  '    kind: bar',
  '    type: task',
  '    groupBy: status',
  '  - title: Share of status',
  '    kind: donut',
  '    type: task',
  '    groupBy: status',
  '  - title: Over phases',
  '    kind: line',
  '    type: task',
  '    groupBy: phase',
  '  - title: Open work',
  '    kind: list',
  '    type: task',
  '    filters: [{ key: status, operator: isNot, value: done }]',
  '  - title: Nowhere',
  '    kind: number',
  '    type: ghost',
  '---',
  '',
  '# Progress',
  '',
].join('\n');

const task = (status: string, phase = 1): string =>
  ['---', 'type: task', `status: ${status}`, `phase: ${phase}`, '---', '', 'A task.', ''].join(
    '\n',
  );

const THREE_TASKS: readonly (readonly [string, number])[] = [
  ['doing', 1],
  ['doing', 2],
  ['done', 2],
];
const NAMES = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

async function openDashboard(page: Page, dashboard = DASHBOARD, tasks = THREE_TASKS) {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/dashboards');
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  await vault.write('.atlas/dashboards/Progress.md', dashboard);
  for (const [at, [status, phase]] of tasks.entries()) {
    await vault.write(`${NAMES[at] ?? `t${at}`}.md`, task(status, phase));
  }
  // Links here, so the page has a mention to leave out.
  await vault.write('plan.md', 'The plan is on [[Progress]].\n');

  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();

  await sidebarSection(page, 'dashboards')
    .getByRole('button', { name: 'Progress', exact: true })
    .click();
  await expect(page.getByLabel('Dashboard', { exact: true })).toBeVisible();
  return vault;
}

test('a dashboard is headed like a page, with its internals behind the menu', async ({ page }) => {
  await openDashboard(page);

  await expect(page.getByRole('heading', { level: 1, name: 'Progress' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText(
    'Dashboards/Progress',
  );
  // Neither its frontmatter nor what links to it is printed on the page.
  await expect(page.getByLabel('Tasks').getByText('3')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Properties' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Links', exact: true })).toHaveCount(0);
  await expect(page.getByText(/linked here/)).toHaveCount(0);

  await pageCommand(page, /^Page properties/);
  await expect(page.getByRole('region', { name: 'Properties' }).getByText('7 items')).toBeVisible();
});

test('a number widget counts the notes of its type', async ({ page }) => {
  await openDashboard(page);
  await expect(page.getByLabel('Tasks').getByText('3')).toBeVisible();
});

test('a number widget honours its filter', async ({ page }) => {
  await openDashboard(page);
  await expect(page.getByLabel('Doing').getByText('2')).toBeVisible();
});

test('a chart draws a bar per value, biggest first', async ({ page }) => {
  await openDashboard(page);

  const labels = page.getByLabel('By status').locator('.bars__label');
  await expect(labels).toHaveText(['doing', 'done']);
});

test('a list widget links to the notes it matched', async ({ page }) => {
  await openDashboard(page);

  const list = page.getByLabel('Open work');
  await expect(list.getByRole('button', { name: 'one' })).toBeVisible();
  await expect(list.getByRole('button', { name: 'three' })).not.toBeVisible();
});

test('clicking a row of a widget opens that note', async ({ page }) => {
  await openDashboard(page);

  await page.getByLabel('Open work').getByRole('button', { name: 'one' }).click();
  await expect(page.locator('.tiptap')).toContainText('A task.');
});

test('a widget pointing at nothing fails alone', async ({ page }) => {
  await openDashboard(page);

  await expect(page.getByLabel('Nowhere').locator('.widget__error')).toBeVisible();
  await expect(page.getByLabel('Tasks').getByText('3')).toBeVisible();
});

test('the numbers follow an edit made outside the dashboard', async ({ page }) => {
  const vault = await openDashboard(page);
  await expect(page.getByLabel('Doing').getByText('2')).toBeVisible();

  await vault.write('two.md', task('done'));
  await emitVaultChanged(page, ['two.md']);

  await expect(page.getByLabel('Doing').getByText('1')).toBeVisible();
  await expect(page.getByLabel('By status').locator('.bars__label')).toHaveText(['done', 'doing']);
});

test('a donut names every slice in its legend, not only in the picture', async ({ page }) => {
  await openDashboard(page);

  const donut = page.getByLabel('Share of status');
  await expect(donut.locator('.donut__slice')).toHaveCount(2);
  await expect(donut.getByText('doing')).toBeVisible();
  await expect(donut.getByText('done')).toBeVisible();
});

test('a line chart gives its numbers as a table as well as a line', async ({ page }) => {
  await openDashboard(page);

  const line = page.getByLabel('Over phases');
  await expect(line.locator('.line-chart__point')).toHaveCount(2);
  await expect(line.getByRole('columnheader', { name: '1' })).toBeVisible();
});

test('a widget keeps its SQL behind its own menu', async ({ page }) => {
  await openDashboard(page);

  const tile = page.getByLabel('Tasks');
  await expect(tile.getByText('3')).toBeVisible();
  await expect(tile.locator('.widget__sql')).toHaveCount(0);

  await tile.hover();
  await tile.getByRole('button', { name: 'Widget options' }).click();
  await page.getByRole('menuitem', { name: 'Show SQL' }).click();
  await expect(tile.locator('.widget__sql')).toContainText('COUNT(*)');
});

const PHASES = [
  '---',
  'atlas: dashboard',
  'widgets:',
  '  - title: Overall',
  '    kind: hero',
  '    type: task',
  '    groupBy: phase',
  '    progress: { filters: [{ key: status, operator: is, value: done }] }',
  '  - title: Per phase',
  '    kind: bar',
  '    type: task',
  '    groupBy: phase',
  '  - title: Biggest',
  '    kind: rank',
  '    type: task',
  '    groupBy: phase',
  '    limit: 2',
  '---',
  '',
].join('\n');

/** Phases 2, 10 and 11, so text order (10, 11, 2) and number order differ. */
const PHASED: readonly (readonly [string, number])[] = [
  ['done', 2],
  ['done', 10],
  ['done', 10],
  ['doing', 10],
  ['done', 11],
  ['backlog', 11],
];

test('bars run in number order and call out the latest phase', async ({ page }) => {
  await openDashboard(page, PHASES, PHASED);

  const bars = page.getByLabel('Per phase');
  await expect(bars.locator('.bars__label')).toHaveText(['2', '10', '11']);
  await expect(bars.locator('.bars__column--current .bars__label')).toHaveText('11');
  await expect(bars.locator('.widget__total')).toHaveText('6');
});

test('the hero counts the whole, the done part and the latest phase', async ({ page }) => {
  await openDashboard(page, PHASES, PHASED);

  const hero = page.getByLabel('Overall');
  await expect(hero.locator('.hero__total')).toHaveText('6');
  await expect(hero.locator('.hero__part-value')).toHaveText('4');
  await expect(hero.getByRole('img', { name: '67% of all' })).toBeVisible();
  await expect(hero.getByText('across 3 phases')).toBeVisible();
  await expect(hero.locator('.hero__foot-value')).toHaveText('+2');
});

test('a ranking lists the largest groups and how much of the whole they hold', async ({ page }) => {
  await openDashboard(page, PHASES, PHASED);

  const rank = page.getByLabel('Biggest');
  await expect(rank.locator('.rank__name')).toHaveText(['Phase 10', 'Phase 11']);
  await expect(rank.getByText('5 of 6')).toBeVisible();
});
