import { expect, test, type Page } from '@playwright/test';
import { createVault, expectFile, installHost } from './host.ts';

/**
 * U-13: the floating add button — Task by default, the types set in Settings
 * → Quick add, a speed dial for several, and a place of its own that it snaps
 * to and keeps.
 */

const TASK_TYPE = [
  '---',
  'name: task',
  'label: Task',
  'properties:',
  '  status:',
  '    kind: select',
  '    options: [backlog, doing, done]',
  '    required: true',
  '  due: date',
  '  project:',
  '    kind: relation',
  '    target: project',
  '---',
  '',
].join('\n');

const PROJECT_TYPE = ['---', 'name: project', 'label: Project', '---', ''].join('\n');

const TASK_TEMPLATE = ['---', 'type: task', 'status: backlog', 'due:', '---', '', ''].join('\n');

async function openVault(page: Page, { settings }: { settings?: string } = {}) {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/templates');
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  await vault.write('.atlas/types/project.md', PROJECT_TYPE);
  await vault.write('.atlas/templates/Task.md', TASK_TEMPLATE);
  await vault.write('Garden.md', ['---', 'type: project', '---', '', 'Beds.', ''].join('\n'));
  if (settings !== undefined) await vault.write('.atlas/settings.md', settings);

  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

const fab = (page: Page) => page.locator('.fab__button');

async function addFromPopover(page: Page, type: string, name: string) {
  const popover = page.getByRole('dialog', { name: `New ${type}` });
  await expect(popover).toBeVisible();
  await popover.getByRole('textbox', { name: `${type} name` }).fill(name);
  await popover.getByRole('textbox', { name: `${type} name` }).press('Enter');
  await expect(popover).toHaveCount(0);
}

test('with only Task, the button asks for a task at once and adds it', async ({ page }) => {
  const vault = await openVault(page);

  await expect(fab(page)).toHaveAccessibleName('New Task');
  await fab(page).click();

  // Straight to the popover: no dial for one type.
  await expect(page.getByRole('menu', { name: 'Add' })).toHaveCount(0);
  const popover = page.getByRole('dialog', { name: 'New Task' });
  await expect(popover.getByLabel('Status')).toHaveValue('backlog');
  await popover.getByLabel('Status').selectOption('doing');
  await popover.getByLabel('Project').selectOption({ label: 'Garden' });
  await addFromPopover(page, 'Task', 'Renew the passport');

  // From the vault's template, with what was filled in.
  await expectFile(vault, 'Renew the passport.md').toContain('type: task');
  const written = await vault.read('Renew the passport.md');
  expect(written).toContain('status: doing');
  expect(written).toContain('project: "[[Garden]]"');

  // It stays where it was, and says so with a way to open it.
  const toast = page.getByRole('status').filter({ hasText: 'Task added' });
  await expect(toast).toBeVisible();
  const opened = page.getByRole('article', { name: 'Renew the passport', exact: true });
  await expect(opened).toHaveCount(0);
  await toast.getByRole('button', { name: 'Open' }).click();
  await expect(opened).toBeVisible();
});

test('Alt+Cmd+N does what the button does, and Cmd+Enter opens what it adds', async ({ page }) => {
  const vault = await openVault(page);

  await page.keyboard.press('Alt+Meta+n');
  const popover = page.getByRole('dialog', { name: 'New Task' });
  await expect(popover).toBeVisible();
  await popover.getByRole('textbox', { name: 'Task name' }).fill('Call the bank');
  await popover.getByRole('textbox', { name: 'Task name' }).press('Meta+Enter');

  await expectFile(vault, 'Call the bank.md').toContain('type: task');
  await expect(page.getByRole('article', { name: 'Call the bank', exact: true })).toBeVisible();
  // Alt+Cmd+N is not also Cmd+N: no blank note was made beside it.
  await expect(page.getByRole('treeitem', { name: 'Untitled', exact: true })).toHaveCount(0);
});

test('Task and Project set in Settings: the button opens a dial and adds a project', async ({
  page,
}) => {
  const vault = await openVault(page);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const quickAdd = page.getByRole('region', { name: 'Quick add' });
  await quickAdd
    .getByRole('combobox', { name: 'Add a type to quick add' })
    .selectOption({ label: 'Project' });
  await expect(quickAdd.getByText('Project', { exact: true })).toBeVisible();
  await expectFile(vault, '.atlas/settings.md').toMatch(/quickAdd:[\s\S]*task[\s\S]*project/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);

  await expect(fab(page)).toHaveAccessibleName('Add…');
  await fab(page).click();
  const dial = page.getByRole('menu', { name: 'Add' });
  await expect(dial.getByRole('menuitem')).toHaveText(['Task', 'Project']);
  await dial.getByRole('menuitem', { name: 'Project' }).click();

  await addFromPopover(page, 'Project', 'Kitchen');
  await expectFile(vault, 'Kitchen.md').toContain('type: project');
});

test('Escape collapses the dial and gives the focus back to the button', async ({ page }) => {
  await openVault(page, { settings: ['---', 'quickAdd: [task, project]', '---', ''].join('\n') });

  await fab(page).click();
  const dial = page.getByRole('menu', { name: 'Add' });
  await expect(dial).toBeVisible();
  await expect(dial.getByRole('menuitem', { name: 'Task' })).toBeFocused();

  await page.keyboard.press('Escape');

  await expect(dial).toHaveCount(0);
  await expect(fab(page)).toBeFocused();
});

/** Where the button's centre is, on screen. */
async function centreOf(page: Page) {
  const box = await fab(page).boundingBox();
  if (box === null) throw new Error('the add button is not on screen');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function panelBox(page: Page) {
  const box = await page.locator('.fab-layer').boundingBox();
  if (box === null) throw new Error('the add button has no layer');
  return box;
}

test('dragged to the top left, it snaps there and stays there after a reload', async ({ page }) => {
  await openVault(page);
  const panel = await panelBox(page);
  const start = await centreOf(page);
  // It starts bottom-right.
  expect(start.x).toBeGreaterThan(panel.x + panel.width / 2);
  expect(start.y).toBeGreaterThan(panel.y + panel.height / 2);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(panel.x + 120, panel.y + 140, { steps: 20 });
  // Where it can land shows while it is dragged, the nearest marked.
  await expect(page.locator('.fab-layer__preview')).toHaveCount(8);
  await expect(page.locator('.fab-layer__preview[data-near="true"]')).toHaveAttribute(
    'data-anchor',
    'top-left',
  );
  await page.mouse.up();

  await expect(page.locator('.fab')).toHaveAttribute('data-anchor', 'top-left');
  await expect(page.locator('.fab-layer__preview')).toHaveCount(0);
  // A drag is not a press: nothing opened.
  await expect(page.getByRole('dialog', { name: 'New Task' })).toHaveCount(0);
  const expectTopLeft = async () => {
    await expect(async () => {
      const at = await centreOf(page);
      expect(at.x).toBeLessThan(panel.x + 100);
      // Below the page bar, not over it.
      expect(at.y).toBeGreaterThan(panel.y + 52 + 28);
      expect(at.y).toBeLessThan(panel.y + 140);
    }).toPass();
  };
  await expectTopLeft();

  // A reload stands in for quitting and relaunching.
  await page.reload();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  await expect(page.locator('.fab')).toHaveAttribute('data-anchor', 'top-left');
  await expectTopLeft();
});
