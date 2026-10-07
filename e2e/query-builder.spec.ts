/**
 * Phase 24 (U-23): a query across types, built with dropdowns, read as text,
 * kept as a view, grouped and sub-grouped, and put on a dashboard. The compiled
 * statement runs for real against SQLite in the stand-in host.
 */
import { expect, test, type Page } from '@playwright/test';
import { createVault, expectFile, installHost, sidebarSection, type FakeVault } from './host.ts';

const front = (lines: string[], body: string) => ['---', ...lines, '---', '', body, ''].join('\n');

const TASK_TYPE = front(
  [
    'name: task',
    'label: Task',
    'properties:',
    '  status:',
    '    kind: select',
    '    options: [backlog, doing, done]',
    '  project:',
    '    kind: relation',
    '    target: project',
  ],
  '# Task',
);
const PROJECT_TYPE = front(
  [
    'name: project',
    'label: Project',
    'properties:',
    '  owner:',
    '    kind: relation',
    '    target: person',
  ],
  '# Project',
);
const PERSON_TYPE = front(['name: person', 'label: Person'], '# Person');

const task = (status: string, project: string, body = '') =>
  front(['type: task', `status: ${status}`, `project: "[[${project}]]"`], body);

async function openVault(page: Page): Promise<FakeVault> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const vault = await createVault();
  for (const folder of [
    '.atlas/types',
    '.atlas/views',
    '.atlas/dashboards',
    'people',
    'projects',
    'tasks',
  ]) {
    await vault.mkdir(folder);
  }
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  await vault.write('.atlas/types/project.md', PROJECT_TYPE);
  await vault.write('.atlas/types/person.md', PERSON_TYPE);
  await vault.write(
    '.atlas/dashboards/Home.md',
    front(['atlas: dashboard', 'widgets: []'], '# Home'),
  );
  await vault.write('people/Julie.md', front(['type: person'], '# Julie'));
  await vault.write('people/Sam.md', front(['type: person'], '# Sam'));
  await vault.write('projects/Atlas.md', front(['type: project', 'owner: "[[Julie]]"'], '# Atlas'));
  await vault.write('projects/Garden.md', front(['type: project', 'owner: "[[Sam]]"'], '# Garden'));
  await vault.write('tasks/Write ADR.md', task('doing', 'Atlas', 'For #q3.'));
  await vault.write('tasks/Ship.md', task('done', 'Atlas', 'Also #q3.'));
  await vault.write('tasks/Weed.md', task('backlog', 'Garden', 'Not Julie’s, but #q3.'));
  await vault.write('tasks/Plan.md', task('doing', 'Atlas'));

  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

const pick = (page: Page, name: string, option: string) =>
  page.getByRole('combobox', { name, exact: true }).selectOption(option);

const rows = (page: Page) => page.locator('.qresult__title');

