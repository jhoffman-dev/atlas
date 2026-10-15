import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createVault, emitVaultChanged, expectFile, installHost, type FakeVault } from './host.ts';

/**
 * #183-#186 (ADR-0036): a meeting arrives, and the "After a meeting" rule —
 * as a vault saved before the digest has it, `output: meeting-items`,
 * `apply: mine` — asks the e2e host's scripted Claude once, and writes a
 * marked summary at the top of the meeting, above the provider's Summary,
 * in the same write as the task it made for the owner. The provider's
 * sections and the transcript are as they arrived, byte for byte; the
 * meeting shows the summary as Claude's. Every claim about a file reads the
 * disk.
 */

const shipped = (path: string) =>
  readFileSync(new URL(`../vault/${path}`, import.meta.url), 'utf8');
const FIXTURE = readFileSync(
  new URL(
    '../packages/domain/src/meetings/fixtures/valid/gemini-platform-sync.md',
    import.meta.url,
  ),
  'utf8',
);

const MEETING = 'Inbox/Meetings/2026-09-29 Platform weekly sync.md';
const RULE = '.atlas/automations/After a meeting.md';
const LOG = '.atlas/automations/log/After a meeting.md';
const PROMPT = '.atlas/prompts/after-a-meeting.md';

const RULE_FILE = [
  '---',
  'atlas: automation',
  'name: After a meeting',
  'id: After a meeting',
  'enabled: true',
  'when: a meeting is created',
  'which: FROM meeting',
  'do: claude',
  `prompt: ${PROMPT}`,
  'output: meeting-items',
  'apply: mine',
  '---',
  '',
].join('\n');

const ANSWER = JSON.stringify({
  summary: 'Mara Quill and Tobias Fenn agreed to ship the new cache behind a flag before Friday.',
  key_points: ['The new cache is ready', 'Tobias wants a flag on it first'],
  open_questions: ['Who tells the support team?'],
  items: [
    {
      kind: 'task',
      title: 'Write the rollout note',
      owner: 'Mara Quill',
      source_block: 't0003',
      confidence: 'high',
    },
    {
      kind: 'task',
      title: 'Flag the new cache',
      owner: 'Tobias Fenn',
      source_block: 't0002',
      confidence: 'high',
    },
    {
      kind: 'decision',
      title: 'Ship the cache behind a flag',
      source_block: 't0003',
      confidence: 'high',
    },
  ],
});

async function openVault(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const vault = await createVault();
  for (const folder of [
    '.atlas/types',
    '.atlas/automations',
    '.atlas/prompts',
    'Inbox/Meetings',
    'People',
  ]) {
    await vault.mkdir(folder);
  }
  for (const type of ['task', 'meeting', 'person', 'company', 'project', 'proposal', 'decision']) {
    await vault.write(`.atlas/types/${type}.md`, shipped(`.atlas/types/${type}.md`));
  }
  // Mara owns this vault: what she took on becomes her task.
  await vault.write('.atlas/settings.md', '---\nprofileName: Mara Quill\n---\n');
  await vault.write(RULE, RULE_FILE);
  await vault.write(
    PROMPT,
    'List what somebody now has to do, what was decided, and what to chase.\n',
  );
  await vault.write(
    'People/Mara Quill.md',
    '---\ntype: person\nemail: mara.quill@example.com\n---\n',
  );
  await vault.write(
    'People/Tobias Fenn.md',
    '---\ntype: person\nemail: tobias.fenn@example.com\n---\n',
  );
  const host = await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return { vault, host };
}

async function arrive(page: Page, vault: FakeVault) {
  await vault.write(MEETING, FIXTURE);
  await emitVaultChanged(page, [MEETING]);
}

test('a meeting arrives and its summary is written at the top, marked, in one write with the owner’s task; the rest is as it arrived', async ({
  page,
}) => {
  const { vault, host } = await openVault(page);
  const asks = () => host.claude.runs().filter((run) => run.args[0] === '-p');
  host.claude.reply(ANSWER);

  await arrive(page, vault);

  await expectFile(vault, MEETING).toContain('<!-- atlas:summary v1 -->');
  const text = await vault.read(MEETING);
  // At the top, above the provider's Summary, marked as Claude's.
  expect(text.indexOf('<!-- atlas:summary v1 -->')).toBeLessThan(text.indexOf('## Summary'));
  expect(text).toMatch(
    /\n> \[!summary\] Summary by Claude \(claude-sonnet-5-5, \d{4}-\d{2}-\d{2}\)\n/,
  );
  expect(text).toContain('> - Write the rollout note: you (a task was made)');
  // Someone else's item the owner did not ask for is left out of the summary (#226).
  expect(text).not.toContain('Flag the new cache');
  expect(text).toContain('> - Who tells the support team?\n\n<!-- /atlas:summary -->\n');
  // Its keys, and the task it made, in the same write.
  expect(text).toMatch(/\natlas_summary_digest: \S+\n/);
  expect(text).toContain('atlas_summary_model: claude-sonnet-5-5');
  expect(text).toMatch(/\ntasks:\n {2}- "\[\[Write the rollout note\]\]"\n/);
  // The provider's sections and the transcript, byte for byte.
  expect(text.slice(text.indexOf('## Summary'))).toBe(FIXTURE.slice(FIXTURE.indexOf('## Summary')));
  // Asked once, on Sonnet, and the log says what it wrote.
  expect(asks()).toHaveLength(1);
  expect(asks()[0]!.args).toContain('claude-sonnet-5-5');
  await expectFile(vault, LOG).toContain('Summary written by claude-sonnet-5-5');

  // The meeting shows it as Claude's summary.
  await page.getByRole('button', { name: /^Inbox/ }).click();
  // The meeting's own row: the review proposal's title names the meeting too (#226).
  await page.getByRole('button', { name: 'Platform weekly sync', exact: true }).click();
  const callout = page.locator('.callout[data-callout="summary"]');
  await expect(callout).toBeVisible();
  await expect(callout.locator('.callout__title')).toHaveText(
    /^Summary by Claude \(claude-sonnet-5-5, \d{4}-\d{2}-\d{2}\)$/,
  );
  await expect(callout).toContainText('Write the rollout note: you (a task was made)');
});
