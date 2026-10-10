import { expect, test, type Page } from '@playwright/test';
import { createVault, expectFile, installHost, type FakeVault } from './host.ts';

/**
 * P29-02: what Claude proposes waits as a note in `Inbox/Proposals/`, and the
 * Proposals page answers it. Accepting a task proposal makes the task — citing
 * the line it came from and linking its meeting — files the proposal in the
 * Archive, and offers to open the task. Every claim about a file reads the disk.
 */

const TASK_TYPE = [
  '---',
  'name: task',
  'properties:',
  '  status:',
  '    kind: select',
  '    options: [next, doing, done]',
  '  meeting:',
  '    kind: relation',
  '    target: meeting',
  '---',
  '',
].join('\n');

const MEETING = [
  '---',
  'type: meeting',
  'title: Standup',
  'date: 2026-10-01',
  '---',
  '',
  '## Transcript',
  '',
  '**Mara Quill** [~00:09:44] Can you send me the payroll file by Friday? ^t0003',
  '',
].join('\n');

const PROPOSAL = [
  '---',
  'type: proposal',
  'kind: task',
  'state: open',
  'confidence: high',
  'source: "[[2026-10-01 Standup#^t0003]]"',
  'made_by: after-meeting · run 1',
  'payload:',
  '  title: Send Mara the payroll file',
  '  properties:',
  '    status: next',
  '    meeting: "[[2026-10-01 Standup]]"',
  '---',
  '',
  'Mara asked for it on the call.',
  '',
].join('\n');

async function openProposalsVault(page: Page): Promise<FakeVault> {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('Inbox/Meetings');
  await vault.mkdir('Inbox/Proposals');
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  await vault.write('Inbox/Meetings/2026-10-01 Standup.md', MEETING);
  await vault.write('Inbox/Proposals/Send the payroll file.md', PROPOSAL);
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

test('a task proposal accepted from the Proposals page makes the task, and the task opens', async ({
  page,
}) => {
  const vault = await openProposalsVault(page);

  const row = page.getByRole('button', { name: 'Proposals, 1 waiting' });
  await expect(row).toBeVisible();
  await row.click();

  await expect(page.getByRole('article', { name: 'Proposals' })).toBeVisible();
  const card = page.getByRole('region', { name: 'Task: Send Mara the payroll file' });
  await expect(card.getByText('high confidence')).toBeVisible();
  await expect(card.getByRole('button', { name: /2026-10-01 Standup#\^t0003/ })).toBeVisible();
  await card.getByRole('button', { name: 'Accept' }).click();

  const notice = page
    .getByRole('status')
    .filter({ hasText: 'Accepted: Send Mara the payroll file.' });
  await expect(notice).toBeVisible();
  await expect(card).toHaveCount(0);
  await expect(page.getByText('Nothing to answer.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Proposals', exact: true })).toBeVisible();

  await expectFile(vault, 'Send Mara the payroll file.md').toContain(
    'source: "[[2026-10-01 Standup#^t0003]]"',
  );
  const task = await vault.read('Send Mara the payroll file.md');
  expect(task).toContain('type: task');
  expect(task).toContain('meeting: "[[2026-10-01 Standup]]"');
  expect(await vault.exists('Inbox/Proposals/Send the payroll file.md')).toBe(false);
  await expectFile(vault, 'Archive/Inbox/Proposals/Send the payroll file.md').toContain(
    'state: accepted',
  );

  await notice.getByRole('button', { name: 'Open Send Mara the payroll file' }).click();
  const opened = page.getByRole('main');
  await expect(
    opened.getByRole('heading', { level: 1, name: 'Send Mara the payroll file' }),
  ).toBeVisible();
  await expect(page.getByRole('article', { name: 'Proposals' })).toHaveCount(0);
  // Nothing waits now, and the page is closed: the sidebar row goes until something does.
  await expect(page.getByRole('button', { name: /^Proposals/ })).toHaveCount(0);
});

test('a refused accept says why on the proposal and leaves it waiting', async ({ page }) => {
  const vault = await openProposalsVault(page);
  await vault.write('Send Mara the payroll file.md', 'Made by hand.\n');

  await page.getByRole('button', { name: 'Proposals, 1 waiting' }).click();
  const card = page.getByRole('region', { name: 'Task: Send Mara the payroll file' });
  await card.getByRole('button', { name: 'Accept' }).click();

  await expect(card.getByRole('alert')).toContainText(
    'There is already a note at Send Mara the payroll file.md',
  );
  expect(await vault.read('Send Mara the payroll file.md')).toBe('Made by hand.\n');
  expect(await vault.exists('Inbox/Proposals/Send the payroll file.md')).toBe(true);
});
