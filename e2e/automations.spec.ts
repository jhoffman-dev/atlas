import { utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createVault, expectFile, installHost, type FakeVault } from './host.ts';

/**
 * Phase 25 (U-24): James's first automation — archive done tasks after 30
 * days — made from its preset, dry-run, run, and undone, with every step in
 * its log. Every claim about a note reads the disk.
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

const task = (status: string) =>
  ['---', 'type: task', `status: ${status}`, '---', '', ''].join('\n');

const RULE = '.atlas/automations/Archive done tasks after 30 days.md';
const LOG = '.atlas/automations/log/Archive done tasks after 30 days.md';
const DAY_MS = 86_400_000;

async function openTaskVault(page: Page, rules: Record<string, string> = {}): Promise<FakeVault> {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/automations');
  for (const [path, text] of Object.entries(rules)) await vault.write(path, text);
  await vault.mkdir('Tasks');
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  const old = new Date(Date.now() - 40 * DAY_MS);
  for (const [name, status, dated] of [
    ['Old done', 'done', old],
    ['Also done', 'done', old],
    ['Fresh done', 'done', null],
    ['Old doing', 'doing', old],
  ] as const) {
    await vault.write(`Tasks/${name}.md`, task(status));
    if (dated !== null) await utimes(join(vault.root, `Tasks/${name}.md`), dated, dated);
  }
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

test('the "archive done tasks after 30 days" automation: made, dry-run, run and undone', async ({
  page,
}) => {
  const vault = await openTaskVault(page);
  await page.getByRole('button', { name: 'Automations', exact: true }).click();
  const screen = page.getByRole('article', { name: 'Automations' });
  await expect(screen.getByText(/No automations yet/)).toBeVisible();

  // Made from its preset: the editor opens on it, and saving writes the rule.
  await screen.getByRole('button', { name: 'Archive done tasks after 30 days' }).click();
  const editor = screen.getByRole('region', { name: 'Automation' });
  await expect(editor.getByRole('textbox', { name: 'Name' })).toHaveValue(
    'Archive done tasks after 30 days',
  );
  await editor.getByRole('button', { name: 'Create automation' }).click();
  await expectFile(vault, RULE).toMatch(
    /^---\natlas: automation\nname: Archive done tasks after 30 days\nenabled: true\nwhen: daily at 03:00\nwhich: FROM task WHERE status = done\nolderThanDays: 30\ndo: archive\nid: Archive done tasks after 30 days\n---\n/,
  );
  await expectFile(vault, LOG).toContain('· Turned on');

  // Listed, on, with its next run; opened, its log says it was turned on.
  const list = screen.getByRole('list', { name: 'All automations' });
  await expect(list.getByRole('switch', { name: /Run Archive done tasks/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(list.getByText('Archive · Every day at 03:00')).toBeVisible();
  await list.getByRole('button', { name: 'Archive done tasks after 30 days', exact: true }).click();
  const log = editor.getByRole('region', { name: 'Run log' });
  await expect(log.getByText(/· Turned on$/)).toBeVisible();

  // The dry run lists exactly the two old done tasks, and moves nothing.
  await editor.getByRole('button', { name: 'Dry run' }).click();
  const dryRun = editor.getByRole('region', { name: 'Dry run' });
  await expect(dryRun.getByText('Would archive 2 notes.')).toBeVisible();
  const would = dryRun.getByRole('list', { name: 'Notes it would take' });
  await expect(would.getByRole('button')).toHaveText(['Also done', 'Old done'], {
    useInnerText: true,
  });
  expect(await vault.exists('Tasks/Old done.md')).toBe(true);

  // Run now archives them, and the log says so line by line.
  await editor.getByRole('button', { name: 'Run now' }).click();
  await expect.poll(() => vault.exists('Archive/Tasks/Old done.md')).toBe(true);
  await expect.poll(() => vault.exists('Archive/Tasks/Also done.md')).toBe(true);
  expect(await vault.exists('Tasks/Fresh done.md')).toBe(true);
  expect(await vault.exists('Tasks/Old doing.md')).toBe(true);
  await expect(log.getByText(/· Ran by hand$/)).toBeVisible();
  // The dry run from before the run no longer says what would happen.
  await expect(dryRun).toHaveCount(0);
  await expect(log.getByText('Archived 2 notes.')).toBeVisible();
  await expect(log.getByText('Archived Old done (Tasks/Old done.md)')).toBeVisible();
  await expectFile(vault, LOG).toContain(
    '- archived `"Tasks/Old done.md"` → `"Archive/Tasks/Old done.md"`',
  );

  // Undo puts both back where they were, and the log shows the run and the undo.
  await editor.getByRole('button', { name: 'Undo last run' }).click();
  await expect.poll(() => vault.exists('Tasks/Old done.md')).toBe(true);
  await expect.poll(() => vault.exists('Tasks/Also done.md')).toBe(true);
  expect(await vault.exists('Archive/Tasks/Old done.md')).toBe(false);
  await expectFile(vault, 'Tasks/Old done.md').toBe(task('done'));
  await expect(log.getByText(/· Undid the run of /)).toBeVisible();
  await expect(log.getByText('Put back 2 notes.')).toBeVisible();
  await expect(log.getByText(/· Ran by hand$/)).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Undo last run' })).toBeDisabled();
});

test('a rule that runs when Atlas opens runs once, on opening, and logs it', async ({ page }) => {
  const sweep = [
    '---',
    'atlas: automation',
    'name: Sweep',
    'enabled: true',
    'when: on app open',
    'which: FROM task WHERE status = done',
    'olderThanDays: 30',
    'do: archive',
    '---',
    '',
    'Clears the board each morning.',
    '',
  ].join('\n');
  const vault = await openTaskVault(page, { '.atlas/automations/Sweep.md': sweep });

  await expect.poll(() => vault.exists('Archive/Tasks/Old done.md')).toBe(true);
  await expect.poll(() => vault.exists('Archive/Tasks/Also done.md')).toBe(true);
  expect(await vault.exists('Tasks/Fresh done.md')).toBe(true);
  await expectFile(vault, '.atlas/automations/log/Sweep.md').toContain('· Ran when Atlas opened');

  // Once: opening the page, and the index settling after the run, start no other.
  await page.getByRole('button', { name: 'Automations', exact: true }).click();
  const list = page.getByRole('list', { name: 'All automations' });
  await expect(list.getByText(/Archived 2 notes\./)).toBeVisible();
  const logText = await vault.read('.atlas/automations/log/Sweep.md');
  expect(logText.match(/· Ran when Atlas opened/g)).toHaveLength(1);
  // A rule written without an id is given the one its log is under (A25-01); nothing else changes.
  await expectFile(vault, '.atlas/automations/Sweep.md').toBe(
    sweep.replace('do: archive\n---', 'do: archive\nid: Sweep\n---'),
  );
});
