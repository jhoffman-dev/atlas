import { expect, test, type Page } from '@playwright/test';
import { createVault, expectFile, installHost, type FakeVault } from './host.ts';

/**
 * #168: several proposals chosen — a box each, Shift-click for a run — are
 * accepted or rejected together, each as it would be alone, and one Undo
 * takes the accepted ones back. Every claim about a file reads the disk.
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

const proposal = (title: string) =>
  [
    '---',
    'type: proposal',
    'kind: task',
    'state: open',
    'confidence: high',
    'made_by: after-meeting · run 1',
    'payload:',
    `  title: ${title}`,
    '  properties:',
    '    status: next',
    '---',
    '',
    'Mara Quill asked for it.',
    '',
  ].join('\n');

/** An accepted task is made in the task type's home for today (#214). */
const TODAY = new Date().toLocaleDateString('en-CA');
const TASKS = `Tasks/${TODAY.slice(0, 4)}/${TODAY.slice(5, 7)}`;

const TITLES = ['Call Larkspur Payroll', 'Send Tobias the file', 'Book the room', 'Draft the memo'];

async function openProposals(page: Page): Promise<FakeVault> {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('Inbox/Proposals');
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  for (const title of TITLES) await vault.write(`Inbox/Proposals/${title}.md`, proposal(title));
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /^Inbox/ }).click();
  return vault;
}

const cards = (page: Page) =>
  page.getByRole('list', { name: 'Open proposals' }).getByRole('region');

/** The titles of the cards, in the order the list shows them. */
async function listed(page: Page): Promise<string[]> {
  const labels = await cards(page).evaluateAll((all) =>
    all.map((card) => card.getAttribute('aria-label') ?? ''),
  );
  return labels.map((label) => label.replace(/^Task: /, ''));
}

test('a run chosen with Shift-click is accepted together, and one Undo takes it back (#168)', async ({
  page,
}) => {
  const vault = await openProposals(page);
  await expect(cards(page)).toHaveCount(4);
  const order = await listed(page);
  const run = order.slice(0, 3);
  const [first = '', , third = ''] = run;

  await page.getByRole('checkbox', { name: `Select ${first}` }).click();
  await page.getByRole('checkbox', { name: `Select ${third}` }).click({ modifiers: ['Shift'] });
  await expect(page.getByRole('toolbar').getByRole('status')).toHaveText('3 selected');

  await page.getByRole('button', { name: 'Accept 3 proposals' }).click();

  await expect(cards(page)).toHaveCount(1);
  const notice = page.getByRole('status').filter({ hasText: 'Accepted 3 proposals.' });
  await expect(notice).toBeVisible();
  for (const title of run) {
    await expectFile(vault, `${TASKS}/${title}.md`).toContain('type: task');
    await expectFile(vault, `Archive/Inbox/Proposals/${title}.md`).toContain('state: accepted');
  }

  await notice.getByRole('button', { name: 'Undo' }).click();

  await expect(
    page.getByRole('status').filter({ hasText: 'Undone: 3 proposals are back in the Inbox.' }),
  ).toBeVisible();
  await expect(cards(page)).toHaveCount(4);
  for (const title of run) {
    await expect.poll(() => vault.exists(`${TASKS}/${title}.md`)).toBe(false);
    expect(await vault.exists(`${title}.md`)).toBe(false);
    await expectFile(vault, `Inbox/Proposals/${title}.md`).toContain('state: open');
  }
});

test('Select all, then Reject, files every one in the Archive as rejected (#168)', async ({
  page,
}) => {
  const vault = await openProposals(page);
  await expect(cards(page)).toHaveCount(4);

  await page.getByRole('checkbox', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Reject 4 proposals' }).click();

  await expect(page.getByText('Nothing to answer.', { exact: false })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Rejected 4 proposals.' })).toBeVisible();
  for (const title of TITLES) {
    await expectFile(vault, `Archive/Inbox/Proposals/${title}.md`).toContain('state: rejected');
    expect(await vault.exists(`${title}.md`)).toBe(false);
    expect(await vault.exists(`${TASKS}/${title}.md`)).toBe(false);
  }
});
