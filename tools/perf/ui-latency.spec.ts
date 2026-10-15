/*
 * `pnpm perf` — how long the app takes to answer, on the 2,000-note fixture
 * vault (#217). Each action is done the way the person does it, and timed from
 * the input arriving to the frame that shows the page ready for the next one.
 *
 * The run writes what it measured to `test-results/perf/latency.json` and
 * prints it as a table. `BUDGETS` below fail the run when filing or opening a
 * note has slowed down past them, with headroom enough for a CI runner. CI
 * runs it on every change (`.github/workflows/gate.yml`, the `perf` job).
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { splitWindow, type FakeVault } from '../../e2e/host.ts';
import { FIXTURE_SHAPE, noteCount } from './fixture-vault.ts';
import { measure, percentile, waitForQuiet, type Measured } from './probe.ts';
import { expandFolder, openFixtureVault, openFromSidebar } from './session.ts';

/** How many Inbox items are filed in a row, as #217's acceptance asks. */
const FILINGS = Number(process.env.PERF_FILINGS ?? 50);
/** How many times each other action is repeated. */
const REPEATS = 10;

/**
 * The p95 each guarded action is held to, input to ready, in milliseconds.
 * On a Mac, filing measured about 35 ms and opening a note about 55 ms; on
 * CI's Linux runner, 52 ms and 335 ms (docs/perf/README.md). The headroom is
 * for that runner, and filing's budget is still far below the seconds it
 * took before #217.
 */
const BUDGETS = {
  filing: 250,
  openNote: 750,
} as const;

function expectWithinBudget(action: string, budget: number): void {
  const p95 = percentile(
    (results.get(action) ?? []).map((run) => run.inputToReady),
    95,
  );
  expect(p95, `${action}: p95 ${Math.round(p95)} ms, budget ${budget} ms`).toBeLessThan(budget);
}

test.describe.configure({ mode: 'serial' });

const results = new Map<string, Measured[]>();
let page: Page;
let vault: FakeVault;

function record(action: string, measured: Measured): void {
  results.set(action, [...(results.get(action) ?? []), measured]);
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  vault = await openFixtureVault(page);
});

test.afterAll(async () => {
  await page.close();
  const report = [...results].map(([action, runs]) => summarise(action, runs));
  const folder = join('test-results', 'perf');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'latency.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`\n${table(report)}\n`);
});

/** What a row's picker is called: "File <title> under". */
const NOTE_PICKERS = 'article[aria-label="Inbox"] div.inbox__clarify select.inbox__file';

const inboxRow = () => page.getByRole('button', { name: /^Inbox/ }).first();

test('open the Inbox', async () => {
  await waitForQuiet(page);
  for (let turn = 0; turn < REPEATS / 2; turn += 1) {
    record(
      'Open the Inbox (first row interactive)',
      await measure(page, {
        act: () => inboxRow().click(),
        arg: NOTE_PICKERS,
        ready: (selector) =>
          document.querySelector<HTMLSelectElement>(selector)?.disabled === false,
      }),
    );
    await page
      .getByRole('button', { name: /^Today/ })
      .first()
      .click();
    await expect(page.getByRole('article', { name: 'Inbox' })).toHaveCount(0);
  }
});

/** How long a person takes, at the quickest, between filing one item and picking the next. */
const THINK_MS = 250;

test(`file ${FILINGS} Inbox items in a row`, async () => {
  test.setTimeout(FILINGS * 30_000);
  await waitForQuiet(page);
  await inboxRow().click();
  const pickers = page.locator(NOTE_PICKERS);
  await expect(pickers.first()).toBeEnabled({ timeout: 30_000 });
  for (let filed = 0; filed < FILINGS; filed += 1) {
    const picker = pickers.first();
    await expect(picker).toBeEnabled({ timeout: 60_000 });
    const label = (await picker.getAttribute('aria-label')) ?? '';
    // Not waiting for the work behind each filing: the next is picked as soon as it can be.
    record(
      'File an Inbox item (next item interactive)',
      await measure(page, {
        act: () => picker.selectOption({ index: 1 }).then(() => undefined),
        arg: { label, selector: NOTE_PICKERS },
        settle: false,
        ready: ({ label: filedLabel, selector }) => {
          const all = [...document.querySelectorAll<HTMLSelectElement>(selector)];
          const next = all[0];
          return (
            next !== undefined &&
            !next.disabled &&
            all.every((each) => each.getAttribute('aria-label') !== filedLabel)
          );
        },
      }),
    );
    await page.waitForTimeout(THINK_MS);
  }
  expectWithinBudget('File an Inbox item (next item interactive)', BUDGETS.filing);

  // Every filing is written in the end: none is lost behind the page.
  await expect
    .poll(() => notesFiledUnderAProject(), { timeout: FILINGS * 10_000, intervals: [1_000] })
    .toBe(FIXTURE_SHAPE.tasks + FILINGS);
  await waitForQuiet(page);
});

