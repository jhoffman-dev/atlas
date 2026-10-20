/**
 * The link preview card, wired to the app (slice 6b, #302; Q22): resting on
 * a wikilink in a note — in a pane or in the peek — or on a relation value
 * in a table for about 400 ms shows a card with the note's title, its type
 * and folder, and its first lines, read from its file. Moving off the link
 * hides it; a click peeks rather than waits for the card.
 */
import { expect, test, type Page } from './fixtures.ts';
import { createVault, installHost, sidebarSection } from './host.ts';

const TASK_TYPE = [
  '---',
  'name: task',
  'label: Task',
  'properties:',
  '  status:',
  '    kind: select',
  '    options: [next, done]',
  '  project:',
  '    kind: relation',
  '    target: project',
  '---',
  '',
].join('\n');
const PROJECT_TYPE = '---\nname: project\nlabel: Project\nproperties:\n  goal: text\n---\n';
const TABLE = [
  '---',
  'atlas: view',
  'type: task',
  'layout: table',
  'columns: [status, project]',
  '---',
  '',
].join('\n');

/** The vault opened; `clock` installs Playwright's clock first, so the test moves time on itself. */
async function openVault(page: Page, { clock = false } = {}): Promise<void> {
  const vault = await createVault();
  for (const folder of ['.atlas/types', '.atlas/views', 'Projects', 'Tasks']) {
    await vault.mkdir(folder);
  }
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  await vault.write('.atlas/types/project.md', PROJECT_TYPE);
  await vault.write('.atlas/views/Open tasks.md', TABLE);
  await vault.write(
    'Projects/Larkspur Payroll.md',
    '---\ntype: project\n---\n\n# Larkspur Payroll\n\nMove the payroll runs to the new provider.\n\nMara Quill owns the cut-over.\n',
  );
  await vault.write(
    'Tasks/Write the runbook.md',
    '---\ntype: task\nstatus: next\nproject: "[[Larkspur Payroll]]"\n---\n\n# Write the runbook\n\nSee [[Larkspur Payroll]] first.\n',
  );
  await vault.write(
    'Plan.md',
    '# Plan\n\nThis week: [[Larkspur Payroll]], then [[Nowhere yet]].\n',
  );
  await installHost(page, vault);
  if (clock) await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
}

async function openPlan(page: Page) {
  await sidebarSection(page, 'userSpace')
    .getByRole('treeitem', { name: 'Plan', exact: true })
    .click();
  await expect(page.getByRole('article', { name: 'Plan' })).toBeVisible();
}

const card = (page: Page) => page.getByRole('tooltip');

test('resting on a wikilink shows the note’s card with its first lines, and leaving hides it', async ({
  page,
}) => {
  await openVault(page);
  await openPlan(page);
  await page.locator('.editor [data-wikilink="Larkspur Payroll"]').hover();

  await expect(card(page)).toBeVisible();
  await expect(card(page)).toContainText('Larkspur Payroll');
  await expect(card(page)).toContainText('Project · Projects');
  await expect(card(page)).toContainText('Move the payroll runs to the new provider.');

  await page.mouse.move(0, 0);
  await expect(card(page)).toHaveCount(0);
});

test('a link to no note shows no card, however long the pointer rests', async ({ page }) => {
  await openVault(page, { clock: true });
  await openPlan(page);
  await page.locator('.editor [data-wikilink="Nowhere yet"]').hover();
  await page.clock.runFor(2_000);
  await expect(card(page)).toHaveCount(0);

  // Control, on the same clock: a link that leads somewhere does show its card.
  await page.locator('.editor [data-wikilink="Larkspur Payroll"]').hover();
  await page.clock.runFor(500);
  await expect(card(page)).toContainText('Larkspur Payroll');
});

test('a relation value in a table previews its note, and a key press hides the card', async ({
  page,
}) => {
  await openVault(page);
  await sidebarSection(page, 'views')
    .getByRole('button', { name: /^Open tasks/ })
    .click();
  const value = page.locator('.table [data-link-path="Projects/Larkspur Payroll.md"]').first();
  await value.hover();
  await expect(card(page)).toContainText('Move the payroll runs to the new provider.');
  await page.keyboard.press('Shift');
  await expect(card(page)).toHaveCount(0);
});

test('a wikilink in the peeked note previews too', async ({ page }) => {
  await openVault(page);
  await sidebarSection(page, 'views')
    .getByRole('button', { name: /^Open tasks/ })
    .click();
  await page.locator('.table__link', { hasText: 'Write the runbook' }).click();
  const peek = page.getByRole('dialog', { name: 'Write the runbook' });
  await expect(peek).toBeVisible();
  await peek.locator('[data-wikilink="Larkspur Payroll"]').hover();
  await expect(card(page)).toContainText('Mara Quill owns the cut-over.');
});
