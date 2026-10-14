import { expect, test, type Page } from '@playwright/test';
import { createVault, installHost, type FakeVault } from './host.ts';

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
): Promise<FakeVault> {
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
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  await page.getByRole('button', { name: /^Inbox/ }).click();
  return vault;
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
