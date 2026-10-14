import { expect, test, type Page } from '@playwright/test';
import { createVault, expectFile, installHost, type FakeHost } from './host.ts';

/**
 * P28-12: Settings → Granola. The host's commands are stubbed (`host.ts`):
 * the key is kept per vault and every GET is answered with what a test
 * served at its path. The Keychain, the pinned origin and the key struck
 * from every answer are Rust's (`granola.rs`). The two meetings are made up.
 */

const KEY = 'grn_fictional0123456789abcdef';

/** A note as `GET /v1/notes/{id}?include=transcript` answers it. */
const note = (id: string, title: string, updatedAt: string) => ({
  id,
  object: 'note',
  title,
  owner: { name: 'Mara Quill', email: 'mara.quill@example.com' },
  created_at: '2026-10-06T16:58:00Z',
  updated_at: updatedAt,
  deleted_at: null,
  web_url: `https://notes.granola.ai/d/${id}`,
  calendar_event: null,
  attendees: [{ name: 'Tobias Fenn', email: 'tobias.fenn@example.com' }],
  folder_membership: [],
  summary_text: 'Larkspur Payroll go-live moves a week.',
  summary_markdown: null,
  private_notes_text: null,
  private_notes_markdown: null,
  transcript: [
    {
      speaker: { source: 'microphone', attribution: 'me' },
      text: 'Morning, Tobias.',
      start_time: '2026-10-06T17:00:00Z',
      end_time: '2026-10-06T17:00:04Z',
    },
    {
      speaker: { source: 'speaker', attribution: 'them' },
      text: 'Morning. Go-live moves a week.',
      start_time: '2026-10-06T17:00:05Z',
      end_time: '2026-10-06T17:00:09Z',
    },
  ],
});

const RENEWAL = note('not_e2eRenewal0001', 'Larkspur Payroll renewal', '2026-10-13T15:00:00Z');
const ONE_ON_ONE = note('not_e2eOneOnOne002', 'Tobias one on one', '2026-10-13T16:00:00Z');

const RENEWAL_FILE = 'Inbox/Meetings/2026-10-06 Larkspur Payroll renewal.md';
const ONE_ON_ONE_FILE = 'Inbox/Meetings/2026-10-06 Tobias one on one.md';

const ok = (body: unknown) => ({ status: 200, body: JSON.stringify(body) });

/** Granola's list of notes, and each note, as it holds them now. */
function serveNotes(host: FakeHost, notes: readonly ReturnType<typeof note>[]) {
  host.granola.serve(
    '/v1/notes',
    ok({
      notes: notes.map(({ id, title, updated_at }) => ({ id, object: 'note', title, updated_at })),
      hasMore: false,
      cursor: null,
    }),
  );
  for (const each of notes) host.granola.serve(`/v1/notes/${each.id}`, ok(each));
}

async function openSettings(page: Page) {
  const vault = await createVault();
  const host = await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  return { vault, host };
}

const card = (page: Page) =>
  page.getByRole('dialog', { name: 'Settings' }).getByRole('region', { name: 'Granola' });

test('a key is set, the meetings Granola holds are pulled in, and Sync now brings a new one', async ({
  page,
}) => {
  const { vault, host } = await openSettings(page);
  await expect(card(page).getByTestId('granola-key')).toHaveText('No key on this Mac');
  await expect(card(page).getByText('Granola → Settings → Connectors → API keys')).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Sync now' })).toBeDisabled();

  const indexed = page.getByText(/^\d+ notes indexed$/).first();
  const before = Number.parseInt((await indexed.textContent()) ?? '', 10);
  serveNotes(host, [RENEWAL]);
  await card(page).getByLabel('Granola API key', { exact: true }).fill(KEY);
  await card(page).getByRole('button', { name: 'Save' }).click();

  await expect(card(page).getByTestId('granola-key')).toHaveText('Key accepted');
  await expect(card(page).getByLabel('Granola API key', { exact: true })).toHaveValue('');
  expect(host.granola.hasKey()).toBe(true);
  // A key set where there was none pulls at once: the vault does not sync, so has nothing to wait for.
  await expectFile(vault, RENEWAL_FILE).toContain(`external_id: '${RENEWAL.id}'`);
  await expect(card(page).getByTestId('granola-pull')).toContainText('1 new, 0 already in Atlas');

  // The meeting written is in the index as soon as the pull has ended, as it would be from Sync.
  await expect(indexed).toHaveText(`${before + 1} notes indexed`);

  serveNotes(host, [RENEWAL, ONE_ON_ONE]);
  await card(page).getByRole('button', { name: 'Sync now' }).click();

  await expectFile(vault, ONE_ON_ONE_FILE).toContain(`external_id: '${ONE_ON_ONE.id}'`);
  await expect(card(page).getByTestId('granola-pull')).toContainText('1 new, 1 already in Atlas');
  // The meeting already in the vault was never fetched again.
  const fetched = host.granola.requests().filter(({ path }) => path === `/v1/notes/${RENEWAL.id}`);
  expect(fetched).toHaveLength(1);
});

test('a key Granola refuses is said on the card, and nothing is pulled with it', async ({
  page,
}) => {
  const { vault, host } = await openSettings(page);
  host.granola.serve('/v1/notes', { status: 401, body: '{"message":"Unauthorized"}' });

  await card(page).getByLabel('Granola API key', { exact: true }).fill(KEY);
  await card(page).getByRole('button', { name: 'Save' }).click();

  await expect(card(page).getByTestId('granola-key')).toHaveText('Granola refused this key');
  await expect(card(page).getByTestId('granola-pull')).toHaveText('Not pulled on this Mac yet');
  // Only the one check of the key went to Granola.
  expect(host.granola.requests().map(({ path }) => path)).toEqual(['/v1/notes']);
  expect(await vault.read(RENEWAL_FILE)).toBe('');
});

test('a Sync now that fails says why as a toast', async ({ page }) => {
  const { host } = await openSettings(page);
  serveNotes(host, []);
  await card(page).getByLabel('Granola API key', { exact: true }).fill(KEY);
  await card(page).getByRole('button', { name: 'Save' }).click();
  await expect(card(page).getByTestId('granola-pull')).toContainText('nothing new');

  host.granola.serve('/v1/notes', { status: 503, body: '{"message":"Unavailable"}' });
  await card(page).getByRole('button', { name: 'Sync now' }).click();

  const toast = page.locator('.toast');
  await expect(toast).toContainText('Granola is having trouble (status 503).');
  await expect(card(page).getByRole('alert')).toContainText('Granola is having trouble');
});
