import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createVault, emitVaultChanged, expectFile, installHost, type FakeVault } from './host.ts';

/**
 * #227: a meeting gets its project from its series — earlier meetings of its
 * title with its people. One arriving in a known series is filed on arrival;
 * one already in the vault is filed from the Inbox's offer, previewed first,
 * and the offer takes it back. Every claim about a file reads the disk.
 */

const shipped = (path: string) =>
  readFileSync(new URL(`../vault/${path}`, import.meta.url), 'utf8');

const standup = ({
  date,
  project,
  outcome = true,
  linked = outcome,
}: {
  date: string;
  project?: string;
  /** Stamped by the import: let in already, and so settled. */
  outcome?: boolean;
  /** Linked to its people, as the import's linking leaves a meeting it let in. */
  linked?: boolean;
}) =>
  [
    '---',
    'type: meeting',
    'atlas_import: meeting/v1',
    "title: 'Larkspur standup'",
    `date: '${date}'`,
    "start: '09:30'",
    'provider: gemini',
    `external_id: 'gemini-${date}'`,
    'attendees:',
    '  - name: Mara Quill',
    '    email: mara@larkspur.example',
    '  - name: Tobias Fenn',
    '    email: tobias@larkspur.example',
    ...(linked ? ['people:', '  - "[[Tobias Fenn]]"'] : []),
    ...(project === undefined ? [] : [`project: "[[${project}]]"`]),
    ...(outcome ? ['atlas_import_outcome: imported'] : []),
    '---',
    '',
    '## Summary',
    '',
    'The Larkspur Payroll go-live.',
    '',
  ].join('\n');

const SERIES = ['2026-10-01', '2026-10-02', '2026-10-05'].map(
  (date) => [`Meetings/${date} Larkspur standup.md`, standup({ date, project: 'Ledger' })] as const,
);

async function openVault(page: Page, more: Record<string, string> = {}): Promise<FakeVault> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const vault = await createVault();
  for (const folder of ['.atlas/types', 'Inbox/Meetings', 'Meetings', 'People', 'Projects']) {
    await vault.mkdir(folder);
  }
  for (const type of ['task', 'meeting', 'person', 'project', 'proposal']) {
    await vault.write(`.atlas/types/${type}.md`, shipped(`.atlas/types/${type}.md`));
  }
  await vault.write(
    'People/Tobias Fenn.md',
    '---\ntype: person\nemail: tobias@larkspur.example\n---\n\n# Tobias Fenn\n',
  );
  await vault.write('Projects/Ledger.md', '---\ntype: project\nstatus: active\n---\n\n# Ledger\n');
  for (const [path, text] of [...SERIES, ...Object.entries(more)]) await vault.write(path, text);
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

test('a meeting arriving in a known series arrives filed under its project', async ({ page }) => {
  const vault = await openVault(page);
  const arriving = 'Inbox/Meetings/2026-10-06 Larkspur standup.md';
  await vault.write(arriving, standup({ date: '2026-10-06', outcome: false }));
  await emitVaultChanged(page, [arriving]);

  await expectFile(vault, arriving).toContain('atlas_import_outcome: imported');
  expect(await vault.read(arriving)).toMatch(/\nproject: "\[\[Ledger\]\]"\n/);
});

test('the Inbox files the meetings with no project as their series is, and takes it back', async ({
  page,
}) => {
  const unfiled = 'Meetings/2026-10-06 Larkspur standup.md';
  const vault = await openVault(page, { [unfiled]: standup({ date: '2026-10-06' }) });
  const before = await vault.read(unfiled);

  await page.getByRole('button', { name: /^Inbox/ }).click();
  const offer = page.getByRole('region', { name: 'File meetings under projects' });
  await expect(offer).toContainText('1 meeting has no project. 1 can be filed');
  await offer.getByRole('button', { name: 'Preview' }).click();
  await expect(
    offer.getByRole('checkbox', { name: /2026-10-06 Larkspur standup → Ledger/ }),
  ).toBeChecked();
  await expect(offer).toContainText('3 of its last 3 were filed under Ledger');
  await offer.getByRole('button', { name: 'File 1 meeting' }).click();

  await expectFile(vault, unfiled).toMatch(/\nproject: "?\[\[Ledger\]\]"?\n/);
  await expect(offer.getByRole('status')).toHaveText('Filed 1 meeting under its project.');

  await offer.getByRole('button', { name: 'Undo filing' }).click();
  await expectFile(vault, unfiled).toBe(before);
});