test('a query across types is built in the builder, read as text, saved, grouped and put on a dashboard', async ({
  page,
}) => {
  const vault = await openVault(page);
  await page.getByRole('button', { name: 'New in Views' }).click();
  await page.getByRole('menuitem', { name: 'New query' }).click();
  const builder = page.getByRole('region', { name: 'Query builder' });
  await expect(builder).toBeVisible();

  // From: task and project, whichever type the page started on.
  await pick(page, 'Add type', 'task');
  await pick(page, 'Add type', 'project');
  for (const extra of await builder.getByRole('button', { name: /^Remove Person$/ }).all()) {
    await extra.click();
  }
  const text = page.getByLabel('Query text');
  await expect(text).toHaveText('FROM task, project');

  // Where: not done, owned (through the project) by Julie, tagged #q3.
  await builder.getByRole('button', { name: 'Add condition' }).click();
  await pick(page, 'Field 1', 'status');
  await pick(page, 'Condition 1', 'is not');
  await pick(page, 'Value 1', 'done');
  await builder.getByRole('button', { name: 'Add condition' }).click();
  await pick(page, 'Field 2', 'project.owner');
  await pick(page, 'Value 2', 'Julie');
  await builder.getByRole('button', { name: 'Add condition' }).click();
  await pick(page, 'Field 3', 'tag');
  await pick(page, 'Value 3', 'q3');

  const written =
    'FROM task, project WHERE status != done AND project.owner = [[Julie]] AND tag = #q3';
  await expect(text).toHaveText(written);
  await expect(rows(page)).toHaveText(['Write ADR']);

  // The same query as text; a mistake is pointed at, and fixing it runs again.
  const modes = page.getByRole('radiogroup', { name: 'Edit the query as' });
  await modes.getByRole('radio', { name: 'Text' }).click();
  const editor = page.getByRole('textbox', { name: 'Query' });
  await expect(editor).toHaveValue(written);
  await editor.fill(written.replace('status !=', 'stauts !='));
  const problem = page.getByRole('alert');
  await expect(problem).toContainText('Line 1, column 26');
  await expect(problem).toContainText('A task or project has no field called stauts.');
  await expect(problem.locator('mark')).toHaveText('stauts');
  await editor.fill(`${written} SORT BY title`);
  await expect(problem).toHaveCount(0);
  await expect(rows(page)).toHaveText(['Write ADR']);

  // Kept as a view: the text as written, listed in the sidebar and in the tabs.
  await page.getByRole('button', { name: 'Save as view' }).click();
  await page.getByRole('textbox', { name: 'View name' }).fill('Julie q3');
  await page.getByRole('button', { name: 'Save view' }).click();
  await expectFile(vault, '.atlas/views/Julie q3.md').toContain(
    `query: "${written} SORT BY title"`,
  );
  const views = sidebarSection(page, 'views');
  await expect(views.getByRole('button', { name: 'Julie q3', exact: true })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Julie q3' }),
  ).toHaveAttribute('aria-pressed', 'true');

  // Opened again it is in the builder. Wider, and grouped by project, then by status.
  await expect(page.getByRole('region', { name: 'Query builder' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove condition 3' }).click();
  await page.getByRole('button', { name: 'Remove condition 2' }).click();
  await pick(page, 'Group by', 'project');
  await pick(page, 'Then group by', 'status');
  // Drawn as a saved view's table is (issue #6): a header row per group,
  // its sub-groups one step in, each with its count.
  const header = (name: RegExp, depth: number) =>
    page.locator(`.table__group-toggle[data-depth="${depth}"]`).filter({ hasText: name });
  const atlas = header(/^Atlas/, 0);
  await expect(atlas).toHaveAttribute('aria-expanded', 'true');
  await expect(atlas.locator('.table__group-count')).toHaveText('2');
  await expect(page.locator('.table__group-toggle')).toHaveText([
    /^Atlas\s*2$/,
    /^Doing\s*2$/,
    /^Garden\s*1$/,
    /^Backlog\s*1$/,
    // The projects themselves, listed FROM project, belong to no project.
    /^No value\s*2$/,
    /^No value\s*2$/,
  ]);
  await expect(page.locator('.qresult__title')).toHaveText([
    'Plan',
    'Write ADR',
    'Weed',
    'Atlas',
    'Garden',
  ]);

  // A group folds shut and says so; its neighbour stays open.
  await atlas.click();
  await expect(atlas).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.qresult__title')).toHaveText(['Weed', 'Atlas', 'Garden']);
  await expect(header(/^Garden/, 0)).toHaveAttribute('aria-expanded', 'true');

  // Saved: the query changes, and nothing else in the file does.
  await page
    .getByRole('group', { name: 'Unsaved view changes' })
    .getByRole('button', { name: 'Save view' })
    .click();
  await expectFile(vault, '.atlas/views/Julie q3.md').toContain(
    'query: "FROM task, project WHERE status != done SORT BY title GROUP BY project THEN status"',
  );
  expect(await vault.read('.atlas/views/Julie q3.md')).toContain('atlas: view');

  // On the dashboard, as a widget drawing the same groups.
  await page.getByRole('button', { name: 'Add to dashboard' }).click();
  await page.getByRole('textbox', { name: 'Widget title' }).fill('Open work');
  await page.getByRole('button', { name: 'Add widget' }).click();
  await expect(page.getByText('Added to the dashboard.')).toBeVisible();
  await expectFile(vault, '.atlas/dashboards/Home.md').toContain('kind: query');
  await sidebarSection(page, 'dashboards')
    .getByRole('button', { name: 'Home', exact: true })
    .click();
  const widget = page.getByRole('region', { name: 'Open work' });
  await expect(widget.getByRole('group', { name: 'Atlas', exact: true })).toBeVisible();
  await expect(widget.getByRole('button', { name: 'Weed' })).toBeVisible();
});

test('a query the builder cannot show stays text, and says why', async ({ page }) => {
  await openVault(page);
  await page.getByRole('button', { name: 'New in Views' }).click();
  await page.getByRole('menuitem', { name: 'New query' }).click();
  await expect(page.getByRole('region', { name: 'Query builder' })).toBeVisible();

  const modes = page.getByRole('radiogroup', { name: 'Edit the query as' });
  await modes.getByRole('radio', { name: 'Text' }).click();
  await page
    .getByRole('textbox', { name: 'Query' })
    .fill('FROM task WHERE status = doing AND (project = [[Garden]] OR status = backlog)');
  await expect(rows(page)).toHaveText([]);
  await page
    .getByRole('textbox', { name: 'Query' })
    .fill('FROM task WHERE status = backlog OR (status = doing AND project = [[Atlas]])');
  await expect(rows(page)).toHaveText(['Plan', 'Weed', 'Write ADR']);

  await modes.getByRole('radio', { name: 'Builder' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'cannot show' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Query builder' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Query' })).toHaveValue(
    'FROM task WHERE status = backlog OR (status = doing AND project = [[Atlas]])',
  );
});
