import { expect, test, type Page } from '@playwright/test';
import { createVault, expectFile, installHost } from './host.ts';

/**
 * P31-03: Settings → Google Calendar. The host's commands are stubbed
 * (`host.ts`); the sign-in itself — loopback, PKCE, the token endpoint, the
 * Keychain — is tested in Rust against a fake Google (`google/tests.rs`).
 */

const CLIENT_ID = '123456789012-abcdef0123456789abcdef0123456789.apps.googleusercontent.com';

async function openVault(page: Page) {
  const vault = await createVault();
  const host = await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  return { vault, host };
}

const card = (page: Page) =>
  page.getByRole('dialog', { name: 'Settings' }).getByRole('region', { name: 'Google Calendar' });

test('Google Calendar is connected, given its calendar, and disconnected from Settings', async ({
  page,
}) => {
  const { vault, host } = await openVault(page);

  await card(page).getByRole('textbox', { name: 'OAuth client ID' }).fill(CLIENT_ID);
  await card(page).getByRole('button', { name: 'Connect' }).click();
  await expect(card(page).getByText('Connected. Choose the calendar blocks go to.')).toBeVisible();
  expect(host.google.connected()).toBe(true);
  await expectFile(vault, '.atlas/settings.md').toContain(`google_client_id: ${CLIENT_ID}`);

  await card(page).getByRole('button', { name: 'Create “Atlas blocks”' }).click();
  await expect(card(page).getByText('Connected. Blocks go to Atlas blocks.')).toBeVisible();
  expect(host.google.calendars()).toEqual(['Atlas blocks']);
  await expectFile(vault, '.atlas/settings.md').toContain(
    'google_calendar: atlas-blocks@group.calendar.example.com',
  );
  await expect(card(page).getByRole('button', { name: /Create/ })).toHaveCount(0);

  await card(page).getByRole('button', { name: 'Disconnect…' }).click();
  await card(page).getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(card(page).getByRole('form', { name: 'Connect Google Calendar' })).toBeVisible();
  expect(host.google.connected()).toBe(false);
});

test('a refused consent says what to do about it', async ({ page }) => {
  const { host } = await openVault(page);
  host.google.refuseNext({
    kind: 'refused',
    code: 'access_denied',
    message: 'Google did not let Atlas in',
  });

  await card(page).getByRole('textbox', { name: 'OAuth client ID' }).fill(CLIENT_ID);
  await card(page).getByRole('button', { name: 'Connect' }).click();

  const alert = card(page).getByRole('alert');
  await expect(alert).toContainText('access was not allowed');
  await expect(alert).toContainText('choose Allow');
  await expect(card(page).getByRole('button', { name: 'Connect' })).toBeVisible();
  expect(host.google.connected()).toBe(false);
});
