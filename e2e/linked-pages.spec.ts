/**
 * Linked pages (P30-06): a Person, Company, Project or Meeting page shows its
 * meetings, waiting-fors, open tasks and decisions without a word being
 * written into it, and a meeting and the tasks that came from it show each
 * other. Every section is a compiled Atlas query, run for real against SQLite
 * in the stand-in host. Dates count back from the day the suite runs, as the
 * index's own "last 30 days" does.
 */
import { mkdir, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from './fixtures.ts';
import {
  createVault,
  emitVaultChanged,
  installHost,
  sidebarSection,
  type FakeVault,
} from './host.ts';

const DAY = 86_400_000;
const NOW = Date.now();

/** That many days before today, as a note's `date:` is written. */
const daysAgo = (days: number): string => new Date(NOW - days * DAY).toLocaleDateString('en-CA');

const front = (lines: string[], body = '') => ['---', ...lines, '---', '', body, ''].join('\n');

const TYPES: Record<string, string> = {
  person: front([
    'name: person',
    'label: Person',
    'properties:',
    '  role: text',
    '  company:',
    '    kind: relation',
    '    target: company',
  ]),
  company: front(['name: company', 'label: Company']),
  project: front([
    'name: project',
    'label: Project',
    'properties:',
    '  status:',
    '    kind: select',
    '    options: [planned, active, paused, done]',
    '    done: done',
  ]),
  meeting: front([
    'name: meeting',
    'label: Meeting',
    'properties:',
    '  date: date',
    '  people:',
    '    kind: relation',
    '    target: person',
    '    many: true',
    '  companies:',
    '    kind: relation',
    '    target: company',
    '    many: true',
    '  project:',
    '    kind: relation',
    '    target: project',
  ]),
  decision: front([
    'name: decision',
    'label: Decision',
    'properties:',
    '  date: date',
    '  meeting:',
    '    kind: relation',
    '    target: meeting',
    '  project:',
    '    kind: relation',
    '    target: project',
  ]),
  task: front([
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
    '    target: project',
    '  due: date',
    '  source: text',
  ]),
};

const MARA = 'People/Mara Quill.md';
const MARA_TEXT = front(
  ['type: person', 'role: Controller', 'company: "[[Larkspur Payroll]]"'],
  'Runs payroll at Larkspur. Prefers mornings.',
);

/** Each note, and how many days ago its file last changed. */
const NOTES: Record<string, { text: string; changed?: number }> = {
  [MARA]: { text: MARA_TEXT },
  'People/Tobias Fenn.md': {
    text: front(['type: person', 'role: Engineer', 'company: "[[Larkspur Payroll]]"']),
  },
  'Companies/Larkspur Payroll.md': { text: front(['type: company'], 'A payroll bureau.') },
  'Projects/Payroll Migration.md': {
    text: front(['type: project', 'status: active'], 'Moving [[Larkspur Payroll]] to the new run.'),
  },
  'Projects/Idle.md': { text: front(['type: project', 'status: active']) },
  'Meetings/Kickoff.md': {
    text: front(
      [
        'type: meeting',
        `date: ${daysAgo(5)}`,
        'people: ["[[Mara Quill]]", "[[Tobias Fenn]]"]',
        'companies: ["[[Larkspur Payroll]]"]',
        'project: "[[Payroll Migration]]"',
      ],
      '**Mara Quill:** We sign once the contract is back. ^t0003\n\n**Tobias Fenn:** I will book the room. ^t0007',
    ),
  },
  'Meetings/Cut-over review.md': {
    text: front([
      'type: meeting',
      `date: ${daysAgo(12)}`,
      'people: ["[[Mara Quill]]"]',
      'companies: ["[[Larkspur Payroll]]"]',
      'project: "[[Payroll Migration]]"',
    ]),
  },
  'Meetings/First call.md': {
    text: front(['type: meeting', `date: ${daysAgo(45)}`, 'people: ["[[Mara Quill]]"]']),
  },
  // As an accepted proposal writes a waiting-for today: its `source` cites the meeting's turn.
  'Tasks/Send the contract.md': {
    text: front([
      'type: task',
      'status: waiting',
      'waiting_on: "[[Mara Quill]]"',
      'project: "[[Payroll Migration]]"',
      'source: "[[Kickoff#^t0003]]"',
    ]),
    changed: 12,
  },
  'Tasks/Confirm the pay calendar.md': {
    text: front(['type: task', 'status: waiting', 'waiting_on: "[[Tobias Fenn]]"']),
    changed: 3,
  },
  'Tasks/Book the room.md': {
    text: front([
      'type: task',
      'status: inbox',
      'project: "[[Payroll Migration]]"',
      'source: "[[Kickoff#^t0007]]"',
    ]),
  },
  'Tasks/Draft the cut-over plan.md': {
    text: front(
      [
        'type: task',
        'status: next-action',
        'project: "[[Payroll Migration]]"',
        `due: ${daysAgo(-3)}`,
      ],
      'Ask [[Mara Quill]] about the cut-over.',
    ),
  },
  'Tasks/Archive the old run.md': {
    text: front(['type: task', 'status: someday', 'project: "[[Payroll Migration]]"']),
  },
  'Tasks/Tidy the backlog.md': {
    text: front(['type: task', 'status: backlog', 'project: "[[Idle]]"']),
  },
  'Tasks/Signed off.md': {
    text: front(
      ['type: task', 'status: archive', 'project: "[[Payroll Migration]]"'],
      'With [[Mara Quill]].',
    ),
  },
  'Decisions/Two-step approval.md': {
    text: front(
      [
        'type: decision',
        `date: ${daysAgo(5)}`,
        'meeting: "[[Kickoff]]"',
        'project: "[[Payroll Migration]]"',
        'source: "[[Kickoff#^t0003]]"',
      ],
      'Agreed with [[Mara Quill]].',
    ),
  },
};

async function openVault(page: Page): Promise<FakeVault> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const vault = await createVault();
  const folders = [
    '.atlas/types',
    'People',
    'Companies',
    'Projects',
    'Meetings',
    'Tasks',
    'Decisions',
  ];
  for (const folder of folders) await vault.mkdir(folder);
  for (const [name, text] of Object.entries(TYPES))
    await vault.write(`.atlas/types/${name}.md`, text);
  for (const [path, { text, changed }] of Object.entries(NOTES)) {
    await vault.write(path, text);
    if (changed !== undefined) {
      const when = new Date(NOW - changed * DAY);
      await utimes(join(vault.root, path), when, when);
    }
  }
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

async function openNote(page: Page, folder: string, name: string) {
  const pages = sidebarSection(page, 'userSpace');
  const row = pages.getByRole('treeitem', { name, exact: true });
  if (!(await row.isVisible())) {
    await pages.getByRole('treeitem', { name: folder, exact: true }).click();
  }
  await row.click();
  await expect(page.getByRole('article', { name })).toBeVisible();
}

const section = (page: Page, name: string): Locator =>
  page.getByRole('region', { name: 'Linked' }).getByRole('region', { name, exact: true });
const rows = (within: Locator): Locator => within.getByRole('listitem');
const titles = (within: Locator): Locator => within.locator('.list-view__title');

test('a person shows their meetings and waiting-fors; a meeting and its tasks show each other', async ({
  page,
}) => {
  const vault = await openVault(page);
  await openNote(page, 'People', 'Mara Quill');

  // Her meetings of the last 30 days, newest first, each with its day.
  const meetings = section(page, 'Meetings');
  await expect(titles(meetings)).toHaveText(['Kickoff', 'Cut-over review']);
  await expect(rows(meetings).first()).toContainText(daysAgo(5));
  await expect(meetings.getByLabel('2 notes')).toHaveText('2');

  // What she is waited on for, with how long it has waited.
  const waiting = section(page, 'Waiting for');
  await expect(titles(waiting)).toHaveText(['Send the contract']);
  await expect(rows(waiting).first()).toContainText('waiting 12 days');

  // Her other open tasks: the one that links her, not the finished one, not the waiting-for again.
  await expect(titles(section(page, 'Open tasks'))).toHaveText(['Draft the cut-over plan']);
  await expect(titles(section(page, 'Decisions'))).toHaveText(['Two-step approval']);

  // All reaches back past the 30 days — and is remembered for every person on this Mac.
  await meetings.getByRole('radio', { name: 'All' }).click();
  await expect(titles(meetings)).toHaveText(['Kickoff', 'Cut-over review', 'First call']);
  await openNote(page, 'People', 'Tobias Fenn');
  await expect(section(page, 'Meetings').getByRole('radio', { name: 'All' })).toBeChecked();
  await expect(titles(section(page, 'Waiting for'))).toHaveText(['Confirm the pay calendar']);
  await expect(rows(section(page, 'Waiting for')).first()).toContainText('waiting 3 days');
  // Nothing was decided with him: the section is one quiet line.
  await expect(section(page, 'Decisions')).toContainText('none in the last 30 days');
  await expect(rows(section(page, 'Decisions'))).toHaveCount(0);

  // Through to the meeting: its people, and the tasks and decisions that came from it.
  await openNote(page, 'People', 'Mara Quill');
  await titles(section(page, 'Meetings')).filter({ hasText: 'Kickoff' }).click();
  await expect(page.getByRole('article', { name: 'Kickoff' })).toBeVisible();
  await expect(titles(section(page, 'People'))).toHaveText(['Mara Quill', 'Tobias Fenn']);
  await expect(rows(section(page, 'People')).first()).toContainText('Larkspur Payroll');
  const fromIt = section(page, 'Tasks');
  await expect(titles(fromIt)).toHaveText(['Book the room', 'Send the contract']);
  // A status reads as its label, not as the file spells it.
  await expect(rows(fromIt).first()).toContainText('Inbox');
  await expect(titles(section(page, 'Decisions'))).toHaveText(['Two-step approval']);

  // And back: the task shows the meeting it came from.
  await titles(fromIt).filter({ hasText: 'Send the contract' }).click();
  await expect(page.getByRole('article', { name: 'Send the contract' })).toBeVisible();
  await expect(titles(section(page, 'Meetings'))).toHaveText(['Kickoff']);
  await titles(section(page, 'Meetings')).click();
  await expect(page.getByRole('article', { name: 'Kickoff' })).toBeVisible();

  // None of it was written anywhere: her note is byte for byte what it was.
  expect(await vault.read(MARA)).toBe(MARA_TEXT);
});

test('a company and a project show what hangs off them, and follow the vault', async ({ page }) => {
  const vault = await openVault(page);
  await openNote(page, 'Companies', 'Larkspur Payroll');
  await expect(titles(section(page, 'People'))).toHaveText(['Mara Quill', 'Tobias Fenn']);
  await expect(rows(section(page, 'People')).first()).toContainText('Controller');
  await expect(titles(section(page, 'Meetings'))).toHaveText(['Kickoff', 'Cut-over review']);
  // What is waited on from its people, the longest wait first.
  await expect(titles(section(page, 'Waiting for'))).toHaveText([
    'Send the contract',
    'Confirm the pay calendar',
  ]);
  await expect(titles(section(page, 'Projects'))).toHaveText(['Payroll Migration']);

  await openNote(page, 'Projects', 'Payroll Migration');
  const tasks = section(page, 'Open tasks');
  // What to do next comes first, whatever order the type lists its statuses in.
  await expect(tasks.getByRole('group')).toHaveCount(3);
  await expect(tasks.getByRole('group').first()).toHaveAttribute('aria-label', 'next-action');
  await expect(titles(tasks)).toHaveText([
    'Draft the cut-over plan',
    'Book the room',
    'Archive the old run',
  ]);
  await expect(tasks.getByRole('note')).toHaveCount(0);
  await expect(rows(section(page, 'Waiting for')).first()).toContainText(
    'Mara Quill · waiting 12 days',
  );

  // A meeting that arrives from another app reaches the page without a reload.
  await vault.write(
    'Meetings/Go-live check.md',
    front(['type: meeting', `date: ${daysAgo(1)}`, 'project: "[[Payroll Migration]]"']),
  );
  await emitVaultChanged(page, ['Meetings/Go-live check.md']);
  await expect(titles(section(page, 'Meetings'))).toHaveText([
    'Go-live check',
    'Kickoff',
    'Cut-over review',
  ]);

  // A project with open work and nothing moving says so.
  await openNote(page, 'Projects', 'Idle');
  await expect(section(page, 'Open tasks').getByRole('note')).toHaveText(
    'No next action: its one open task is not Next Action or In Progress.',
  );
});

test('screenshots: a person, a company, a project and a meeting, light and dark', async ({
  page,
}) => {
  await openVault(page);
  await mkdir('design/out/shots', { recursive: true });
  const pages = [
    ['person', 'People', 'Mara Quill', 'Waiting for'],
    ['company', 'Companies', 'Larkspur Payroll', 'People'],
    ['project', 'Projects', 'Payroll Migration', 'Open tasks'],
    ['meeting', 'Meetings', 'Kickoff', 'Tasks'],
  ] as const;
  for (const [kind, folder, name, shows] of pages) {
    await openNote(page, folder, name);
    await expect(rows(section(page, shows)).first()).toBeVisible();
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((chosen) => {
        document.documentElement.dataset['theme'] = chosen;
      }, theme);
      await page.screenshot({ path: `design/out/shots/linked-pages-${kind}-${theme}.png` });
    }
  }
});
