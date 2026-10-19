import { expect, test, type Locator, type Page } from './fixtures.ts';
import { createVault, expectFile, installHost, sidebarSection } from './host.ts';
import { dragWithKeyboard, dragWithPointer } from './drag.ts';

const TASK_TYPE = ['---', 'name: task', 'properties:', '  due: date', '---', ''].join('\n');
const CALENDAR = [
  '---',
  'atlas: view',
  'type: task',
  'layout: calendar',
  'dateKey: due',
  'columns: [due]',
  'limit: 100',
  '---',
  '',
  '# Calendar',
  '',
].join('\n');
const DAILY_TEMPLATE = ['---', 'type: daily', '---', '', '## What happened', '', ''].join('\n');

/**
 * The page's clock is held here, so the calendar opens on the same month
 * whatever day the suite runs. Midday local time: the browser and this file
 * share the machine's time zone, so both read the same day.
 */
const NOW = new Date(2026, 8, 22, 12);

// The day where the person is, which is what the app names a daily note after.
// Read in UTC, this expectation was a day ahead for every evening west of London.
const today = NOW.toLocaleDateString('en-CA');

/** Where today's note lives: the daily type's home for its year (#214). */
const DAILY = `Daily/${today.slice(0, 4)}`;

/**
 * A day of the month the calendar opens on. The drag tests start from the
 * 15th, so a day or a week either way stays inside the six weeks shown
 * whatever day the suite runs on.
 */
const dayOfMonth = (day: number) => `${today.slice(0, 8)}${String(day).padStart(2, '0')}`;

/** The day after `date`. Today's is always in the grid: six weeks is more than a month. */
function dayAfter(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + 1)).toISOString().slice(0, 10);
}

