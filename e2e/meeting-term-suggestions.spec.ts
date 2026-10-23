import { readFileSync } from 'node:fs';
import { expect, test, type Page } from './fixtures.ts';
import { createVault, emitVaultChanged, expectFile, installHost, type FakeVault } from './host.ts';

/**
 * #19: the meeting assistant suggests glossary terms. A meeting arrives with a
 * name misheard; the "After a meeting" rule asks the e2e host's scripted
 * Claude, which suggests the term — and one made of everyday words, which
 * DFAI leaves out and logs. The term waits in the Inbox as its own card;
 * accepting it makes the term, and the next meeting that mishears the name
 * arrives with it put right. Every claim about a file reads the disk.
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

const FIRST = 'Inbox/Meetings/2026-09-29 Platform weekly sync.md';
const FIRST_TEXT = FIXTURE.replace('start with the cache?', 'start with the Bren Wick cache?');
const SECOND = 'Inbox/Meetings/2026-10-06 Platform weekly sync.md';
const SECOND_TEXT = FIXTURE.replace("'gemini-7f3a9c21'", "'gemini-8e4b0d32'")
  .replace("date: '2026-09-29'", "date: '2026-10-06'")
  .replace('Friday works.', 'Friday works for Bren Wick.');
const RULE = '.atlas/automations/After a meeting.md';
const LOG = '.atlas/automations/log/After a meeting.md';
const PROMPT = '.atlas/prompts/after-a-meeting.md';
const PROPOSAL = 'Inbox/Proposals/Brenwick.md';

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
  'output: meeting-digest',
  'apply: mine',
  '---',
  '',
].join('\n');

const term = (title: string, heard: string) => ({
  kind: 'term',
  title,
  heard,
  owner: '',
  source_block: 't0001',
  confidence: 'medium',
});
const answer = (...items: unknown[]) =>
  JSON.stringify({
    summary: 'Mara Quill and Tobias Fenn agreed to ship the cache behind a flag.',
    key_points: [],
    open_questions: [],
    items,
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
  for (const type of [
    'task',
    'meeting',
    'person',
    'company',
    'project',
    'proposal',
    'decision',
    'term',
  ]) {
    await vault.write(`.atlas/types/${type}.md`, shipped(`.atlas/types/${type}.md`));
  }
  await vault.write('.atlas/settings.md', '---\nprofileName: Mara Quill\n---\n');
  await vault.write(RULE, RULE_FILE);
  await vault.write(PROMPT, 'List what the owner now has to do, and any misheard names.\n');
  await vault.write(
    'People/Mara Quill.md',
    '---\ntype: person\nemail: mara.quill@example.com\n---\n',
  );
  const host = await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return { vault, host };
}

async function arrive(page: Page, vault: FakeVault, path: string, text: string) {
  await vault.write(path, text);
  await emitVaultChanged(page, [path]);
}

test('a meeting suggests a term, accepting it adds the term, and the next meeting arrives corrected', async ({
  page,
}) => {
  const { vault, host } = await openVault(page);
  host.claude.reply(answer(term('Brenwick', 'Bren Wick'), term('Shallwe', 'Shall we')), answer());

  await arrive(page, vault, FIRST, FIRST_TEXT);

  // A term proposal, citing its turn, misheard as the transcript has it.
  await expectFile(vault, PROPOSAL).toContain('kind: term');
  const proposal = await vault.read(PROPOSAL);
  expect(proposal).toContain('source: "[[2026-09-29 Platform weekly sync#^t0001]]"');
  expect(proposal).toMatch(/variants:\n\s+- Bren Wick/);
  // Everyday words are left out, and the log says why.
  await expectFile(vault, LOG).toContain('“Shall we” is everyday words');
  expect(await vault.exists('Inbox/Proposals/Shallwe.md')).toBe(false);

  // In the Inbox: its own card, saying where it was heard.
  await page.getByRole('button', { name: /^Inbox/ }).click();
  await expect(page.getByRole('region', { name: 'Move tasks to GTD statuses' })).toBeVisible();
  const card = page.getByRole('region', { name: 'Term: Brenwick' });
  await expect(card).toBeVisible();
  await expect(
    card.getByText(/Heard as “Bren Wick” in 2026-09-29 Platform weekly sync\./),
  ).toBeVisible();

  await card.getByRole('button', { name: 'Accept' }).click();
  await expectFile(vault, 'Terms/Brenwick.md').toContain('type: term');
  expect(await vault.read('Terms/Brenwick.md')).toMatch(/variants:\n\s+- Bren Wick/);
  await expect(card).toBeHidden();

  // The next meeting that mishears it arrives with the term put right.
  await arrive(page, vault, SECOND, SECOND_TEXT);
  await expectFile(vault, SECOND).toContain('Friday works for Brenwick. ^t0004');
  const second = await vault.read(SECOND);
  // Only the record of the change still says what was heard: the words are put right.
  expect(second.slice(second.indexOf('## Transcript'))).not.toContain('Bren Wick');
  expect(second).toMatch(/^atlas_corrections:\n {2}- from: Bren Wick\n {4}to: Brenwick/m);
  // The meeting it was heard in is left as it arrived.
  expect(await vault.read(FIRST)).toContain('start with the Bren Wick cache?');
  // Asked once per meeting: the rule runs after the import lets the meeting in, so it is waited for.
  await expect.poll(() => host.claude.runs().filter((run) => run.args[0] === '-p').length).toBe(2);
  await expectFile(vault, LOG).toContain('2026-10-06 Platform weekly sync');
});
