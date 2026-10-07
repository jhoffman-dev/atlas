import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { createVault, expectFile, installHost, sidebarSection, type FakeHost } from './host.ts';

/**
 * Phase 27: Claude beside the work. The model is a stub — the e2e host's
 * Claude Code prints scripted replies as stream-json — so what is proved is
 * Atlas's side: the context it opens with, the tools it runs for the model,
 * and that a proposed edit writes nothing until Accept.
 */

const PLAN = '# Plan\n\nOriginal paragraph.\n\nKept  exactly   as typed.\n';
const REVISED = '# Plan\n\nRevised paragraph.\n\nKept  exactly   as typed.\n';

const READ =
  'Let me read it.<atlas_tool>{"name":"atlas_read_note","input":{"path":"Plan.md"}}</atlas_tool>';
const PROPOSE =
  '<atlas_tool>{"name":"propose_edit","input":{"path":"Plan.md","edits":' +
  '[{"find":"Original paragraph.","replace":"Revised paragraph."}]}}</atlas_tool>';

async function openPlan(
  page: Page,
): Promise<{ host: FakeHost; vault: Awaited<ReturnType<typeof createVault>> }> {
  const vault = await createVault();
  await vault.write('Plan.md', PLAN);
  const host = await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  await sidebarSection(page, 'userSpace')
    .getByRole('treeitem', { name: 'Plan', exact: true })
    .click();
  await expect(page.getByRole('article', { name: 'Plan' })).toBeVisible();
  return { host, vault };
}

const chat = (page: Page) => page.getByRole('complementary', { name: 'Claude' });

async function ask(page: Page, question: string): Promise<void> {
  const box = chat(page).getByRole('textbox', { name: 'Ask Claude' });
  await box.fill(question);
  await box.press('Enter');
}

test('Claude opens on the note, reads it, proposes an edit, and writes it only on Accept', async ({
  page,
}) => {
  const { host, vault } = await openPlan(page);
  host.claude.reply(READ, PROPOSE, 'I proposed the change.');

  await page.getByRole('button', { name: 'Claude' }).first().click();
  await expect(chat(page)).toBeVisible();
  await expect(chat(page).getByRole('button', { name: 'Remove Plan from the chat' })).toBeVisible();

  await ask(page, 'Tidy this page');

  await expect(chat(page).getByText('Read Plan.md')).toBeVisible();
  const proposal = chat(page).getByRole('region', { name: 'Proposed edit: Plan' });
  await expect(proposal).toBeVisible();
  await expect(proposal.locator('.chat-proposal__block--removed')).toContainText(
    'Original paragraph.',
  );
  await expect(proposal.locator('.chat-proposal__block--added')).toContainText(
    'Revised paragraph.',
  );
  await expect(chat(page).getByText('I proposed the change.')).toBeVisible();

  // The model was told the note as context, and what the tool read.
  const turns = host.claude.runs().filter((run) => run.args[0] === '-p');
  expect(turns).toHaveLength(3);
  const system = turns[0]?.args[turns[0].args.indexOf('--system-prompt') + 1] ?? '';
  expect(system).toContain('<vault_data kind="note" title="Plan" path="Plan.md">');
  expect(turns[0]?.args[turns[0].args.indexOf('--tools') + 1]).toBe('');
  expect(turns[1]?.stdin).toContain('<tool_result name="atlas_read_note">');

  // Nothing is written before Accept.
  expect(await vault.read('Plan.md')).toBe(PLAN);

  await proposal.getByRole('button', { name: 'Accept' }).click();
  await expectFile(vault, 'Plan.md').toBe(REVISED);
  await expect(proposal.getByRole('status')).toHaveText('Accepted');
  await expect(page.getByRole('article', { name: 'Plan' })).toContainText('Revised paragraph.');

  // The conversation is kept as a note of the person's own.
  await expect
    .poll(() => vault.read('Chats/Tidy this page.md'))
    .toContain(
      '## You\n\nTidy this page\n\n## Claude\n\nLet me read it.\n\nI proposed the change.',
    );

  // One step back.
  await proposal.getByRole('button', { name: 'Undo' }).click();
  await expectFile(vault, 'Plan.md').toBe(PLAN);
});

test('a rejected edit leaves the note exactly as it was', async ({ page }) => {
  const { host, vault } = await openPlan(page);
  host.claude.reply(PROPOSE, 'Proposed.');
  await page.keyboard.press('Meta+j');
  await expect(chat(page)).toBeVisible();

  await ask(page, 'Change it');
  const proposal = chat(page).getByRole('region', { name: 'Proposed edit: Plan' });
  await expect(proposal.getByRole('button', { name: 'Accept' })).toBeVisible();
  await proposal.getByRole('button', { name: 'Reject' }).click();

  await expect(proposal.getByRole('status')).toHaveText('Rejected');
  await expect(proposal.getByRole('button', { name: 'Accept' })).toHaveCount(0);
  expect(await vault.read('Plan.md')).toBe(PLAN);

  await page.keyboard.press('Meta+j');
  await expect(chat(page)).toHaveCount(0);
});

test('a refused proposal says so, and why, in the pane and in the chat note', async ({ page }) => {
  const { host, vault } = await openPlan(page);
  host.claude.reply(
    '<atlas_tool>{"name":"propose_edit","input":{"path":"Plan.md","edits":' +
      '[{"find":"Not in the note.","replace":"x"}]}}</atlas_tool>',
    'That did not match.',
  );
  await page.keyboard.press('Meta+j');
  await ask(page, 'Change it');

  const line = chat(page).locator('.chat__tool[data-state="failed"]');
  await expect(line).toContainText('Could not propose an edit to Plan.md');
  await expect(line).toContainText('The note has no text "Not in the note."');
  await expect(chat(page).getByRole('region', { name: /Proposed edit/ })).toHaveCount(0);
  await expect
    .poll(() => vault.read('Chats/Change it.md'))
    .toContain('> Could not propose an edit to Plan.md: The note has no text "Not in the note."');
  expect(await vault.read('Plan.md')).toBe(PLAN);
});