async function openCalendar(page: Page, extra: Readonly<Record<string, string>> = {}) {
  const vault = await createVault();
  for (const [path, body] of Object.entries(extra)) await vault.write(path, body);
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/views');
  await vault.mkdir('.atlas/templates');
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  await vault.write('.atlas/views/Calendar.md', CALENDAR);
  await vault.write('.atlas/templates/Daily.md', DAILY_TEMPLATE);
  await vault.write(
    'scheduled.md',
    ['---', 'type: task', `due: ${today}`, '---', '', 'Due today.', ''].join('\n'),
  );
  await vault.write(
    'mid.md',
    ['---', 'type: task', `due: ${dayOfMonth(15)}`, '---', '', 'Mid-month.', ''].join('\n'),
  );
  await vault.write('unscheduled.md', ['---', 'type: task', '---', '', 'No date.', ''].join('\n'));

  await installHost(page, vault);
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

async function openCalendarView(page: Page) {
  await sidebarSection(page, 'views')
    .getByRole('button', { name: 'Calendar', exact: true })
    .click();
  await expect(page.locator('.calendar__grid')).toBeVisible();
}

test('a note appears on the day it is due', async ({ page }) => {
  await openCalendar(page);
  await openCalendarView(page);

  const day = page.getByLabel(today, { exact: true });
  await expect(day.getByRole('button', { name: 'scheduled' })).toBeVisible();
});

const LONG = 'A title long enough to run past the edge of its day in any month of the year';

/** Whether the element's text is cut, and cut with an ellipsis rather than clipped. */
const truncation = (title: Locator) =>
  title.evaluate((element) => ({
    cut: element.scrollWidth > element.clientWidth,
    overflow: getComputedStyle(element).textOverflow,
  }));

test('a long title is cut with an ellipsis in the day, in "+N more" and in the lifted copy', async ({
  page,
}) => {
  const date = dayOfMonth(10);
  const note = (name: string) =>
    ['---', 'type: task', `due: ${date}`, '---', '', `${name}.`, ''].join('\n');
  // Four on one day: three would all fit, so two are shown and two are listed.
  await openCalendar(page, {
    [`${LONG} one.md`]: note('one'),
    [`${LONG} two.md`]: note('two'),
    [`${LONG} three.md`]: note('three'),
    [`${LONG} four.md`]: note('four'),
  });
  await openCalendarView(page);
  const day = page.getByRole('group', { name: date });
  const title = day.locator('.calendar__entry .calendar__title').first();
  await expect(title).toBeVisible();
  expect(await truncation(title)).toEqual({ cut: true, overflow: 'ellipsis' });

  await day.getByRole('button', { name: '+2 more' }).click();
  const more = page.getByRole('dialog', { name: `More on ${date}` });
  const listed = more.locator('.calendar__more-item .calendar__title');
  await expect(listed).toHaveCount(2);
  expect(await truncation(listed.first())).toEqual({ cut: true, overflow: 'ellipsis' });
  await page.keyboard.press('Escape');
  await expect(more).toHaveCount(0);

  const at = (await day.locator('.calendar__entry').first().boundingBox())!;
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move(at.x + at.width / 2 + 10, at.y + at.height / 2 + 10, { steps: 3 });
  await page.mouse.move(at.x + at.width / 2 + 60, at.y + at.height / 2 + 40, { steps: 6 });
  const lifted = page.locator('.calendar__entry--lifted .calendar__title');
  await expect(lifted).toBeVisible();
  expect(await truncation(lifted)).toEqual({ cut: true, overflow: 'ellipsis' });
  // Put it down where it was: nothing is written.
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(lifted).toHaveCount(0);
});

test('a note with no date is counted rather than hidden silently', async ({ page }) => {
  await openCalendar(page);
  await openCalendarView(page);

  await expect(page.getByText('1 with no due')).toBeVisible();
});

test('the month is turned from the view toolbar, and Today brings it back', async ({ page }) => {
  await openCalendar(page);
  await openCalendarView(page);

  // The nav lives in the toolbar row with Filter and Sort, not in the grid.
  const toolbar = page.locator('.view-toolbar');
  const month = toolbar.getByRole('group', { name: 'Calendar dates' });
  await expect(month).toBeVisible();
  const shown = await month.locator('.month-nav__label').innerText();

  await month.getByRole('button', { name: 'Next month' }).click();
  await expect(month.locator('.month-nav__label')).not.toHaveText(shown);
  // A month on, today is not a day of the month: its cell is outside or gone.
  await expect(page.locator('.calendar__day--today:not(.calendar__day--outside)')).toHaveCount(0);

  await month.getByRole('button', { name: 'Today' }).click();
  await expect(month.locator('.month-nav__label')).toHaveText(shown);
  await expect(page.getByLabel(today, { exact: true })).toBeVisible();
});

test('dragging a note to another day writes the date into it', async ({ page }) => {
  const vault = await openCalendar(page);
  await openCalendarView(page);

  await dragWithPointer(page, {
    from: page.locator('.calendar__entry[data-path="mid.md"]'),
    to: page.getByLabel(dayOfMonth(17), { exact: true }),
    overText: /is over \w+ 17 /,
  });

  await expectFile(vault, 'mid.md').toContain(`due: ${dayOfMonth(17)}`);
});

test('a note can be moved a week and a day with the keyboard alone', async ({ page }) => {
  const vault = await openCalendar(page);
  await openCalendarView(page);

  // Down is a week, Left a day: the 15th lands on the 21st. A note that moved
  // only one way, or not at all, leaves a different date in the file.
  await dragWithKeyboard(page, page.getByRole('button', { name: 'mid', exact: true }), [
    'ArrowDown',
    'ArrowLeft',
  ]);

  await expectFile(vault, 'mid.md').toContain(`due: ${dayOfMonth(21)}`);
  await expect(
    page.getByLabel(dayOfMonth(21), { exact: true }).getByRole('button', { name: 'mid' }),
  ).toBeFocused();
});

test('escape puts a keyboard-held note down without writing anything', async ({ page }) => {
  const vault = await openCalendar(page);
  await openCalendarView(page);

  await dragWithKeyboard(
    page,
    page.getByRole('button', { name: 'mid', exact: true }),
    ['ArrowRight'],
    {
      finish: 'Escape',
    },
  );
  // A write known to happen, to a different note, made after the cancel: once
  // it has landed, one the cancel made would have landed too. (Moving the same
  // note again would overwrite a stray write and hide it.)
  await dragWithKeyboard(page, page.getByRole('button', { name: 'scheduled', exact: true }), [
    'ArrowRight',
  ]);
  await expectFile(vault, 'scheduled.md').toContain(`due: ${dayAfter(today)}`);

  expect(await vault.read('mid.md')).toContain(`due: ${dayOfMonth(15)}`);
});

test('today has a note, made on demand from the vault template', async ({ page }) => {
  const vault = await openCalendar(page);

  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('menuitem', { name: "Today's note" }).click();

  await expectFile(vault, `${DAILY}/${today}.md`).toContain('## What happened');
  await expect(page.getByRole('article', { name: today })).toBeVisible();
});

test('asking twice opens the same daily note rather than making another', async ({ page }) => {
  const vault = await openCalendar(page);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.getByRole('button', { name: 'New note' }).click();
    await page.getByRole('menuitem', { name: "Today's note" }).click();
    await expect(page.getByRole('article', { name: today })).toBeVisible();
  }

  await expectFile(vault, `${DAILY}/${today}.md`).toContain('## What happened');
  expect(await vault.read(`${DAILY}/${today} 2.md`)).toBe('');
  expect(await vault.read(`${today} 2.md`)).toBe('');
});
