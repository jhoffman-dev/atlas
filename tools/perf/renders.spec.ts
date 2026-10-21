/*
 * `pnpm perf:renders` — how much React draws again for one action, on the
 * 2,000-note fixture vault, beside how long the action takes and the longest
 * frame it blocked. A row list whose memo is defeated, or a hook that reads
 * layout on every render, shows here as a count far above the one row the
 * action changed.
 *
 * Built without minifying, so components keep their names. Each action is
 * timed `REPEATS` times with nothing counting, then done once more with the
 * render counter on — counting walks what React drew, which costs time of
 * its own. Writes `test-results/perf/renders.json` and prints a table.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '../../e2e/fixtures.ts';
import { sidebarSection } from '../../e2e/host.ts';
import {
  installRenderCounter,
  type RenderCounts,
} from '../../packages/ui/src/testing/render-counter.ts';
import { FIXTURE_SHAPE, noteCount } from './fixture-vault.ts';
import { measure, percentile, waitForQuiet, type Measured } from './probe.ts';
import { openFixtureVault } from './session.ts';

/** How many times each action is timed. */
const REPEATS = Number(process.env.PERF_REPEATS ?? 5);

/** One action, ready to be given: what to do, and how the page says it is done. */
interface Step<Arg> {
  readonly act: () => Promise<void>;
  readonly ready: (arg: Arg) => boolean;
  readonly arg: Arg;
}

interface Observed {
  readonly action: string;
  readonly timed: readonly Measured[];
  readonly counts: RenderCounts;
}

test.describe.configure({ mode: 'serial' });

const observed: Observed[] = [];
let page: Page;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(installRenderCounter);
  await openFixtureVault(page);
});

test.afterAll(async () => {
  await page.close();
  const report = observed.map(summarise);
  const folder = join('test-results', 'perf');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'renders.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`\n${table(report)}\n`);
});

/** Times `setUp`'s step `REPEATS` times, then counts what one more drew. */
async function observe<Arg>(action: string, setUp: () => Promise<Step<Arg>>): Promise<void> {
  // Each run waits for the host to go quiet, up to `probe.ts`'s limit.
  test.setTimeout((REPEATS + 1) * 30_000);
  const timed: Measured[] = [];
  for (let turn = 0; turn < REPEATS; turn += 1) timed.push(await measure(page, await setUp()));
  const step = await setUp();
  await page.evaluate(() => {
    const counter = (globalThis as { __renderCounter?: { on: boolean } }).__renderCounter;
    Object.assign(counter ?? {}, { on: true, commits: 0, renders: {}, changedProps: {} });
  });
  await measure(page, step);
  const counts = await page.evaluate(() => {
    const counter = (globalThis as { __renderCounter?: RenderCounts & { on: boolean } })
      .__renderCounter;
    if (counter === undefined) throw new Error('the render counter was not installed');
    counter.on = false;
    return {
      commits: counter.commits,
      renders: counter.renders,
      changedProps: counter.changedProps,
    };
  });
  observed.push({ action, timed, counts });
}

// The note pickers suggest notes as you type (#465): fields, not selects.
const INBOX_PICKERS = 'article[aria-label="Inbox"] div.inbox__clarify input.inbox__file';

/**
 * Opens a note picker and makes its first suggestion active (#465): before
 * the pick, as a select's options were there before its change.
 */
async function readyToPick(picker: Locator): Promise<void> {
  await picker.click();
  await picker.press('ArrowDown');
  await expect(
    page.locator('[role="listbox"][aria-label="Suggested notes"] [aria-selected="true"]'),
  ).toHaveCount(1);
}

const TODAY_TICKS = 'article[aria-label="Today"] input.done-check:not([disabled])';
const TASK_TABLE = /^Task, \d+ notes?$/;

const sidebarButton = (name: RegExp) => page.getByRole('button', { name }).first();

async function showInbox(): Promise<void> {
  if ((await page.locator(INBOX_PICKERS).count()) === 0) await sidebarButton(/^Inbox/).click();
  await expect(page.locator(INBOX_PICKERS).first()).toBeEnabled({ timeout: 30_000 });
  await waitForQuiet(page);
}

async function showToday(): Promise<void> {
  if ((await page.locator(TODAY_TICKS).count()) === 0) await sidebarButton(/^Today/).click();
  await expect(page.locator(TODAY_TICKS).first()).toBeVisible({ timeout: 30_000 });
  await waitForQuiet(page);
}

async function showTaskTable(): Promise<void> {
  if ((await page.locator('.table__count', { hasText: /tasks?/ }).count()) === 0) {
    await sidebarSection(page, 'types').getByRole('button', { name: TASK_TABLE }).click();
  }
  await expect(page.locator('.table__count', { hasText: /tasks?/ })).toBeVisible();
  await waitForQuiet(page);
}