test('when Claude Code is not logged in, the panel says how to fix it', async ({ page }) => {
  const { host } = await openPlan(page);
  host.claude.loggedIn(false);
  await page.getByRole('button', { name: 'Claude' }).first().click();
  await expect(chat(page).getByRole('alert')).toContainText('not logged in');
  await expect(chat(page).getByRole('alert')).toContainText('claude auth login');
});

test('screenshots: the panel with its context chip, a tool call and a proposed edit', async ({
  page,
}) => {
  const { host } = await openPlan(page);
  host.claude.reply(READ, PROPOSE, 'Here is a tidier opening paragraph. Accept it to write it.');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Claude' }).first().click();
  await expect(chat(page).getByRole('button', { name: 'Remove Plan from the chat' })).toBeVisible();
  await ask(page, 'Tidy the opening paragraph');
  await expect(
    chat(page).getByText('Here is a tidier opening paragraph.', { exact: false }),
  ).toBeVisible();
  await mkdir('design/out/shots', { recursive: true });
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((chosen) => {
      document.documentElement.dataset['theme'] = chosen;
    }, theme);
    await page.screenshot({ path: `design/out/shots/chat-${theme}.png` });
  }
});

/**
 * James's chat (2026-09-28): a note holding a block embed, a long answer
 * already in the pane, then a proposal adding a long section and a property.
 */
const EMBEDDING = '---\ntype: notes\n---\n![[Test Note#^8wdd59]]\n';
const SECTION = [
  '## Markdown Test',
  '',
  'Some **bold**, *italic*, ~~struck~~ and `code`.',
  '',
  '- One\n  - Nested\n- Two',
  '',
  '- [x] Done\n- [ ] Todo',
  '',
  '| Left | Centre |\n| --- | :---: |\n| a | b |',
  '',
  '> [!tip] Tip\n> Useful.',
  '',
  '```js\nconsole.log("hi");\n```',
  '',
  'See [[Atlas Field Guide]]. ^mdtest01',
  '',
  '#test #markdown',
].join('\n');
const EMBED_PROPOSE = `<atlas_tool>${JSON.stringify({
  name: 'propose_edit',
  input: {
    path: 'Another Test Note.md',
    append: SECTION,
    properties: { Notes_project: '[[Test]]' },
  },
})}</atlas_tool>`;
const LONG_ANSWER = Array.from(
  { length: 30 },
  (_, at) => `Paragraph ${at + 1} of a long answer about the note and what it embeds.`,
).join('\n\n');

async function scrollState(page: Page) {
  return page.evaluate(() => {
    const log = document.querySelector('.chat__log');
    return {
      page: document.scrollingElement?.scrollHeight ?? 0,
      viewport: window.innerHeight,
      logScrolls: log !== null && log.scrollHeight > log.clientHeight,
    };
  });
}

test('a proposal to a note holding a block embed is drawn whole after a long answer, and only the transcript scrolls', async ({
  page,
}) => {
  const vault = await createVault();
  await vault.write('Test Note.md', '# This is a test\n\nIsh wrote a funny post ^8wdd59\n');
  await vault.write('Another Test Note.md', EMBEDDING);
  const host = await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  await sidebarSection(page, 'userSpace')
    .getByRole('treeitem', { name: 'Another Test Note', exact: true })
    .click();
  host.claude.reply(LONG_ANSWER, `I've proposed an addition.${EMBED_PROPOSE}`, LONG_ANSWER);
  await page.keyboard.press('Meta+j');
  await expect(chat(page)).toBeVisible();

  await ask(page, 'What does the note say?');
  await expect(chat(page).getByText('Paragraph 30 of a long answer')).toBeAttached();
  await ask(page, 'Write a test section on the page');
  const proposal = chat(page).getByRole('region', { name: 'Proposed edit: Another Test Note' });
  await expect(proposal).toBeAttached();
  await expect(chat(page).getByText('Paragraph 30 of a long answer')).toHaveCount(2);

  // The app's window never scrolls; the transcript does.
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((chosen) => {
      document.documentElement.dataset['theme'] = chosen;
    }, theme);
    const scroll = await scrollState(page);
    expect(scroll.page, `${theme}: the window scrolls`).toBeLessThanOrEqual(scroll.viewport);
    expect(scroll.logScrolls, `${theme}: the transcript does not scroll`).toBe(true);
  }

  // The card is drawn whole, not squashed by the transcript it sits in.
  await proposal.scrollIntoViewIfNeeded();
  const drawn = await proposal.evaluate((card) => ({
    height: card.clientHeight,
    content: card.scrollHeight,
  }));
  expect(drawn.height).toBeGreaterThan(100);
  expect(drawn.height).toBeGreaterThanOrEqual(drawn.content - 1);
  const accept = proposal.getByRole('button', { name: 'Accept' });
  await expect(accept).toBeInViewport();
  expect(await vault.read('Another Test Note.md')).toBe(EMBEDDING);

  await accept.click();
  await expectFile(vault, 'Another Test Note.md').toBe(
    `---\ntype: notes\nNotes_project: "[[Test]]"\n---\n![[Test Note#^8wdd59]]\n\n${SECTION}\n`,
  );
  await expect(proposal.getByRole('status')).toHaveText('Accepted');
  expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(0);
});
