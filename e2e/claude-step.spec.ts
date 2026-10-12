import { expect, test } from '@playwright/test';
import { createVault, emitVaultChanged, expectFile, installHost } from './host.ts';

/**
 * P29-03: a rule with a Claude step on a note type. A meeting arrives, the
 * rule asks Claude — the e2e host's scripted model, through the same fixed
 * Claude Code argument shape the chat uses — and what it answers waits in the
 * Inbox as proposals, each citing the meeting's block. The meeting itself is
 * never written. Every claim about a file reads the disk.
 */

const MEETING_TYPE = ['---', 'name: meeting', 'properties:', '  kind: text', '---', ''].join('\n');

const RULE = [
  '---',
  'atlas: automation',
  'name: Meeting actions',
  'id: Meeting actions',
  'enabled: true',
  'when: a meeting is created',
  'which: FROM meeting',
  'do: claude',
  'prompt: .atlas/prompts/meeting-actions.md',
  'tools: [atlas_read_note]',
  'output: proposals',
  '---',
  '',
].join('\n');

const PROMPT = 'Find every action item in the meeting and propose it as a task.\n';

const STANDUP = [
  '---',
  'type: meeting',
  'kind: standup',
  '---',
  '',
  '**Mara Quill** Can you send me the payroll file by Friday? ^t0003',
  '',
].join('\n');

const ANSWER = JSON.stringify({
  proposals: [
    {
      kind: 'task',
      title: 'Send Mara the payroll file',
      source: '[[2026-10-01 Standup#^t0003]]',
      confidence: 'high',
      why: 'Mara asked for it on the call.',
    },
  ],
});

test('a rule with a Claude step on a meeting proposes its action items in the Inbox', async ({
  page,
}) => {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/automations');
  await vault.mkdir('.atlas/prompts');
  // Kept out of Inbox/Meetings, where the meeting import (P28-04) stamps every file that lands.
  await vault.mkdir('Meetings');
  await vault.write('.atlas/types/meeting.md', MEETING_TYPE);
  await vault.write('.atlas/automations/Meeting actions.md', RULE);
  await vault.write('.atlas/prompts/meeting-actions.md', PROMPT);
  const host = await installHost(page, vault);
  host.claude.reply(ANSWER);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();

  await vault.write('Meetings/2026-10-01 Standup.md', STANDUP);
  await emitVaultChanged(page, ['Meetings/2026-10-01 Standup.md']);

  const proposal = 'Inbox/Proposals/Send Mara the payroll file.md';
  await expectFile(vault, proposal).toContain('type: proposal');
  const written = await vault.read(proposal);
  expect(written).toContain('state: open');
  expect(written).toContain('source: "[[2026-10-01 Standup#^t0003]]"');
  expect(written).toContain('made_by: Meeting actions');
  expect(written).toContain('Mara asked for it on the call.');
  // The meeting is read, never written.
  expect(await vault.read('Meetings/2026-10-01 Standup.md')).toBe(STANDUP);

  // Claude was asked once, in the host's fixed shape, with the rule's prompt and the meeting.
  const turns = host.claude.runs().filter((run) => run.args[0] === '-p');
  expect(turns).toHaveLength(1);
  expect(turns[0]!.args).toContain('--tools');
  const told = turns[0]!.args.join('\n');
  expect(told).toContain('Find every action item in the meeting');
  // The meeting rides in the system prompt, fenced as data; the question carries none of it.
  expect(told).toContain('<vault_data note="Meetings/2026-10-01 Standup.md">');
  expect(told).toContain('^t0003');
  expect(turns[0]!.stdin).not.toContain('vault_data');

  const log = '.atlas/automations/log/Meeting actions.md';
  await expectFile(vault, log).toContain(`- proposed \`"${proposal}"\``);
  await expectFile(vault, log).toContain('- claude `"');

  // The proposal waits in the Inbox, citing the block it came from.
  await page.getByRole('button', { name: /^Inbox/ }).click();
  const card = page.getByRole('region', { name: 'Task: Send Mara the payroll file' });
  await expect(card).toBeVisible();
  await expect(card.getByText('high confidence')).toBeVisible();
  await expect(card.getByRole('button', { name: /2026-10-01 Standup#\^t0003/ })).toBeVisible();

  // Listed with what it does, and its last run's summary.
  await page.getByRole('button', { name: 'Automations', exact: true }).click();
  const list = page.getByRole('list', { name: 'All automations' });
  await expect(
    list.getByText('Ask Claude (meeting-actions) for proposals · When a meeting is created'),
  ).toBeVisible();
  await expect(list.getByText(/Made 1 proposal\./)).toBeVisible();
});
