import { utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createVault, expectFile, installHost, type FakeVault } from './host.ts';

/**
 * #111: the Today page. On a fixed clock, a vault's tasks land in exactly the
 * sections they belong to, with their counts; a tick, a defer and a move each
 * change the page without a reload; and Waiting is refused without a person.
 */

/** 2026-10-13, midday where the test runs. */
const NOW = new Date(2026, 9, 13, 12, 0, 0);
const DAY = 86_400_000;

const note = (frontmatter: string[], body: string) =>
  ['---', ...frontmatter, '---', '', body, ''].join('\n');
const task = (frontmatter: string[]) => note(['type: task', ...frontmatter], 'A task.');

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
  '  contexts:',
  '    kind: multi-select',
  '  completed: date',
  '  defer: date',
  '  due: date',
  '---',
  '',
  '# Task',
  '',
].join('\n');

const PROJECT_TYPE = [
  '---',
  'name: project',
  'label: Project',
  'properties:',
  '  status:',
  '    kind: select',
  '    options: [planned, active, paused, done]',
  '    done: done',
  '---',
  '',
  '# Project',
  '',
].join('\n');

/** Each note, and how many days before now it last changed. */
const NOTES: Record<string, { text: string; daysAgo: number }> = {
  'People/Mara Quill.md': { text: note(['type: person'], 'At Larkspur Payroll.'), daysAgo: 1 },
  'Projects/Atlas.md': { text: note(['type: project', 'status: active'], 'The app.'), daysAgo: 1 },
  'Projects/Garden.md': {
    text: note(['type: project', 'status: active'], 'Beds and seeds.'),
    daysAgo: 1,
  },
  'Projects/Shed.md': { text: note(['type: project', 'status: active'], 'Later.'), daysAgo: 1 },
  'Tasks/Renew the licence.md': {
    text: task(['status: backlog', 'due: 2026-10-10']),
    daysAgo: 1,
  },
  'Tasks/Send the figures.md': {
    text: task(['status: next-action', 'due: 2026-10-13', 'project: "[[Atlas]]"']),
    daysAgo: 1,
  },
  'Tasks/Book the venue.md': {
    text: task(['status: someday', 'defer: 2026-10-13']),
    daysAgo: 1,
  },
  'Tasks/Clear the shed.md': {
    text: task(['status: backlog', 'defer: 2026-10-09']),
    daysAgo: 6,
  },
  'Tasks/Draft the plan.md': {
    text: task(['status: in-progress', 'project: "[[Atlas]]"']),
    daysAgo: 1,
  },
  'Tasks/Ship the page.md': {
    text: task(['status: next-action', 'project: "[[Atlas]]"', 'contexts: ["@desk"]']),
    daysAgo: 1,
  },
  'Tasks/Sow the beans.md': {
    text: task(['status: next-action', 'project: "[[Garden]]"']),
    daysAgo: 1,
  },
  'Tasks/Call the bank.md': { text: task(['status: next-action']), daysAgo: 1 },
  'Tasks/Not until Friday.md': {
    text: task(['status: next-action', 'defer: 2026-10-16']),
    daysAgo: 1,
  },
  'Tasks/Quote from Larkspur.md': {
    text: task(['status: waiting', 'waiting_on: "[[Mara Quill]]"']),
    daysAgo: 4,
  },
  'Tasks/Done long ago.md': {
    text: task(['status: archive', 'due: 2026-10-13']),
    daysAgo: 30,
  },
  'Inbox/Idea.md': { text: note(['type: task', 'status: inbox'], 'Card.'), daysAgo: 0 },
};

