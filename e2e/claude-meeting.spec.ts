import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createVault, emitVaultChanged, expectFile, installHost, type FakeVault } from './host.ts';

/**
 * P29-03 on the meeting import (#92, P28-06, P29-04): a meeting arrives where
 * meeting files land, and a rule with a Claude step on "a meeting is created"
 * asks once — the e2e host's scripted model — about the meeting as the import
 * left it: linked, corrected and stamped. Its two proposals wait in the
 * Inbox, each citing a turn of the transcript. The same meeting delivered
 * again is the import's duplicate, and asks nothing. Every claim about a file
 * reads the disk.
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
/** The fixture as a provider might mishear it: a product in the first turn. */
const MISHEARD = VALID.replace('start with the cache?', 'start with Lark Spur Pay?');

const MEETING = 'Inbox/Meetings/2026-09-29 Platform weekly sync.md';
const COPY = 'Inbox/Meetings/2026-09-29 Platform weekly sync (again).md';
const LOG = '.atlas/automations/log/Meeting actions.md';

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
  'output: proposals',
  '---',
  '',
].join('\n');

const proposed = (title: string, turn: string) => ({
  kind: 'task',
  title,
  source: `[[2026-09-29 Platform weekly sync#^${turn}]]`,
  confidence: 'high',
  why: 'Said on the call.',
});
const ANSWER = JSON.stringify({
  proposals: [proposed('Flag the new cache', 't0002'), proposed('Write the rollout note', 't0003')],
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
    'Terms',
  ]) {
    await vault.mkdir(folder);
  }
  for (const type of ['task', 'meeting', 'person', 'company', 'project', 'proposal', 'term']) {
    await vault.write(`.atlas/types/${type}.md`, shipped(`.atlas/types/${type}.md`));
  }
  await vault.write('.atlas/automations/Meeting actions.md', RULE);
  await vault.write(
    '.atlas/prompts/meeting-actions.md',
    'Find every action item in the meeting and propose it as a task.\n',
  );
  await vault.write(
    'People/Mara Quill.md',
    '---\ntype: person\nemail: mara.quill@example.com\n---\n',
  );
  await vault.write(
    'People/Tobias Fenn.md',
    '---\ntype: person\nemail: tobias.fenn@example.com\n---\n',
  );
  await vault.write(
    'Terms/Larkspur Pay.md',
    '---\ntype: term\nkind: product\nvariants:\n  - Lark Spur Pay\n---\n',
  );
  const host = await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return { vault, host };
}

/** A meeting file landing as a pull lands it: written, then the watcher says so. */
async function arrive(page: Page, vault: FakeVault, path: string) {
  await vault.write(path, MISHEARD);
  await emitVaultChanged(page, [path]);
}

test('a meeting arrives, a Claude rule asks once about the linked and corrected meeting, and its two proposals cite their turns; the same meeting again asks nothing', async ({
  page,
}) => {
  const { vault, host } = await openVault(page);
  const asks = () => host.claude.runs().filter((run) => run.args[0] === '-p');
  host.claude.reply(ANSWER);

  await arrive(page, vault, MEETING);

  const flag = 'Inbox/Proposals/Flag the new cache.md';
  const note = 'Inbox/Proposals/Write the rollout note.md';
  await expectFile(vault, flag).toContain('source: "[[2026-09-29 Platform weekly sync#^t0002]]"');
  await expectFile(vault, note).toContain('source: "[[2026-09-29 Platform weekly sync#^t0003]]"');
  await expectFile(vault, LOG).toContain(`- proposed \`"${note}"\``);
  expect(await vault.read(flag)).toContain('made_by: Meeting actions');

  // Asked once, about the meeting as the import left it — never the file as it landed.
  expect(asks()).toHaveLength(1);
  const told = asks()[0]!.args.join('\n');
  expect(told).toContain(`<vault_data note="${MEETING}">`);
  expect(told).toContain('atlas_import_outcome: imported');
  expect(told).toContain('Shall we start with Larkspur Pay? ^t0001');
  expect(told).not.toContain('Lark Spur Pay?');
  expect(told).toMatch(/\npeople:\n {2}- "\[\[Mara Quill\]\]"\n {2}- "\[\[Tobias Fenn\]\]"\n/);
  // The step read the meeting and wrote nothing to it: it is as the import stamped it.
  const stamped = await vault.read(MEETING);
  expect(told).toContain(stamped.trimEnd());

  // Both wait in the Inbox, each citing its turn.
  await page.getByRole('button', { name: /^Inbox/ }).click();
  const first = page.getByRole('region', { name: 'Task: Flag the new cache' });
  const second = page.getByRole('region', { name: 'Task: Write the rollout note' });
  await expect(first).toBeVisible();
  await expect(
    first.getByRole('button', { name: /2026-09-29 Platform weekly sync#\^t0002/ }),
  ).toBeVisible();
  await expect(
    second.getByRole('button', { name: /2026-09-29 Platform weekly sync#\^t0003/ }),
  ).toBeVisible();

  // The same meeting, delivered again: the import archives it as a copy, and no rule hears it.
  await arrive(page, vault, COPY);
  await expectFile(vault, `Archive/${COPY}`).toContain('atlas_duplicate_of:');
  // The rule's own proposals and the copy have all been heard by now: say something that is
  // heard after them, and wait for it, so "asked nothing" is not read before it could be false.
  await vault.write('Inbox/Call Ines.md', '---\ntype: task\n---\n');
  await emitVaultChanged(page, ['Inbox/Call Ines.md']);
  await expect(page.getByRole('main').getByText('Call Ines', { exact: true })).toBeVisible();

  expect(asks()).toHaveLength(1);
  expect(await vault.read(LOG)).not.toContain('could not');
  expect((await vault.read(LOG)).match(/^## \d{4}-/gm)).toHaveLength(1);
  expect(await vault.read(MEETING)).toBe(stamped);
});
