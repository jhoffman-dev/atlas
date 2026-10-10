import { expect, test, type Page } from '@playwright/test';
import { createVault, expectFile, installHost, type FakeVault } from './host.ts';

/**
 * P30-01: PARA. Opening a vault writes the PARA types it lacks and leaves the
 * ones it has alone; capture lands in the Inbox; the Inbox files a note under
 * a project or an area — into that project's folder, linked — and offers
 * nothing else to file it under.
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

/** James's own project type, with a property Atlas never wrote. */
const PROJECT_TYPE = [
  '---',
  'name: project',
  'label: Project',
  'properties:',
  '  budget:',
  '    kind: number',
  '    label: Budget',
  '---',
  '',
  '# Project',
  '',
].join('\n');

const TASK_TEMPLATE = ['---', 'type: task', 'status: backlog', '---', '', '# ', '', ''].join('\n');

const note = (frontmatter: string[], body: string) =>
  ['---', ...frontmatter, '---', '', body, ''].join('\n');

async function openParaVault(page: Page): Promise<FakeVault> {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/templates');
  await vault.mkdir('Projects');
  await vault.mkdir('Areas');
  await vault.mkdir('People');
  await vault.mkdir('Inbox/Meetings');
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  await vault.write('.atlas/types/project.md', PROJECT_TYPE);
  await vault.write('.atlas/templates/Task.md', TASK_TEMPLATE);
  await vault.write('Projects/Atlas.md', note(['type: project', 'budget: 10'], 'The app.'));
  await vault.write('Areas/Garden.md', note(['type: area'], 'Beds and seeds.'));
  await vault.write('People/Mara Quill.md', note(['type: person'], 'A neighbour.'));
  await vault.write(
    'Inbox/Meetings/2026-10-01 Seed swap.md',
    note(['type: meeting'], 'Who brings what.'),
  );

  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

const goTo = (page: Page) => page.getByRole('list', { name: 'Go to' });
const inboxPage = (page: Page) => page.getByRole('article', { name: 'Inbox' });

async function capture(page: Page, line: string) {
  await page.keyboard.down('Meta');
  await page.keyboard.down('Shift');
  await page.keyboard.press('n');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Meta');
  const field = page.getByRole('textbox', { name: 'What needs doing' });
  await field.fill(line);
  await field.press('Enter');
  await page.keyboard.press('Escape');
}

test('opening a vault adds the Area type it lacks, and leaves the project type James wrote', async ({
  page,
}) => {
  const vault = await openParaVault(page);

  await expectFile(vault, '.atlas/types/area.md').toContain('name: area');
  await expectFile(vault, '.atlas/types/resource.md').toContain('name: resource');
  expect(await vault.read('.atlas/types/project.md')).toBe(PROJECT_TYPE);
});

test('a captured task waits in the Inbox, and Process files it under its project and links it', async ({
  page,
}) => {
  const vault = await openParaVault(page);
  await capture(page, 'Renew the passport');
  await expectFile(vault, 'Inbox/Renew the passport.md').toContain('type: task');

  await goTo(page)
    .getByRole('button', { name: /^Inbox/ })
    .click();
  const inbox = inboxPage(page);
  await expect(inbox.getByRole('button', { name: 'Renew the passport' })).toBeVisible();
  // Whatever arrived, of any type, waits here — a meeting in Inbox/Meetings too.
  await expect(inbox.getByRole('button', { name: '2026-10-01 Seed swap' })).toBeVisible();
  await expect(inbox.getByText('Meeting · Meetings')).toBeVisible();

  const fileUnder = inbox.getByRole('combobox', { name: 'File Renew the passport under' });
  // Projects and areas are offered; a person is not something to file under.
  await expect(fileUnder.getByRole('option', { name: 'Atlas' })).toHaveCount(1);
  await expect(fileUnder.getByRole('option', { name: 'Garden' })).toHaveCount(1);
  await expect(fileUnder.getByRole('option', { name: 'Mara Quill' })).toHaveCount(0);

  await fileUnder.selectOption({ label: 'Atlas' });

  await expectFile(vault, 'Projects/Atlas/Renew the passport.md').toContain('[[Atlas]]');
  const filed = await vault.read('Projects/Atlas/Renew the passport.md');
  expect(filed).toMatch(/^project: "?\[\[Atlas\]\]"?$/m);
  expect(filed).toContain('type: task');
  expect(await vault.exists('Inbox/Renew the passport.md')).toBe(false);
  await expect(inbox.getByRole('button', { name: 'Renew the passport' })).toHaveCount(0);
  await expect(inbox.getByRole('button', { name: '2026-10-01 Seed swap' })).toBeVisible();
});

test('the Inbox files a meeting under an area, into the area’s folder', async ({ page }) => {
  const vault = await openParaVault(page);
  await goTo(page)
    .getByRole('button', { name: /^Inbox/ })
    .click();

  await inboxPage(page)
    .getByRole('combobox', { name: 'File 2026-10-01 Seed swap under' })
    .selectOption({ label: 'Garden' });

  await expectFile(vault, 'Areas/Garden/2026-10-01 Seed swap.md').toContain('[[Garden]]');
  expect(await vault.exists('Inbox/Meetings/2026-10-01 Seed swap.md')).toBe(false);
});

test('a task’s project, once its type is extended, offers projects and areas alike', async ({
  page,
}) => {
  const vault = await openParaVault(page);
  await goTo(page)
    .getByRole('button', { name: /^Inbox/ })
    .click();

  const offer = inboxPage(page).getByRole('complementary', {
    name: 'Link your types to projects and areas',
  });
  await expect(offer).toContainText('task gains Project, linking project or area notes.');
  // Nothing is written to a type the vault already has until James says so.
  expect(await vault.read('.atlas/types/task.md')).toBe(TASK_TYPE);
  await offer.getByRole('button', { name: 'Add to the types' }).click();
  await expectFile(vault, '.atlas/types/task.md').toContain('- area');
  expect(await vault.read('.atlas/types/task.md')).toContain(
    '    options: [backlog, doing, done]\n',
  );

  await capture(page, 'Order seeds');
  await expectFile(vault, 'Inbox/Order seeds.md').toContain('type: task');
  const picker = page.getByRole('region', { name: 'Properties' }).getByLabel('Project');
  await expect(picker.locator('optgroup')).toHaveCount(2);
  await expect(picker.getByRole('option', { name: 'Atlas' })).toHaveCount(1);
  await expect(picker.getByRole('option', { name: 'Garden' })).toHaveCount(1);
  await expect(picker.getByRole('option', { name: 'Mara Quill' })).toHaveCount(0);
});