async function openTodayVault(page: Page): Promise<FakeVault> {
  const vault = await createVault();
  for (const folder of ['.atlas/types', 'People', 'Projects', 'Tasks', 'Inbox']) {
    await vault.mkdir(folder);
  }
  await vault.write('.atlas/types/task.md', GTD_TASK_TYPE);
  await vault.write('.atlas/types/project.md', PROJECT_TYPE);
  await vault.write('.atlas/types/person.md', '---\nname: person\nlabel: Person\n---\n');
  for (const [path, { text, daysAgo }] of Object.entries(NOTES)) {
    await vault.write(path, text);
    const when = new Date(NOW.getTime() - daysAgo * DAY);
    await utimes(join(vault.root, path), when, when);
  }
  await installHost(page, vault);
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

const today = (page: Page) => page.getByRole('article', { name: 'Today' });
const section = (page: Page, name: string) =>
  today(page).getByRole('region', { name, exact: true });
const itemsIn = (page: Page, name: string) => section(page, name).locator('.table__title');
const countOf = (page: Page, name: string) =>
  section(page, name).locator('.review__heading .review__count');

async function openToday(page: Page) {
  await page.getByRole('list', { name: 'Go to' }).getByRole('button', { name: 'Today' }).click();
  await expect(today(page)).toBeVisible();
}

test('Today puts each task in its section, with counts, with no view named Today', async ({
  page,
}) => {
  await openTodayVault(page);
  await openToday(page);

  await expect(itemsIn(page, 'Overdue')).toHaveText(['Renew the licence']);
  await expect(itemsIn(page, 'Due today')).toHaveText(['Send the figures']);
  // Put off until today, and put off until a day that passed unseen.
  await expect(itemsIn(page, 'Back from deferral')).toHaveText([
    'Book the venue',
    'Clear the shed',
  ]);
  await expect(itemsIn(page, 'In progress')).toHaveText(['Draft the plan']);
  await expect(itemsIn(page, 'Next actions')).toHaveText([
    'Ship the page',
    'Sow the beans',
    'Call the bank',
  ]);
  await expect(itemsIn(page, 'Waiting')).toHaveText(['Quote from Larkspur']);
  for (const [name, count] of [
    ['Overdue', '1'],
    ['Due today', '1'],
    ['Back from deferral', '2'],
    ['In progress', '1'],
    ['Next actions', '3'],
    ['Waiting', '1'],
  ] as const) {
    await expect(countOf(page, name)).toHaveText(count);
  }

  const next = section(page, 'Next actions');
  await expect(next.getByRole('group').locator('.today__group-name')).toContainText([
    'Atlas',
    'Garden',
    'No project',
  ]);
  await expect(next.getByRole('group', { name: 'Atlas' })).toContainText('@desk');
  const waiting = section(page, 'Waiting');
  await expect(waiting.getByRole('group', { name: 'Mara Quill' })).toContainText(
    '4 days since last change',
  );
  await expect(waiting).toContainText('counted from each task’s last change');

  const elsewhere = today(page).getByRole('navigation', { name: 'Elsewhere' });
  await expect(elsewhere.getByRole('button', { name: /^Inbox 1/ })).toBeVisible();
  // Atlas and Garden have something next or under way; Shed has neither.
  await expect(elsewhere.getByRole('button', { name: /^Stalled projects 1/ })).toBeVisible();
});

test('ticking a task finishes it and takes it off the page, and Undo brings it back', async ({
  page,
}) => {
  const vault = await openTodayVault(page);
  await openToday(page);
  await expect(itemsIn(page, 'In progress')).toHaveText(['Draft the plan']);

  // A click, not `check()`: the box is never left ticked — the row leaves instead.
  await section(page, 'In progress')
    .getByRole('checkbox', { name: 'Mark Draft the plan done' })
    .click();

  await expect(section(page, 'In progress').getByText('Nothing is under way.')).toBeVisible();
  await expect(countOf(page, 'In progress')).toHaveText('0');
  await expectFile(vault, 'Tasks/Draft the plan.md').toContain('status: archive');
  await expectFile(vault, 'Tasks/Draft the plan.md').toContain('completed: 2026-10-13');

  await today(page).getByRole('status').getByRole('button', { name: 'Undo' }).click();

  await expect(itemsIn(page, 'In progress')).toHaveText(['Draft the plan']);
  await expectFile(vault, 'Tasks/Draft the plan.md').toContain('status: in-progress');
  await expectFile(vault, 'Tasks/Draft the plan.md').not.toContain('completed');
});

test('deferring a task a day takes it off the page until tomorrow', async ({ page }) => {
  const vault = await openTodayVault(page);
  await openToday(page);
  await expect(itemsIn(page, 'Overdue')).toHaveText(['Renew the licence']);

  await section(page, 'Overdue')
    .getByRole('button', { name: 'Defer Renew the licence 1 day' })
    .click();

  await expect(section(page, 'Overdue').getByText('Nothing is late.')).toBeVisible();
  await expectFile(vault, 'Tasks/Renew the licence.md').toContain('defer: 2026-10-14');
  // Focus follows the work: the row that was under it.
  await expect(
    today(page).getByRole('checkbox', { name: 'Mark Send the figures done' }),
  ).toBeFocused();
});

test('moving a task to Waiting needs a person, and says so', async ({ page }) => {
  const vault = await openTodayVault(page);
  await openToday(page);
  const next = section(page, 'Next actions');

  await next.getByRole('button', { name: 'Move Call the bank to…' }).click();
  await page.getByRole('menu', { name: 'Move Call the bank to' }).getByText('Waiting').click();

  await expect(today(page).getByRole('alert')).toContainText('needs someone to wait on');
  await expect(itemsIn(page, 'Next actions')).toContainText(['Call the bank']);
  await expectFile(vault, 'Tasks/Call the bank.md').toContain('status: next-action');

  await next.getByRole('button', { name: 'Move Call the bank to…' }).click();
  await page.getByRole('menu', { name: 'Move Call the bank to' }).getByText('Someday').click();

  await expect(itemsIn(page, 'Next actions')).toHaveText(['Ship the page', 'Sow the beans']);
  await expectFile(vault, 'Tasks/Call the bank.md').toContain('status: someday');
});

test('a saved view titled Today does not make a second sidebar row', async ({ page }) => {
  const vault = await createVault();
  for (const folder of ['.atlas/types', '.atlas/views', 'Tasks']) await vault.mkdir(folder);
  await vault.write('.atlas/types/task.md', GTD_TASK_TYPE);
  await vault.write('Tasks/Call the bank.md', task(['status: next-action']));
  await vault.write('.atlas/views/Today.md', note(['atlas: view', 'type: task'], ''));
  await installHost(page, vault);
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();

  const rows = page.getByRole('list', { name: 'Go to' }).getByRole('button', { name: 'Today' });
  await expect(rows).toHaveCount(1);
  await rows.click();
  await expect(today(page)).toBeVisible();
  await expect(today(page).getByRole('button', { name: 'Open the “Today” view' })).toBeVisible();
});

test('⌘K opens Today', async ({ page }) => {
  await openTodayVault(page);
  await page.keyboard.down('Meta');
  await page.keyboard.press('k');
  await page.keyboard.up('Meta');
  const palette = page.getByRole('dialog', { name: 'Search notes' });
  await page.getByRole('searchbox', { name: 'Search the vault' }).fill('Today');
  await palette.getByRole('option', { name: 'Today', exact: true }).click();
  await expect(today(page)).toBeVisible();
});
