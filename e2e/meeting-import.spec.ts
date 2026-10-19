import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  createVault,
  emitVaultChanged,
  expectFile,
  installHost,
  type FakeHost,
  type FakeVault,
} from './host.ts';

/**
 * P28-04: a meeting n8n commits into the vault arrives by pull, and the
 * import checks it as the index hears of it — a valid one shows in the Inbox
 * with only its stamp written, a second copy is archived, and a broken one is
 * marked where it landed and listed in the Inbox with why. These vaults are
 * not synced, so this Mac is the one that imports, except where a test sets
 * sync up to show the import waits for a fresh pull (ADR-0035 part 4).
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

/** The file as the import leaves a meeting it let in: as it came, and one line after its contract line. */
const STAMPED = VALID.replace(/^(atlas_import: .*\n)/m, '$1atlas_import_outcome: imported\n');
const FIRST = 'Inbox/Meetings/2026-09-29 Platform weekly sync.md';
const COPY = 'Inbox/Meetings/2026-09-29 Platform weekly sync (gemini 7f3a9c21).md';
const BROKEN = 'Inbox/Meetings/2026-10-02 Vendor call.md';
const CAPTURED = 'Inbox/Call Mara.md';
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
  return (await openWithHost(page)).vault;
}

async function openWithHost(page: Page): Promise<{ vault: FakeVault; host: FakeHost }> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const vault = await createVault();
  for (const folder of ['.atlas/types', '.atlas/views', 'Inbox/Meetings']) {
    await vault.mkdir(folder);
  }
  for (const type of ['task', 'meeting', 'person', 'company', 'project']) {
    await vault.write(`.atlas/types/${type}.md`, shipped(`.atlas/types/${type}.md`));
  }
  await vault.write('.atlas/views/Inbox.md', shipped('.atlas/views/Inbox.md'));
  // Captured, so waiting in the Inbox beside the meetings that arrive (P30-01).
  await vault.write('Inbox/Call Mara.md', '---\ntype: task\nstatus: backlog\n---\n\n# Call Mara\n');

  const host = await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return { vault, host };
}

/** A file landing as a pull lands it: written, then the watcher says so. */
async function arrive(page: Page, vault: FakeVault, path: string, text: string) {
  await vault.write(path, text);
  await emitVaultChanged(page, [path]);
}

const inboxRow = (page: Page) =>
  page.getByRole('list', { name: 'Go to' }).getByRole('button', { name: /^Inbox/ });

test('a meeting that arrives shows in the Inbox, stamped and otherwise untouched, and a second copy is archived', async ({
  page,
}) => {
  const vault = await openVault(page);

  await arrive(page, vault, FIRST, VALID);
  // The meeting, the captured task, and its two attendees the vault has no person for,
  // proposed as people once it is let in (P29-04). It links no one, so only its stamp is written.
  await expect(inboxRow(page)).toHaveText(/Inbox\s*4$/);
  await inboxRow(page).click();
  const inbox = page.getByRole('main');
  await expect(inbox.getByText('Platform weekly sync', { exact: true })).toBeVisible();
  await expect(inbox.getByText('Call Mara', { exact: true })).toBeVisible();
  await expectFile(vault, FIRST).toBe(STAMPED);

  await arrive(page, vault, COPY, VALID);
  await expectFile(vault, `Archive/${COPY}`).toContain('atlas_duplicate_of:');
  expect(await vault.exists(COPY)).toBe(false);
  expect(await vault.read(FIRST)).toBe(STAMPED);
  // A copy is never let in, so it proposes no one again.
  await expect(inboxRow(page)).toHaveText(/Inbox\s*4$/);
  await expect(inbox.getByText('Platform weekly sync', { exact: true })).toHaveCount(1);
});

test('a copy that lands again while the import archives it still leaves the Inbox once archived (#405)', async ({
  page,
}) => {
  const { vault, host } = await openWithHost(page);
  await arrive(page, vault, FIRST, VALID);
  await expect(inboxRow(page)).toHaveText(/Inbox\s*4$/);

  // The import's own read of the copy waits. The index reads it beside the
  // captured task, rewritten first so any sync that finds the copy reads both,
  // and goes ahead.
  const captured = await vault.read(CAPTURED);
  const letImportRead = host.holdReads(COPY, { except: CAPTURED });
  await vault.write(CAPTURED, captured);
  await vault.write(COPY, VALID);
  await emitVaultChanged(page, [COPY, CAPTURED]);
  await expect(inboxRow(page)).toHaveText(/Inbox\s*5$/);

  // A pull lands the copy again before the import has archived it. That
  // sync has read the vault, the copy still in the Inbox, when its write is held.
  const putsBefore = host.callsTo('index_put');
  const letIndexWrite = host.holdIndexAfter(0);
  await vault.write(CAPTURED, captured);
  await vault.write(COPY, `${VALID}\n`);
  await emitVaultChanged(page, [COPY, CAPTURED]);
  await expect.poll(() => host.callsTo('index_put')).toBeGreaterThan(putsBefore);

  // The import archives the copy and takes it out of the index at once; only
  // then does the held sync write what it read, the copy among it.
  const removesBefore = host.callsTo('index_remove');
  letImportRead();
  await expectFile(vault, `Archive/${COPY}`).toContain('atlas_duplicate_of:');
  await expect.poll(() => host.callsTo('index_remove')).toBeGreaterThan(removesBefore);
  letIndexWrite();

  // The refresh the archive asked for finds the copy gone and takes it out.
  await expect(inboxRow(page)).toHaveText(/Inbox\s*4$/);
  await inboxRow(page).click();
  await expect(
    page.getByRole('main').getByText('Platform weekly sync', { exact: true }),
  ).toHaveCount(1);
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

test('catch-up waits for the pull: a meeting heard after the Mac slept is let in once a pull started since has completed', async ({
  page,
}) => {
  const { vault, host } = await openWithHost(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Set up sync with GitHub' }).click();
  const status = page.getByTestId('sync-status');
  await expect(status).toContainText('Synced at');

  // Awake since its last look at GitHub, the Mac lets a meeting in.
  await arrive(page, vault, FIRST, VALID);
  await expectFile(vault, FIRST).toBe(STAMPED);
  const indexed = page.getByRole('dialog', { name: 'Settings' }).getByText(/notes indexed/);
  const before = await indexed.textContent();

  // It sleeps, and wakes to a GitHub it cannot reach yet.
  const reachGitHub = host.git.hold('fetch');
  host.sleepClock.sleep(20 * 60_000);
  await arrive(page, vault, BROKEN, BROKEN_TEXT);
  await expect(indexed).not.toHaveText(before ?? '');
  await page
    .getByRole('region', { name: 'Sync' })
    .getByRole('button', { name: 'Sync now' })
    .click();
  await expect(status).toHaveText('Syncing…');
  // Heard, but not acted on: the last pull started before the sleep.
  expect(await vault.read(BROKEN)).toBe(BROKEN_TEXT);

  reachGitHub();
  await expect(status).toContainText('Synced at');
  await expectFile(vault, BROKEN).toContain('atlas_import_error:');
});