/**
 * How many notes on disk are filed under a project: the fixture's tasks, and
 * each Inbox note filed. Counted wherever they are, so it holds whether
 * filing moves a note or only links it.
 */
async function notesFiledUnderAProject(): Promise<number> {
  const entries = await readdir(vault.root, { recursive: true, withFileTypes: true });
  const notes = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md'));
  const texts = await Promise.all(
    notes.map((entry) => readFile(join(entry.parentPath, entry.name), 'utf8')),
  );
  return texts.filter((text) => /^project: /m.test(text)).length;
}

test('open a note', async () => {
  await waitForQuiet(page);
  for (const title of (await expandFolder(page, 'Notes')).slice(0, REPEATS)) {
    record('Open a note', await openFromSidebar(page, title));
  }
  expectWithinBudget('Open a note', BUDGETS.openNote);
});

test('switch panes', async () => {
  await waitForQuiet(page);
  await splitWindow(page);
  await expect(page.getByRole('region', { name: 'Pane 2' })).toBeVisible();
  for (let turn = 0; turn < REPEATS; turn += 1) {
    const which = turn % 2 === 0 ? 1 : 2;
    const pane = page.getByRole('region', { name: `Pane ${which}` });
    record(
      'Switch panes',
      await measure(page, {
        act: () =>
          pane
            .getByRole('article')
            .first()
            .click({ position: { x: 24, y: 24 } }),
        arg: `Pane ${which}`,
        ready: (name) =>
          document
            .querySelector(`section[aria-label="${name}"]`)
            ?.classList.contains('pane--focused') === true,
      }),
    );
  }
});

const properties = () => page.getByRole('region', { name: 'Properties' }).first();

test('edit a property', async () => {
  const [title = ''] = await expandFolder(page, 'People');
  await openFromSidebar(page, title);
  await waitForQuiet(page);
  const role = properties().getByRole('textbox', { name: 'Role' });
  await role.click();
  await role.press('End');
  const typed = ' and treasurer';
  for (let at = 1; at <= Math.min(typed.length, REPEATS); at += 1) {
    record(
      'Edit a property (per key)',
      await measure(page, {
        act: () => page.keyboard.type(typed[at - 1] ?? 'x'),
        arg: typed.slice(0, at),
        ready: (text) => {
          const field = document.activeElement;
          return field instanceof HTMLInputElement && field.value.endsWith(text);
        },
      }),
    );
  }
  await role.press('Tab');
});

test('change a task status', async () => {
  const [title = ''] = await expandFolder(page, 'Tasks');
  await openFromSidebar(page, title);
  await waitForQuiet(page);
  const statuses = ['next-action', 'in-progress', 'waiting', 'backlog', 'someday'];
  for (let turn = 0; turn < REPEATS; turn += 1) {
    const status = statuses[turn % statuses.length] ?? 'backlog';
    const select = properties().getByRole('combobox', { name: 'Status' });
    record(
      'Change a task status',
      await measure(page, {
        act: () => select.selectOption(status).then(() => undefined),
        arg: status,
        ready: (picked) =>
          [
            ...document.querySelectorAll<HTMLSelectElement>(
              'section.pane--focused section[aria-label="Properties"] select',
            ),
          ].some((field) => !field.disabled && field.value === picked),
      }),
    );
  }
});