test('open the Inbox', async () => {
  await observe('Open the Inbox', async () => {
    await showToday();
    return {
      act: () => sidebarButton(/^Inbox/).click(),
      arg: INBOX_PICKERS,
      ready: (selector) => document.querySelector<HTMLInputElement>(selector)?.disabled === false,
    };
  });
});

test('decide one Inbox row', async () => {
  await observe('Decide one Inbox row (file a note)', async () => {
    await showInbox();
    const picker = page.locator(INBOX_PICKERS).first();
    const label = (await picker.getAttribute('aria-label')) ?? '';
    await readyToPick(picker);
    return {
      act: () => picker.press('Enter'),
      arg: { label, selector: INBOX_PICKERS },
      ready: ({ label: filed, selector }) => {
        const all = [...document.querySelectorAll<HTMLInputElement>(selector)];
        return (
          all[0]?.disabled === false &&
          all.every((each) => each.getAttribute('aria-label') !== filed)
        );
      },
    };
  });
});

test('open Today', async () => {
  await observe('Open Today', async () => {
    await showInbox();
    return {
      act: () => sidebarButton(/^Today/).click(),
      arg: TODAY_TICKS,
      ready: (selector) => document.querySelector(selector) !== null,
    };
  });
});

test('tick a task on Today', async () => {
  await observe('Tick a task on Today', async () => {
    await showToday();
    const tick = page.locator(TODAY_TICKS).first();
    const label = (await tick.getAttribute('aria-label')) ?? '';
    return {
      act: () => tick.click(),
      arg: label,
      ready: (ticked) =>
        document.querySelector(`input[aria-label="${CSS.escape(ticked)}"]`) === null,
    };
  });
});

test('open the 420-row table', async () => {
  await observe('Open the 420-row Task table', async () => {
    await showToday();
    return {
      act: () => sidebarSection(page, 'types').getByRole('button', { name: TASK_TABLE }).click(),
      arg: null,
      ready: () =>
        [...document.querySelectorAll('.table__count')].some((count) =>
          /tasks?/.test(count.textContent ?? ''),
        ),
    };
  });
});

test('open ⌘K and type five keys over the 420-row table', async () => {
  const typed = 'tobia';
  const palette = page.getByRole('dialog', { name: 'Search notes' });
  await observe('⌘K + 5 keys, 420-row table open', async () => {
    if (await palette.isVisible()) await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await showTaskTable();
    return {
      act: async () => {
        await page.keyboard.press('Meta+k');
        const search = page.getByRole('searchbox', { name: 'Search the vault' });
        await search.fill('');
        await page.keyboard.type(typed);
      },
      arg: typed,
      ready: (text) => {
        const box = document.querySelector<HTMLInputElement>(
          'input[aria-label="Search the vault"]',
        );
        return box?.value === text && document.querySelector('[role="option"]') !== null;
      },
    };
  });
  await page.keyboard.press('Escape');
});

interface Summary {
  readonly action: string;
  readonly runs: number;
  readonly p50: number;
  readonly longestFrame: number;
  readonly renders: number;
  readonly top: string;
  /** Every component drawn in the counted run, by how often. */
  readonly byComponent: Readonly<Record<string, number>>;
  /** For each component drawn again, the props that changed between its renders. */
  readonly changedProps: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

const rounded = (value: number) => Math.round(value * 10) / 10;

function summarise({ action, timed, counts }: Observed): Summary {
  const byCount = Object.entries(counts.renders).sort((a, b) => b[1] - a[1]);
  const busiest = byCount.slice(0, 6);
  return {
    action,
    runs: timed.length,
    p50: rounded(
      percentile(
        timed.map((run) => run.inputToReady),
        50,
      ),
    ),
    longestFrame: rounded(
      percentile(
        timed.map((run) => run.longestFrame),
        50,
      ),
    ),
    renders: byCount.reduce((sum, [, count]) => sum + count, 0),
    top: busiest.map(([name, count]) => `${name}×${count}`).join(', '),
    byComponent: Object.fromEntries(byCount),
    changedProps: counts.changedProps,
  };
}

function table(report: readonly Summary[]): string {
  const head =
    '| Action | Runs | Input→ready p50 (ms) | Longest frame p50 (ms) | Component renders | Most drawn |';
  const rule = `|${' --- |'.repeat(6)}`;
  const rows = report.map(
    (row) =>
      `| ${row.action} | ${row.runs} | ${row.p50} | ${row.longestFrame} | ${row.renders} | ${row.top} |`,
  );
  return [`Fixture: ${noteCount(FIXTURE_SHAPE)} notes.`, '', head, rule, ...rows].join('\n');
}
