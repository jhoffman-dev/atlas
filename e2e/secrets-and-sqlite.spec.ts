import { expect, test, type Page } from '@playwright/test';
import { createVault, expectFile, installHost, sidebarSection, type FakeHost } from './host.ts';

/**
 * P12-06: secrets a source names but never holds, and a SQLite file read as a
 * source. The host commands are stubbed (`host.ts`); what the Keychain and the
 * read-only open really do is tested in Rust, in `secrets` and `sqlite_source`.
 */

const TOKEN = 'ghp_E2E_SECRET_VALUE_7f3a';
const FEED = 'https://api.example.test/issues.csv';

const ISSUES = [
  '---',
  'atlas: source',
  'favorite: true',
  'format: csv',
  `url: ${FEED}`,
  'auth:',
  '  secret: github',
  'into: Issues',
  'type: issue',
  'key: id',
  'name: title',
  '---',
  '',
].join('\n');

const TEAM = [
  '---',
  'atlas: source',
  'favorite: true',
  'format: sqlite',
  'file: data/team.db',
  'query: SELECT id, name, role FROM people',
  'into: People',
  'type: person',
  'key: id',
  'name: name',
  '---',
  '',
].join('\n');

async function openVault(page: Page, feeds: Record<string, string> = {}) {
  const vault = await createVault();
  await vault.mkdir('.atlas/sources');
  await vault.mkdir('Issues');
  await vault.mkdir('People');
  await vault.write('.atlas/sources/Issues.md', ISSUES);
  await vault.write('.atlas/sources/Team.md', TEAM);

  const host = await installHost(page, vault, feeds);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return { vault, host };
}

const settings = (page: Page) => page.getByRole('dialog', { name: 'Settings' });
const secretsCard = (page: Page) => settings(page).getByRole('region', { name: 'Secrets' });
const panel = (page: Page) => page.getByLabel('Source');

async function openSecrets(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(secretsCard(page)).toBeVisible();
}

async function addSecret(
  page: Page,
  name: string,
  value: string,
  sites = 'api.example.test',
): Promise<void> {
  const card = secretsCard(page);
  await card.getByLabel('Secret name').fill(name);
  await card.getByLabel('Secret value').fill(value);
  await card.getByLabel('Sites it may be sent to').fill(sites);
  await card.getByRole('button', { name: 'Add' }).click();
}

async function openSource(page: Page, name: string): Promise<void> {
  await sidebarSection(page, 'favorites').getByRole('button', { name, exact: true }).click();
  await expect(panel(page)).toBeVisible();
}

function expectNoValueCameBack(host: FakeHost): void {
  // The log only starts once a secret exists, so it must have something in it
  // for its silence about the value to mean anything.
  expect(host.secrets.answers().length).toBeGreaterThan(0);
  expect(host.secrets.answers()).not.toContain(TOKEN);
}

test('Settings lists a secret by name and what uses it, and never its value', async ({ page }) => {
  const { host } = await openVault(page);
  await openSecrets(page);
  // Named by a source before it is set: the card says so, and offers to set it.
  const unset = secretsCard(page).getByRole('listitem').filter({ hasText: 'github' });
  await expect(unset).toContainText('Used by Issues — not set on this Mac');

  await unset.getByRole('button', { name: 'Set…' }).click();
  await secretsCard(page).getByLabel('New value for github').fill(TOKEN);
  await secretsCard(page).getByLabel('Sites github may be sent to').fill('api.example.test');
  await secretsCard(page).getByRole('button', { name: 'Save' }).click();

  const row = secretsCard(page).getByRole('listitem').filter({ hasText: 'github' });
  await expect(row).toContainText('Used by Issues');
  await expect(row).toContainText('Sent only to https://api.example.test');
  await expect(row).not.toContainText('not set');
  expect(host.secrets.names()).toEqual(['github']);
  await expect(page.locator('body')).not.toContainText(TOKEN);
  expect(await page.content()).not.toContain(TOKEN);
  expectNoValueCameBack(host);
});

test('a secret is added, replaced and deleted from Settings', async ({ page }) => {
  const { host } = await openVault(page);
  await openSecrets(page);

  await addSecret(page, 'spare', 'first-value');
  const row = secretsCard(page).getByRole('listitem').filter({ hasText: 'spare' });
  await expect(row).toContainText('Not used by any source');

  await row.getByRole('button', { name: 'Replace…' }).click();
  await secretsCard(page).getByLabel('New value for spare').fill('second-value');
  await secretsCard(page).getByRole('button', { name: 'Save' }).click();
  await expect(secretsCard(page).getByLabel('New value for spare')).toHaveCount(0);

  await row.getByRole('button', { name: 'Delete spare' }).click();
  await secretsCard(page)
    .getByRole('group', { name: 'Delete spare?' })
    .getByRole('button', {
      name: 'Delete',
    })
    .click();
  await expect(row).toHaveCount(0);
  expect(host.secrets.names()).toEqual([]);
});

