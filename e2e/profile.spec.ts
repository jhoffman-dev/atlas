import { expect, test, type Page } from '@playwright/test';
import { createVault, expectFile, installHost, type FakeHost } from './host.ts';

/**
 * #10 / #1: Settings → Profile holds the person's name, in the vault's
 * settings note, and Claude is told it — or told to write "[Your name]"
 * rather than guess one. The model is the e2e host's stub Claude Code, so
 * what is proved is the system prompt Atlas hands it.
 */

async function openVault(page: Page, settings?: string) {
  const vault = await createVault();
  await vault.write('Plan.md', '# Plan\n');
  await vault.mkdir('.atlas');
  if (settings !== undefined) await vault.write('.atlas/settings.md', settings);
  const host = await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return { vault, host };
}

const chat = (page: Page) => page.getByRole('complementary', { name: 'Claude' });

/** Asks, and waits for the whole turn: the stub's last line, not just its first words, has landed. */
async function ask(page: Page, question: string, answer: string) {
  const box = chat(page).getByRole('textbox', { name: 'Ask Claude' });
  await box.fill(question);
  await box.press('Enter');
  await expect(chat(page).getByText(answer)).toBeVisible();
  await expect(chat(page).getByText('Claude is working…')).toHaveCount(0);
}

/** The system prompt of the last turn the stub Claude Code was run for. */
function lastSystemPrompt(host: FakeHost): string {
  const turns = host.claude.runs().filter((run) => run.args[0] === '-p');
  const args = turns.at(-1)?.args ?? [];
  return args[args.indexOf('--system-prompt') + 1] ?? '';
}

test('a name set in Settings → Profile is kept in the vault and reaches Claude', async ({
  page,
}) => {
  const { vault, host } = await openVault(page, '---\nquickAdd: [task]\n---\n');

  // With no name, the chat says so, and its button opens Settings.
  await page.getByRole('button', { name: 'Claude' }).first().click();
  await expect(chat(page).getByText(/it writes “\[Your name\]” rather than guess/)).toBeVisible();
  await chat(page).getByRole('button', { name: 'Set your name' }).click();

  const profile = page.getByRole('region', { name: 'Profile' });
  await expect(
    profile.getByText('Not set: Claude writes “[Your name]” rather than guess one'),
  ).toBeVisible();
  const name = profile.getByRole('textbox', { name: 'Full name' });
  await name.fill('Ada Lovelace');
  await name.press('Enter');
  await expectFile(vault, '.atlas/settings.md').toBe(
    '---\nquickAdd: [task]\nprofileName: Ada Lovelace\n---\n',
  );
  await expect(profile.getByText('What Claude writes for you')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);

  await expect(chat(page).getByRole('button', { name: 'Set your name' })).toHaveCount(0);
  host.claude.reply('Hello, Ada.');
  await ask(page, 'Make me a meeting note', 'Hello, Ada.');

  const system = lastSystemPrompt(host);
  expect(system).toContain('\nFull name: Ada Lovelace\n');
  expect(system).not.toContain('has not told Atlas their name');
});

test('with no name set, Claude is told to write "[Your name]" and never guess', async ({
  page,
}) => {
  const { host } = await openVault(page);
  await page.getByRole('button', { name: 'Claude' }).first().click();
  host.claude.reply('Done.');
  await ask(page, 'Make me a meeting note', 'Done.');

  const system = lastSystemPrompt(host);
  expect(system).toContain('The person has not told Atlas their name.');
  expect(system).toContain('[Your name] exactly, or ask them for it.');
  expect(system).not.toContain('Full name:');
});

test('a name already in the vault’s settings reaches Claude without visiting Settings', async ({
  page,
}) => {
  const { host } = await openVault(
    page,
    '---\nprofileName: James Hoffman\nprofilePreferredName: James\n---\n',
  );
  await page.getByRole('button', { name: 'Claude' }).first().click();
  await expect(chat(page).getByText(/Ask about what is open/)).toBeVisible();
  await expect(chat(page).getByRole('button', { name: 'Set your name' })).toHaveCount(0);
  host.claude.reply('Hi, James.');
  await ask(page, 'Who am I?', 'Hi, James.');

  expect(lastSystemPrompt(host)).toContain('\nFull name: James Hoffman\nGoes by: James\n');
});

test('with only a preferred name, the chat still offers to set the full name', async ({ page }) => {
  await openVault(page, '---\nprofilePreferredName: Ada\n---\n');
  await page.getByRole('button', { name: 'Claude' }).first().click();
  await expect(chat(page).getByRole('button', { name: 'Set your name' })).toBeVisible();
});

test('changing the preferred name leaves a full name Atlas cannot show as it was', async ({
  page,
}) => {
  const { vault } = await openVault(page, '---\nprofileName:\n  - Ada\n  - Lovelace\n---\n');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const profile = page.getByRole('region', { name: 'Profile' });
  const preferred = profile.getByRole('textbox', { name: 'Preferred name' });
  await expect(preferred).toBeEnabled();
  await preferred.fill('Ada');
  await preferred.press('Enter');
  await expectFile(vault, '.atlas/settings.md').toBe(
    '---\nprofileName:\n  - Ada\n  - Lovelace\nprofilePreferredName: Ada\n---\n',
  );
});
