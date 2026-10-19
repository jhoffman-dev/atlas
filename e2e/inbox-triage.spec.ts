import { expect, test, type Page } from '@playwright/test';
import { createVault, expectFile, installHost, type FakeVault } from './host.ts';

/**
 * #307 (UI v2 slice 11a): one-key triage on the Inbox — a letter on a
 * focused row writes its status at once, P files it from the project picker,
 * keys sleep inside a field, Undo takes a key's write back — and proposals
 * that disagree asked as one "pick one" question. Every claim about a file
 * reads the disk.
 */

const GTD_TASK_TYPE = [
  '---',
  'name: task',
  'label: Task',
  'properties:',
  '  status:',
  '    kind: select',
  '    options: [inbox, backlog, next-action, in-progress, waiting, someday, longterm, archive]',
  '    done: archive',
  '  waiting_on:',
  '    kind: relation',
  '    target: person',
  '  project:',
  '    kind: relation',
  '    targets: [project, area]',
  '  defer: date',
  '  due: date',
  '  completed: date',
  '---',
  '',
  '# Task',
  '',
].join('\n');

const MEETING_TYPE = [
  '---',
  'name: meeting',
  'label: Meeting',
  'properties:',
  '  people:',
  '    kind: relation',
  '    target: person',
  '    many: true',
  '---',
  '',
].join('\n');

const PERSON_TYPE = ['---', 'name: person', 'label: Person', '---', '', '# Person', ''].join('\n');

const note = (frontmatter: string[], body: string) =>
  ['---', ...frontmatter, '---', '', body, ''].join('\n');

const STANDUP = 'Inbox/Meetings/2026-10-16 Platform Standup.md';

/** Three links for one mention in one block: the same kind, source and slot, three values. */
const maraLink = (link: string) =>
  [
    '---',
    'type: proposal',
    'kind: link',
    'state: open',
    'confidence: low',
    'source: "[[2026-10-16 Platform Standup#^t0002]]"',
    'made_by: after-meeting · run 1',
    'payload:',
    `  note: ${STANDUP}`,
    '  property: people',
    `  link: "${link}"`,
    '---',
    '',
    'Mara spoke at 00:09.',
    '',
  ].join('\n');

const TODAY = new Date().toLocaleDateString('en-CA');
const FILED_CALL = `Tasks/${TODAY.slice(0, 4)}/${TODAY.slice(5, 7)}/Call the bank.md`;

async function triageVault(): Promise<FakeVault> {
  const vault = await createVault();
  for (const folder of ['.atlas/types', 'Projects', 'People', 'Tasks', 'Inbox/Meetings']) {
    await vault.mkdir(folder);
  }
  await vault.write('.atlas/types/task.md', GTD_TASK_TYPE);
  await vault.write('.atlas/types/meeting.md', MEETING_TYPE);
  await vault.write('.atlas/types/person.md', PERSON_TYPE);
  await vault.write('Projects/Atlas.md', note(['type: project'], 'The app.'));
  await vault.write('People/Mara Quill.md', note(['type: person'], 'A neighbour.'));
  await vault.write('People/Mara Quill (Larkspur).md', note(['type: person'], 'At Larkspur.'));
  await vault.write('People/Tobias Fenn.md', note(['type: person'], 'A friend.'));
  await vault.write('Inbox/Call the bank.md', note(['type: task', 'status: inbox'], 'The loan.'));
  await vault.write('Inbox/Chase the quote.md', note(['type: task', 'status: inbox'], 'Larkspur.'));
  await vault.write('Inbox/Learn the cello.md', note(['type: task', 'status: inbox'], 'One day.'));
  return vault;
}

async function withConflict(vault: FakeVault): Promise<void> {
  await vault.mkdir('Inbox/Proposals');
  await vault.write(STANDUP, note(['type: meeting'], 'Who brings what. ^t0002'));
  await vault.write('Inbox/Proposals/Mara 1.md', maraLink('[[Mara Quill]]'));
  await vault.write('Inbox/Proposals/Mara 2.md', maraLink('[[Mara Quill (Larkspur)]]'));
  await vault.write('Inbox/Proposals/Mara 3.md', maraLink('[[Tobias Fenn]]'));
}

async function open(page: Page, vault: FakeVault): Promise<void> {
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible({ timeout: 20_000 });
  await page
    .getByRole('list', { name: 'Go to' })
    .getByRole('button', { name: /^Inbox/ })
    .click();
  await expect(inboxPage(page).getByRole('table')).toBeVisible();
}

const inboxPage = (page: Page) => page.getByRole('article', { name: 'Inbox' });
const row = (page: Page, title: string) =>
  inboxPage(page)
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) });

/** The task rows in the order the page lists them, by title. */
async function listedTasks(page: Page): Promise<string[]> {
  const inbox = inboxPage(page);
  const tasks = inbox
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: 'Done', exact: true }) });
  await expect(tasks).toHaveCount(3);
  return tasks.locator('.table__title').allTextContents();
}

