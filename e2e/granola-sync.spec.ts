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

async function openSettings(
  page: Page,
  { watermark, settings }: { watermark?: string; settings?: string } = {},
) {
  const vault = await createVault();
  if (settings !== undefined) {
    await vault.mkdir('.atlas');
    await vault.write('.atlas/settings.md', settings);
  }
  const host = await installHost(page, vault);
  if (watermark !== undefined) {
    // This Mac's record of where its pulls of the vault left off.
    await page.addInitScript(({ key, record }) => window.localStorage.setItem(key, record), {
      key: `atlas.granola-pull:${vault.root}`,
      record: JSON.stringify({ watermark, lastPullAt: null }),
    });
  }
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
  await card(page).getByRole('button', { name: 'Save', exact: true }).click();

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

/**
 * Each request to Granola, as which of them it was: the key's check asks for
 * one note; a pull on open or on the timer lists from the watermark; Sync now
 * lists everything.
 */
const requestKinds = (host: FakeHost) =>
  host.granola.requests().map(({ path, query }) => {
    if (path !== '/v1/notes') return path;
    if (query.page_size === '1') return 'key check';
    return 'updated_after' in query ? 'pull from the watermark' : 'Sync now';
  });

test('a key Granola refuses is said on the card, and nothing is pulled with it', async ({
  page,
}) => {
  // A watermark, so a pull that starts by itself is told apart from Sync now by what it asks.
  const { vault, host } = await openSettings(page, { watermark: '2026-10-01T00:00:00.000Z' });
  host.granola.serve('/v1/notes', { status: 401, body: '{"message":"Unauthorized"}' });

  await card(page).getByLabel('Granola API key', { exact: true }).fill(KEY);
  await card(page).getByRole('button', { name: 'Save', exact: true }).click();

  await expect(card(page).getByTestId('granola-key')).toHaveText('Granola refused this key');
  await expect(card(page).getByTestId('granola-pull')).toHaveText('Not pulled on this Mac yet');

  // Sync now asks Granola whatever its last answer was, and runs after any pull already under
  // way: once its listing has gone, a pull the refused key started by itself would have too.
  await card(page).getByRole('button', { name: 'Sync now' }).click();
  await expect.poll(() => requestKinds(host)).toContain('Sync now');
  await expect(page.locator('.toast')).toContainText('Granola refused the API key');
  expect(requestKinds(host)).toEqual(['key check', 'Sync now']);
  expect(await vault.read(RENEWAL_FILE)).toBe('');
});

test('a Sync now that fails says why as a toast', async ({ page }) => {
  const { host } = await openSettings(page);
  serveNotes(host, []);
  await card(page).getByLabel('Granola API key', { exact: true }).fill(KEY);
  await card(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card(page).getByTestId('granola-pull')).toContainText('nothing new');

  host.granola.serve('/v1/notes', { status: 503, body: '{"message":"Unavailable"}' });
  await card(page).getByRole('button', { name: 'Sync now' }).click();

  const toast = page.locator('.toast');
  await expect(toast).toContainText('Granola is having trouble (status 503).');
  await expect(card(page).getByRole('alert')).toContainText('Granola is having trouble');
});

test('your emails in Granola are kept in the vault’s settings once saved', async ({ page }) => {
  const { vault } = await openSettings(page);
  const field = card(page).getByLabel('Your emails', { exact: true });
  await expect(field).toHaveValue('');

  // Something that is not an address is named, and nothing is kept; what was typed stays.
  await field.fill('mara.quill@example.com, Mara');
  await card(page).getByRole('button', { name: 'Save emails' }).click();
  await expect(card(page).getByRole('alert', { name: 'Your emails were not saved' })).toHaveText(
    'Not an email address: “Mara”. Nothing was saved.',
  );
  await expect(field).toHaveValue('mara.quill@example.com, Mara');
  // Nothing was kept: what is typed still differs from what the settings hold.
  await expect(card(page).getByRole('button', { name: 'Save emails' })).toBeEnabled();

  await field.fill('Mara Quill <Mara.Quill@example.com>, mq@example.com');
  await card(page).getByRole('button', { name: 'Save emails' }).click();

  await expectFile(vault, '.atlas/settings.md').toContain(
    'granola_self_emails:\n  - mara.quill@example.com\n  - mq@example.com\n',
  );
  await expect(field).toHaveValue('mara.quill@example.com, mq@example.com');
  await expect(card(page).getByRole('button', { name: 'Save emails' })).toBeDisabled();
  await expect(card(page).getByRole('alert', { name: 'Your emails were not saved' })).toHaveCount(
    0,
  );
});

test('addresses in the settings that are not all addresses are said unreadable, never shown as kept', async ({
  page,
}) => {
  const { vault } = await openSettings(page, {
    settings: '---\ngranola_self_emails: mara.quill@example.com, Mara\n---\n',
  });
  const unreadable = card(page).getByRole('alert', {
    name: 'Your emails in settings could not be read',
  });
  await expect(unreadable).toHaveText(
    'Your emails in settings could not be read: Not an email address: “Mara”.',
  );
  const field = card(page).getByLabel('Your emails', { exact: true });
  await expect(field).toHaveValue('');

  // One on each line, in the field of several lines.
  await field.fill('mara.quill@example.com\nMara Quill <MQ@example.com>');
  await card(page).getByRole('button', { name: 'Save emails' }).click();
  await expectFile(vault, '.atlas/settings.md').toContain(
    'granola_self_emails:\n  - mara.quill@example.com\n  - mq@example.com\n',
  );
  await expect(field).toHaveValue('mara.quill@example.com, mq@example.com');
  await expect(unreadable).toHaveCount(0);
});
