import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createVault, emitVaultChanged, expectFile, installHost, type FakeVault } from './host.ts';

/**
 * P28-04: a meeting n8n commits into the vault arrives by pull, and the
 * import checks it as the index hears of it — a valid one shows in the Inbox
 * untouched, a second copy is archived, and a broken one is marked where it
 * landed and listed in the Inbox with why.
 */

const shipped = (path: string) =>
  readFileSync(new URL(`../vault/${path}`, import.meta.url), 'utf8');
const VALID = readFileSync(
  new URL(
    '../packages/domain/src/meetings/fixtures/valid/gemini-platform-sync.md',
    import.meta.url,
  ),
  'utf8',
);

const FIRST = 'Inbox/Meetings/2026-09-29 Platform weekly sync.md';
const COPY = 'Inbox/Meetings/2026-09-29 Platform weekly sync (gemini 7f3a9c21).md';
const BROKEN = 'Inbox/Meetings/2026-10-02 Vendor call.md';
const BROKEN_TEXT = [
  '---',
  'type: meeting',
  'atlas_import: meeting/v1',
  "title: 'Vendor call'",
  "date: '2026-10-02'",
  "start: '15:00'",
  'provider: gemini',
  '---',
  '',
  '## Summary',
  '',
  'Tobias Fenn walked Larkspur Payroll through the file layout.',
  '',
].join('\n');

async function openVault(page: Page): Promise<FakeVault> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const vault = await createVault();
  for (const folder of ['.atlas/types', '.atlas/views', 'Inbox/Meetings', 'tasks']) {
    await vault.mkdir(folder);
  }
  for (const type of ['task', 'meeting', 'person', 'company', 'project']) {
    await vault.write(`.atlas/types/${type}.md`, shipped(`.atlas/types/${type}.md`));
  }
  await vault.write('.atlas/views/Inbox.md', shipped('.atlas/views/Inbox.md'));
  await vault.write('tasks/Call Mara.md', '---\ntype: task\nstatus: backlog\n---\n\n# Call Mara\n');

  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

/** A file landing as a pull lands it: written, then the watcher says so. */
async function arrive(page: Page, vault: FakeVault, path: string, text: string) {
  await vault.write(path, text);
  await emitVaultChanged(page, [path]);
}

const inboxRow = (page: Page) =>
  page.getByRole('list', { name: 'Go to' }).getByRole('button', { name: /^Inbox/ });

test('a meeting that arrives shows in the Inbox untouched, and a second copy is archived', async ({
  page,
}) => {
  const vault = await openVault(page);

  await arrive(page, vault, FIRST, VALID);
  await expect(inboxRow(page)).toHaveText(/Inbox\s*2$/);
  await inboxRow(page).click();
  const inbox = page.getByRole('main');
  await expect(inbox.getByText('Platform weekly sync', { exact: true })).toBeVisible();
  await expect(inbox.getByText('Call Mara', { exact: true })).toBeVisible();
  expect(await vault.read(FIRST)).toBe(VALID);

  await arrive(page, vault, COPY, VALID);
  await expectFile(vault, `Archive/${COPY}`).toContain('atlas_duplicate_of:');
  expect(await vault.exists(COPY)).toBe(false);
  expect(await vault.read(FIRST)).toBe(VALID);
  await expect(inboxRow(page)).toHaveText(/Inbox\s*2$/);
  await expect(inbox.getByText('Platform weekly sync', { exact: true })).toHaveCount(1);
});

test('a meeting file that breaks the contract is marked where it landed and listed in the Inbox', async ({
  page,
}) => {
  const vault = await openVault(page);

  await arrive(page, vault, BROKEN, BROKEN_TEXT);
  await expectFile(vault, BROKEN).toMatch(/^atlas_import_error: .*external_id is required/m);
  expect(await vault.read(BROKEN)).toContain('Tobias Fenn walked Larkspur Payroll');

  await inboxRow(page).click();
  const inbox = page.getByRole('main');
  await expect(inbox.getByText('Vendor call', { exact: true })).toBeVisible();
  await expect(inbox.getByText(/external_id is required/)).toBeVisible();
});
