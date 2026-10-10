import { utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createVault, expectFile, installHost, type FakeVault } from './host.ts';

/**
 * P30-07: the weekly review. On a fixed clock, a vault's tasks and projects
 * land in exactly the sections they belong to — waiting too long, an active
 * project with nothing next, overdue, an idea left alone, and the Inbox's
 * count — and acting on an item takes it out of its section.
 */

/** 2026-10-08, midday where the test runs. */
const NOW = new Date(2026, 9, 8, 12, 0, 0);
const DAY = 86_400_000;

const note = (frontmatter: string[], body: string) =>
  ['---', ...frontmatter, '---', '', body, ''].join('\n');

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
  'Projects/Shed.md': { text: note(['type: project', 'status: paused'], 'Later.'), daysAgo: 1 },
  'Tasks/Quote from Larkspur.md': {
    text: note(['type: task', 'status: waiting', 'waiting_on: "[[Mara Quill]]"'], 'The quote.'),
    daysAgo: 10,
  },
  'Tasks/Reply from Tobias.md': {
    text: note(['type: task', 'status: waiting', 'waiting_on: "[[Mara Quill]]"'], 'Recent.'),
    daysAgo: 2,
  },
  'Tasks/Ship the review.md': {
    text: note(
      ['type: task', 'status: next-action', 'project: "[[Atlas]]"', 'due: 2026-10-05'],
      'This card.',
    ),
    daysAgo: 1,
  },
  'Tasks/Learn the cello.md': {
    text: note(['type: task', 'status: someday'], 'One day.'),
    daysAgo: 45,
  },
  'Tasks/Done long ago.md': {
    text: note(['type: task', 'status: archive', 'due: 2026-01-01'], 'Finished.'),
    daysAgo: 300,
  },
  'Inbox/Call the bank.md': { text: note(['type: task', 'status: inbox'], 'Card.'), daysAgo: 0 },
};

async function openReviewVault(page: Page): Promise<FakeVault> {
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

const review = (page: Page) => page.getByRole('article', { name: 'Weekly review' });
const section = (page: Page, name: string | RegExp) => review(page).getByRole('region', { name });
const itemsIn = (page: Page, name: string | RegExp) => section(page, name).locator('.table__title');

async function openReview(page: Page) {
  await page
    .getByRole('list', { name: 'Go to' })
    .getByRole('button', { name: 'Weekly review' })
    .click();
  await expect(review(page)).toBeVisible();
}

test('the review puts each item in exactly the section it belongs to', async ({ page }) => {
  await openReviewVault(page);
  await openReview(page);

  await expect(itemsIn(page, /^Waiting for more than 7 days/)).toHaveText(['Quote from Larkspur']);
  await expect(section(page, /^Waiting for more than 7 days/)).toContainText('On Mara Quill');
  await expect(itemsIn(page, 'Active projects with no next action')).toHaveText(['Garden']);
  await expect(itemsIn(page, 'Overdue')).toHaveText(['Ship the review']);
  await expect(itemsIn(page, /^Someday and Longterm/)).toHaveText(['Learn the cello']);
  await expect(section(page, 'Inbox')).toContainText('1 to process.');
});

test('archiving a waiting task takes it out of the review, finished today', async ({ page }) => {
  const vault = await openReviewVault(page);
  await openReview(page);
  const waiting = section(page, /^Waiting for more than 7 days/);
  await expect(itemsIn(page, /^Waiting for more than 7 days/)).toHaveText(['Quote from Larkspur']);

  await waiting.getByRole('button', { name: 'Archive Quote from Larkspur' }).click();

  await expect(waiting.getByText('Nothing has waited that long.')).toBeVisible();
  await expectFile(vault, 'Tasks/Quote from Larkspur.md').toContain('status: archive');
  await expectFile(vault, 'Tasks/Quote from Larkspur.md').toContain('completed: 2026-10-08');
});

test('deferring an overdue task takes it out until the day it comes back', async ({ page }) => {
  const vault = await openReviewVault(page);
  await openReview(page);
  const overdue = section(page, 'Overdue');
  await expect(itemsIn(page, 'Overdue')).toHaveText(['Ship the review']);

  await overdue.getByRole('button', { name: 'Defer Ship the review a week' }).click();

  await expect(overdue.getByText('Nothing is late.')).toBeVisible();
  await expectFile(vault, 'Tasks/Ship the review.md').toContain('defer: 2026-10-15');
});

test('moving a project on takes it out of the projects with nothing next', async ({ page }) => {
  const vault = await openReviewVault(page);
  await openReview(page);
  const projects = section(page, 'Active projects with no next action');
  await expect(itemsIn(page, 'Active projects with no next action')).toHaveText(['Garden']);

  await projects.getByRole('combobox', { name: 'Move Garden to' }).selectOption('paused');

  await expect(projects.getByText('Every active project has something to do next.')).toBeVisible();
  await expectFile(vault, 'Projects/Garden.md').toContain('status: paused');
});
