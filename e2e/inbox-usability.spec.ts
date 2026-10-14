import { expect, test, type Page } from '@playwright/test';
import { createVault, expectFile, installHost, type FakeHost, type FakeVault } from './host.ts';

/**
 * The Inbox stays usable however much waits in it (#164-#167): the list keeps
 * its room below a long Proposals section, and every row can be reached.
 */

const TASK_TYPE = [
  '---',
  'name: task',
  'properties:',
  '  status:',
  '    kind: select',
  '    options: [next, doing, done]',
  '---',
  '',
].join('\n');

const proposal = (n: number) =>
  [
    '---',
    'type: proposal',
    'kind: task',
    'state: open',
    'confidence: high',
    `made_by: after-meeting · run ${n}`,
    'payload:',
    `  title: Follow up with Larkspur Payroll ${n}`,
    '  properties:',
    '    status: next',
    '---',
    '',
    `Mara Quill asked for it on call ${n}.`,
    '',
  ].join('\n');

const captured = (n: number) =>
  ['---', 'type: task', 'status: next', '---', '', `Captured line ${n}.`, ''].join('\n');

async function openInbox(
  page: Page,
  { proposals, waiting }: { proposals: number; waiting: number },
): Promise<{ vault: FakeVault; host: FakeHost }> {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('Inbox/Proposals');
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  for (let n = 1; n <= proposals; n += 1) {
    await vault.write(`Inbox/Proposals/Proposal ${n}.md`, proposal(n));
  }
  await Promise.all(
    Array.from({ length: waiting }, (_, n) => vault.write(`Inbox/Item ${n + 1}.md`, captured(n))),
  );
  const host = await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  await page.getByRole('button', { name: /^Inbox/ }).click();
  return { vault, host };
}

/** The task the first card would make, by the number its title ends in. */
async function firstCard(page: Page) {
  const card = cards(page).first();
  const label = (await card.getAttribute('aria-label')) ?? '';
  const title = /Follow up with Larkspur Payroll \d+/.exec(label)?.[0] ?? '';
  expect(title).not.toBe('');
  return { card, label, task: `${title}.md`, title };
}

const inboxPage = (page: Page) => page.getByRole('article', { name: 'Inbox' });
const cards = (page: Page) =>
  page.getByRole('list', { name: 'Open proposals' }).getByRole('region');

test('the Inbox list keeps its rows whole below a long Proposals section (#164)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openInbox(page, { proposals: 8, waiting: 12 });
  await expect(cards(page)).toHaveCount(8);
  const rows = inboxPage(page).locator('.inbox__grid tbody tr');
  await expect(rows).toHaveCount(12);

  // The list is never squeezed into a box shorter than its rows: the page scrolls instead.
  const sheet = inboxPage(page).locator('.table__sheet');
  await expect
    .poll(() => sheet.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeLessThanOrEqual(1);

  // And the last row, scrolled to, shows its controls whole.
  const last = rows.last();
  await last.scrollIntoViewIfNeeded();
  const controls = last.getByRole('combobox').first();
  await expect(controls).toBeInViewport({ ratio: 1 });
});

test('an answered proposal leaves at once, and the next can be answered while it is written (#166)', async ({
  page,
}) => {
  const { vault, host } = await openInbox(page, { proposals: 3, waiting: 0 });
  await expect(cards(page)).toHaveCount(3);
  const { card, label, task, title } = await firstCard(page);
  const release = host.holdWrites(task);

  await card.getByRole('button', { name: 'Accept' }).click();

  await expect(page.getByRole('region', { name: label, exact: true })).toHaveCount(0);
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).first().getByRole('button', { name: 'Accept' })).toBeEnabled();
  expect(await vault.exists(task)).toBe(false);

  release();
  await expect(page.getByRole('status').filter({ hasText: `Accepted: ${title}.` })).toBeVisible();
  await expectFile(vault, task).toContain('type: task');
});

test('a proposal whose write fails comes back, saying why (#166)', async ({ page }) => {
  const { vault, host } = await openInbox(page, { proposals: 2, waiting: 0 });
  await expect(cards(page)).toHaveCount(2);
  const { card, label, task } = await firstCard(page);
  host.failNext('create_note', 'The disk is full.');

  await card.getByRole('button', { name: 'Accept' }).click();

  const back = page.getByRole('region', { name: label, exact: true });
  await expect(back).toBeVisible();
  await expect(back.getByText(/The disk is full/)).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  expect(await vault.exists(task)).toBe(false);
});