test('a letter on a focused row writes its status at once, the next row takes the focus, and Undo takes it back', async ({
  page,
}) => {
  const vault = await triageVault();
  await open(page, vault);
  const [first = '', second = ''] = await listedTasks(page);
  const inbox = inboxPage(page);

  await row(page, first).focus();
  await expect(row(page, first).getByRole('button', { name: 'Next, key N' })).toBeVisible();
  await page.keyboard.press('n');
  await expectFile(vault, `Inbox/${first}.md`).toContain('status: next-action');
  await expect(row(page, first)).toHaveCount(0);
  await expect(row(page, second)).toBeFocused();

  await page.keyboard.press('w');
  await expectFile(vault, `Inbox/${second}.md`).toContain('status: waiting');
  await expect(row(page, second)).toHaveCount(0);

  const said = inbox.getByRole('status').filter({ hasText: `Clarified “${second}”.` });
  await said.getByRole('button', { name: 'Undo' }).click();
  await expectFile(vault, `Inbox/${second}.md`).toContain('status: inbox');
  await expect(row(page, second)).toBeVisible();
});

test('a letter typed in one of the row’s fields is a letter, not a triage key', async ({
  page,
}) => {
  const vault = await triageVault();
  await open(page, vault);
  const [first = ''] = await listedTasks(page);

  const status = inboxPage(page).getByRole('combobox', { name: `Status of ${first}` });
  await status.focus();
  await page.keyboard.press('n');
  await page.keyboard.press('d');
  await expect(row(page, first)).toBeVisible();

  // The same row, with the row itself focused, is live: so the keys above wrote nothing.
  await row(page, first).focus();
  await page.keyboard.press('s');
  await expectFile(vault, `Inbox/${first}.md`).toContain('status: someday');
  expect(await vault.read(`Inbox/${first}.md`)).not.toContain('next-action');
  expect(await vault.exists('Archive')).toBe(false);
});

test('P opens the project picker, and the project picked files the task at once with its status as it was', async ({
  page,
}) => {
  const vault = await triageVault();
  await open(page, vault);

  await row(page, 'Call the bank').focus();
  await page.keyboard.press('p');
  const picker = inboxPage(page).getByRole('combobox', { name: 'File Call the bank under' });
  await expect(picker).toBeFocused();
  await picker.selectOption({ label: 'Atlas' });

  await expectFile(vault, FILED_CALL).toContain('[[Atlas]]');
  expect(await vault.read(FILED_CALL)).toContain('status: inbox');
  expect(await vault.exists('Inbox/Call the bank.md')).toBe(false);
});

test('proposals that disagree are one question: Accept choice accepts the one picked and rejects the rest', async ({
  page,
}) => {
  const vault = await triageVault();
  await withConflict(vault);
  await open(page, vault);
  const inbox = inboxPage(page);

  const question = inbox.getByRole('region', {
    name: 'Pick one: Which link for people of 2026-10-16 Platform Standup?',
  });
  await expect(question).toBeVisible();
  await expect(
    question.getByText('3 proposals disagree. Pick one; the others are rejected.'),
  ).toBeVisible();
  await expect(inbox.getByRole('region', { name: /^Link: / })).toHaveCount(0);
  const accept = question.getByRole('button', { name: 'Accept choice' });
  await expect(accept).toBeDisabled();

  await question.getByRole('radio', { name: '[[Mara Quill (Larkspur)]]' }).check();
  await accept.click();

  await expectFile(vault, 'Archive/Inbox/Proposals/Mara 2.md').toContain('state: accepted');
  await expectFile(vault, 'Archive/Inbox/Proposals/Mara 1.md').toContain('state: rejected');
  await expectFile(vault, 'Archive/Inbox/Proposals/Mara 3.md').toContain('state: rejected');
  await expectFile(vault, STANDUP).toContain('[[Mara Quill (Larkspur)]]');
  expect(await vault.read(STANDUP)).not.toContain('[[Tobias Fenn]]');
  await expect(question).toHaveCount(0);
});

test('Reject all files every proposal of the question as rejected, writing nothing to the note', async ({
  page,
}) => {
  const vault = await triageVault();
  await withConflict(vault);
  await open(page, vault);
  const question = inboxPage(page).getByRole('region', { name: /^Pick one: / });
  await expect(question).toBeVisible();

  await question.getByRole('button', { name: 'Reject all' }).click();
  for (const name of ['Mara 1', 'Mara 2', 'Mara 3']) {
    await expectFile(vault, `Archive/Inbox/Proposals/${name}.md`).toContain('state: rejected');
  }
  expect(await vault.read(STANDUP)).not.toContain('people');
  await expect(question).toHaveCount(0);
});