test('type in the editor', async () => {
  const [title = ''] = await expandFolder(page, 'Meetings');
  await openFromSidebar(page, title);
  await waitForQuiet(page);
  const editor = page.locator(`article[aria-label="${title}"] .ProseMirror`).first();
  // Focused rather than clicked: a click lands on whatever is in the middle, a link included.
  await editor.focus();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.press('Enter');
  const typed = 'Larkspur ledger reconciled by Mara Quill';
  for (let at = 1; at <= Math.min(typed.length, REPEATS * 3); at += 1) {
    const key = typed[at - 1] ?? 'x';
    record(
      'Type in the editor (per key)',
      await measure(page, {
        act: () => page.keyboard.type(key),
        arg: { title, text: typed.slice(0, at) },
        ready: ({ title: name, text }) =>
          // A space at the end of a line is drawn as a non-breaking one until the next key.
          document
            .querySelector(`article[aria-label="${name}"] .ProseMirror`)
            ?.textContent?.replace(/\u00a0/g, ' ')
            .includes(text) === true,
      }),
    );
  }
});

interface Summary {
  readonly action: string;
  readonly runs: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly longestFrame: number;
  readonly longFramesPerRun: number;
  /** Null for an action whose work was not waited for. */
  readonly settledP50: number | null;
  readonly callsBeforeReady: number;
  readonly callsPerRun: number;
  readonly hostMsPerRun: number;
  readonly topCalls: string;
  /** Every host command sent, by name, per run. */
  readonly callsByCommand: Readonly<Record<string, number>>;
}

const rounded = (value: number) => Math.round(value * 10) / 10;

function settledP50(runs: readonly Measured[]): number | null {
  const settled = runs.flatMap((run) => (run.settled === null ? [] : [run.settled]));
  return settled.length === 0 ? null : rounded(percentile(settled, 50));
}

function summarise(action: string, runs: readonly Measured[]): Summary {
  const ready = runs.map((run) => run.inputToReady);
  const mean = (pick: (run: Measured) => number) =>
    rounded(runs.reduce((sum, run) => sum + pick(run), 0) / Math.max(1, runs.length));
  const calls = new Map<string, number>();
  for (const run of runs) {
    for (const [command, count] of Object.entries(run.calls)) {
      calls.set(command, (calls.get(command) ?? 0) + count);
    }
  }
  const byCount = [...calls].sort((a, b) => b[1] - a[1]);
  const topCalls = byCount
    .slice(0, 4)
    .map(([command, count]) => `${command}×${rounded(count / runs.length)}`)
    .join(', ');
  return {
    action,
    runs: runs.length,
    p50: rounded(percentile(ready, 50)),
    p95: rounded(percentile(ready, 95)),
    max: rounded(Math.max(...ready)),
    longestFrame: rounded(Math.max(...runs.map((run) => run.longestFrame))),
    longFramesPerRun: mean((run) => run.longFrames),
    settledP50: settledP50(runs),
    callsBeforeReady: mean((run) => run.callsBeforeReady),
    callsPerRun: mean((run) => Object.values(run.calls).reduce((sum, count) => sum + count, 0)),
    hostMsPerRun: mean((run) => run.hostMs),
    topCalls,
    callsByCommand: Object.fromEntries(
      byCount.map(([command, count]) => [command, rounded(count / runs.length)]),
    ),
  };
}

function table(report: readonly Summary[]): string {
  const head =
    '| Action | Runs | Input→ready p50 | p95 | max | Longest frame | Long frames/run | Settled p50 | IPC before ready | IPC/run | Host ms/run | Most-sent commands |';
  const rule = `|${' --- |'.repeat(12)}`;
  const rows = report.map(
    (row) =>
      `| ${row.action} | ${row.runs} | ${row.p50} | ${row.p95} | ${row.max} | ${row.longestFrame} | ${row.longFramesPerRun} | ${row.settledP50 ?? 'not waited'} | ${row.callsBeforeReady} | ${row.callsPerRun} | ${row.hostMsPerRun} | ${row.topCalls} |`,
  );
  return [`Fixture: ${noteCount(FIXTURE_SHAPE)} notes.`, '', head, rule, ...rows].join('\n');
}