test('a refresh sends the secret by name, and the value never comes back', async ({ page }) => {
  // A feed that echoes the token back, as a careless or test endpoint would.
  const { vault, host } = await openVault(page, {
    [FEED]: `id,title\n1,Token was ${TOKEN}\n`,
  });
  await openSecrets(page);
  await addSecret(page, 'github', TOKEN);
  await settings(page).getByRole('button', { name: 'Close', exact: true }).click();

  await openSource(page, 'Issues');
  await expect(panel(page).getByText('Sends secrets')).toBeVisible();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByLabel('1 created')).toBeVisible();

  expect(host.secrets.requests()).toEqual([
    {
      url: [{ text: FEED }],
      headers: [{ name: 'Authorization', value: [{ text: 'Bearer ' }, { secret: 'github' }] }],
    },
  ]);
  await expectFile(vault, 'Issues/1.md').toContain('[secret removed]');
  expect(await vault.read('Issues/1.md')).not.toContain(TOKEN);
  expectNoValueCameBack(host);
});

test('a secret goes only to the sites it was given, and Sites… changes them', async ({ page }) => {
  const { host } = await openVault(page, { [FEED]: 'id,title\n1,x\n' });
  await openSecrets(page);
  await addSecret(page, 'github', TOKEN, 'other.example.test');
  await settings(page).getByRole('button', { name: 'Close', exact: true }).click();

  await openSource(page, 'Issues');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toHaveText(
    'the secret "github" is only sent to https://other.example.test, not https://api.example.test',
  );
  await expect(page.getByLabel('0 created')).toBeVisible();

  await openSecrets(page);
  const row = secretsCard(page).getByRole('listitem').filter({ hasText: 'github' });
  await row.getByRole('button', { name: 'Sites…' }).click();
  await secretsCard(page).getByLabel('Sites github may be sent to').fill('api.example.test');
  await secretsCard(page).getByRole('button', { name: 'Save' }).click();
  await expect(row).toContainText('Sent only to https://api.example.test');
  await settings(page).getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByLabel('1 created')).toBeVisible();
  expectNoValueCameBack(host);
});

test('a source whose secret is not set says which one, and writes nothing', async ({ page }) => {
  await openVault(page, { [FEED]: 'id,title\n1,x\n' });
  await openSource(page, 'Issues');

  await page.getByRole('button', { name: 'Refresh', exact: true }).click();

  await expect(panel(page).getByRole('alert')).toHaveText(
    'the secret "github" is not set for this vault',
  );
  await expect(page.getByLabel('0 created')).toBeVisible();
});

test('a SQLite source runs its query and writes a note per row', async ({ page }) => {
  const { vault, host } = await openVault(page);
  host.sqlite.serve('data/team.db', {
    columns: ['id', 'name', 'role'],
    rows: [
      [1, 'Ada', 'engineer'],
      [2, 'Grace', null],
    ],
  });
  await openSource(page, 'Team');
  await expect(panel(page).getByText('SQLITE', { exact: true })).toBeVisible();
  await expect(panel(page).getByText('SELECT id, name, role FROM people')).toBeVisible();

  await page.getByRole('button', { name: 'Refresh', exact: true }).click();

  await expect(page.getByLabel('2 created')).toBeVisible();
  expect(host.sqlite.queries()).toEqual([
    { file: 'data/team.db', sql: 'SELECT id, name, role FROM people' },
  ]);
  await expectFile(vault, 'People/1.md').toContain('title: Ada');
  await expectFile(vault, 'People/2.md').toContain('title: Grace');
});

test('choosing a SQLite file names it inside the vault relatively, outside absolutely', async ({
  page,
}) => {
  const { vault, host } = await openVault(page);
  await openSource(page, 'Team');

  host.sqlite.offer(`${vault.root}/data/other.db`);
  await panel(page).getByRole('button', { name: 'Choose file…' }).click();
  await expectFile(vault, '.atlas/sources/Team.md').toContain('file: data/other.db');
  await expect(panel(page).getByText('outside the vault')).toHaveCount(0);

  host.sqlite.offer('/Users/someone/Library/app.db');
  await panel(page).getByRole('button', { name: 'Choose file…' }).click();
  await expectFile(vault, '.atlas/sources/Team.md').toContain(
    'file: /Users/someone/Library/app.db',
  );
  await expect(panel(page).getByText(/outside the vault/)).toBeVisible();
});

test('cancelling the file dialog leaves the source as it was', async ({ page }) => {
  const { vault, host } = await openVault(page);
  await openSource(page, 'Team');
  host.sqlite.offer(null);

  await panel(page).getByRole('button', { name: 'Choose file…' }).click();

  await expect(panel(page).getByText('data/team.db')).toBeVisible();
  expect(await vault.read('.atlas/sources/Team.md')).toContain('file: data/team.db');
});
