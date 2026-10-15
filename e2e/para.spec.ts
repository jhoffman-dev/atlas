import { expect, test, type Page } from '@playwright/test';
import {
  createVault,
  emitVaultChanged,
  expectFile,
  installHost,
  sidebarSection,
  type FakeVault,
} from './host.ts';

/**
 * #213: PARA is a property of one Project type. A new project is a project;
 * it links an area; archiving it sets its PARA where it stands, which puts it
 * out of the pickers and the sidebar's count; restoring sets it back.
 */

const PROJECT_TYPE = [
  '---',
  'name: project',
  'label: Project',
  'properties:',
  '  para:',
  '    kind: select',
  '    label: PARA',
  '    options: [project, area, resource, archive]',
  '  area:',
  '    kind: relation',
  '    label: Area',
  '    target: area',
  '---',
  '',
  '# Project',
  '',
].join('\n');

const TASK_TYPE = [
  '---',
  'name: task',
  'label: Task',
  'properties:',
  '  project:',
  '    kind: relation',
  '    label: Project',
  '    target: [project, area]',
  '---',
  '',
].join('\n');

const note = (frontmatter: string[], body = '') =>
  ['---', ...frontmatter, '---', '', body, ''].join('\n');

async function openParaVault(page: Page): Promise<FakeVault> {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.write('.atlas/types/project.md', PROJECT_TYPE);
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  await vault.write('Atlas.md', note(['type: project', 'para: project'], 'The app.'));
  await vault.write('Garden.md', note(['type: project', 'para: area'], 'Beds and seeds.'));
  await vault.write('Manual.md', note(['type: project', 'para: resource'], 'How the mower works.'));
  await vault.write('Call the bank.md', note(['type: task'], 'About the loan.'));
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

const properties = (page: Page) => page.getByRole('region', { name: 'Properties' });
const projectType = (page: Page) =>
  sidebarSection(page, 'types').getByRole('button', { name: /^Project, \d+ notes?$/ });

async function pageMenu(page: Page, item: 'Archive' | 'Unarchive') {
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

test('a new project is a project, links an area, and archives and restores by its PARA where it stands', async ({
  page,
}) => {
  const vault = await openParaVault(page);
  await expect(projectType(page)).toHaveAccessibleName('Project, 3 notes');

  // Create: the type's own New makes a project, and it says so.
  await projectType(page).click();
  await page
    .getByRole('article', { name: 'Project', exact: true })
    .getByRole('button', { name: 'New project', exact: true })
    .click();
  await expect(page.getByRole('article', { name: 'New Project' })).toBeVisible();
  await expectFile(vault, 'New Project.md').toContain('para: project');
  await expect(properties(page).getByRole('combobox', { name: 'PARA' })).toHaveValue('project');

  // Set Area: its picker offers areas only, and it is optional.
  const area = properties(page).getByRole('combobox', { name: 'Area' });
  await expect.poll(() => area.locator('option').allTextContents()).toContain('Garden');
  expect(await area.locator('option').allTextContents()).not.toContain('Atlas');
  expect(await area.locator('option').allTextContents()).not.toContain('Manual');
  await area.selectOption({ label: 'Garden' });
  await expectFile(vault, 'New Project.md').toContain('area: "[[Garden]]"');
  await expect(projectType(page)).toHaveAccessibleName('Project, 4 notes');

  // Archive: PARA becomes archive, and the file stays where it is.
  await pageMenu(page, 'Archive');
  await expectFile(vault, 'New Project.md').toContain('para: archive');
  expect(await vault.exists('Archive/New Project.md')).toBe(false);
  await expectFile(vault, 'New Project.md').toContain('area: "[[Garden]]"');
  // The host's watcher reports the app's own write, as it reports any other.
  await emitVaultChanged(page, ['New Project.md']);
  await expect(projectType(page)).toHaveAccessibleName('Project, 3 notes');

  // An archived project is not offered to a task; a resource never is; areas are.
  await page.getByRole('treeitem', { name: 'Call the bank', exact: true }).click();
  const project = properties(page).getByRole('combobox', { name: 'Project' });
  await expect.poll(() => project.locator('option').allTextContents()).toContain('Atlas');
  const offered = await project.locator('option').allTextContents();
  expect(offered).toContain('Garden');
  expect(offered).not.toContain('New Project');
  expect(offered).not.toContain('Manual');
  await expect(project.locator('optgroup')).toHaveCount(2);
  expect(
    await project
      .locator('optgroup')
      .evaluateAll((groups) => groups.map((g) => g.getAttribute('label'))),
  ).toEqual(['Projects', 'Areas']);

  // Restore: Unarchive sets PARA back to project, and it is offered again.
  await page.getByRole('treeitem', { name: 'New Project', exact: true }).click();
  await expect(page.getByRole('article', { name: 'New Project' })).toBeVisible();
  await pageMenu(page, 'Unarchive');
  await expectFile(vault, 'New Project.md').toContain('para: project');
  expect(await vault.exists('Archive/New Project.md')).toBe(false);
  await emitVaultChanged(page, ['New Project.md']);
  await expect(projectType(page)).toHaveAccessibleName('Project, 4 notes');

  await page.getByRole('treeitem', { name: 'Call the bank', exact: true }).click();
  await expect
    .poll(() =>
      properties(page)
        .getByRole('combobox', { name: 'Project' })
        .locator('option')
        .allTextContents(),
    )
    .toContain('New Project');
});
