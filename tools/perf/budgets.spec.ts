/*
 * `pnpm perf:budgets` — the work budgets: how much each action makes the app
 * do, on the 2,008-note fixture vault, held to `budgets.json`. Counts, not
 * times: React commits, component renders and host commands by name.
 *
 * Every action is done twice, each time on a fresh page:
 * - **Counted**, on the work clock (`work-clock.ts`): virtual time, and the
 *   host's answers handed over one at a time in the order they were asked, so
 *   the same build makes the same counts on every run and every machine. A
 *   count over budget is the app doing more work, never a slow runner.
 * - **Timed**, in real time, for input→ready and the longest frame. Printed
 *   beside the counts and in the CI job summary, and never failed on.
 *
 * Built without minifying, so components keep their names. Each pass does
 * every action in `BUDGETED_ACTIONS`' order, each from where the last left it.
 *
 * `PERF_BUDGETS=write` writes the counts into `budgets.json` instead of
 * failing, and only ever lowers a budget (`lowered`). Raising one is James's
 * call, made by hand.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { emitVaultChanged, installHost, sidebarSection, type FakeVault } from '../../e2e/host.ts';
import { installRenderCounter } from '../../packages/ui/src/testing/render-counter.ts';
import { BUDGETED_ACTIONS, type BudgetedAction } from './budgeted-actions.ts';
import type { FixtureFile } from './fixture-vault.ts';
import { measure, waitForQuiet } from './probe.ts';
import { EVERY_NOTE_INDEXED, openFixtureVault, writeFixtureVault } from './session.ts';
import {
  between,
  installWorkClock,
  runUntil,
  startCounting,
  stopCounting,
  type WorkClockOptions,
} from './work-clock.ts';
import {
  breachesOf,
  budgetFor,
  describeBreaches,
  differencesBetween,
  lowered,
  reportTable,
  type ActionBudget,
  type BudgetsFile,
  type Measurement,
  type Work,
} from './work-budgets.ts';

const BUDGETS_FILE = join('tools', 'perf', 'budgets.json');
const WRITING = process.env.PERF_BUDGETS === 'write';
/** How many times the counted pass runs; more than one fails on any count that differs between runs. */
const COUNTED_RUNS = Math.max(1, Number(process.env.PERF_BUDGETS_RUNS ?? 1));

/** A fixed day, in UTC, so Today shows the same tasks on every run and every machine. */
const STARTS_AT = Date.UTC(2026, 5, 15, 9);
/** How long the page is watched doing nothing. */
const IDLE_MS = 3_000;

/**
 * The hard per-row rules: ticking or deciding one row draws the rows whose
 * content or focus changed, never the list.
 */
const ROW_RULES: Partial<Record<BudgetedAction, ActionBudget['rows']>> = {
  'Tick a task on Today': { TaskRow: 1 },
  'Decide an Inbox row': { InboxRow: 2 },
};

/** A board of the fixture's 48 projects, all active, by status: what "drag a board card" drags on. */
const PROJECT_BOARD: FixtureFile = {
  path: '.atlas/views/Project board.md',
  contents: [
    '---',
    'atlas: view',
    'type: project',
    'layout: board',
    'groupBy: status',
    'columns: [status]',
    'limit: 100',
    '---',
    '',
    '# Project board',
    '',
  ].join('\n'),
};

/** One step of an action: the input, and how the page says it is done. */
interface Phase {
  readonly act: () => Promise<void>;
  readonly ready: (arg: never) => boolean;
  readonly arg: unknown;
}

/** A phase, its predicate's argument type checked here and erased in the list. */
const phase = <Arg>(act: () => Promise<void>, ready: (arg: Arg) => boolean, arg: Arg): Phase => ({
  act,
  ready: ready as (arg: never) => boolean,
  arg,
});

/** How a pass does an action: counted on the work clock, or timed against the wall. */
interface Pass {
  readonly page: Page;
  readonly vault: FakeVault;
  /** Does `step` uncounted: getting the app to where the next action starts. */
  setUp(step: Phase): Promise<void>;
  /** Does an action's phases, and keeps what it took. */
  budgeted(action: BudgetedAction, phases: readonly Phase[]): Promise<void>;
  /** Watches the page do nothing for `IDLE_MS`. */
  idle(action: BudgetedAction): Promise<void>;
  /** Lets the page take one key or pointer move in before the next, as a person's hand does. */
  between(): Promise<void>;
}

const counted = new Map<string, Work>();
const timed = new Map<string, { inputToReady: number; longestFrame: number }>();

test('the app does no more work than its budget', async ({ browser }) => {
  test.setTimeout(900_000);
  const budgets = JSON.parse(await readFile(BUDGETS_FILE, 'utf8')) as BudgetsFile;

  await test.step('counted, on the work clock', async () => {
    const pass = await countedPass(browser, counted);
    await everyAction(pass);
    await pass.page.close();
  });
  for (let again = 2; again <= COUNTED_RUNS; again += 1) {
    await test.step(`counted again (${again} of ${COUNTED_RUNS}), to show the counts repeat`, async () => {
      const recount = new Map<string, Work>();
      const pass = await countedPass(browser, recount);
      await everyAction(pass);
      await pass.page.close();
      for (const action of BUDGETED_ACTIONS) {
        const [first, now] = [counted.get(action), recount.get(action)];
        if (first === undefined || now === undefined) continue;
        const changed = differencesBetween(first, now);
        expect.soft(changed, `"${action}" counted differently on run ${again}`).toEqual([]);
      }
    });
  }
  if (!WRITING) {
    for (const action of BUDGETED_ACTIONS) holdToBudget(action, budgets.actions[action]);
  }

  try {
    await test.step('timed, against the wall clock (reported, not gated)', async () => {
      const pass = await timedPass(browser);
      await everyAction(pass);
      await pass.page.close();
    });
  } finally {
    await report(budgets);
  }
  if (WRITING) await writeBudgets(budgets);
});

function holdToBudget(action: BudgetedAction, budget: ActionBudget | undefined): void {
  const work = counted.get(action);
  expect.soft(work, `"${action}" was not counted`).toBeDefined();
  expect.soft(budget, `"${action}" has no budget in ${BUDGETS_FILE}`).toBeDefined();
  if (work === undefined || budget === undefined) return;
  const breaches = breachesOf(work, budget);
  expect.soft(breaches, describeBreaches(action, work, breaches)).toEqual([]);
}

/** A fresh page on the fixture, its time and host held by the work clock from the first script. */
async function countedPass(browser: Browser, into: Map<string, Work>): Promise<Pass> {
  const page = await newPage(browser);
  const vault = await writeFixtureVault([PROJECT_BOARD]);
  // With a manifest, as the real index has: without one every refresh re-reads all 2,000 notes.
  await installHost(page, vault, { keepsManifest: true });
  await page.addInitScript(installRenderCounter);
  await page.addInitScript(installWorkClock, clockAt({ virtual: true }));
  await page.goto('/');
  const pass: Pass = {
    page,
    vault,
    async setUp({ act, ready, arg }) {
      await act();
      await runUntil(page, { ready, arg: arg as never });
    },
    async budgeted(action, phases) {
      await runUntil(page, {});
      await startCounting(page);
      for (const { act, ready, arg } of phases) {
        await act();
        await runUntil(page, { ready, arg: arg as never });
      }
      into.set(action, await stopCounting(page));
    },
    async idle(action) {
      await runUntil(page, {});
      await startCounting(page);
      await runUntil(page, { settleMs: IDLE_MS });
      into.set(action, await stopCounting(page));
    },
    async between() {
      await between(page);
    },
  };
  // The whole vault, not the first count the status shows.
  await pass.setUp(
    phase(
      () => page.getByRole('button', { name: 'Choose folder…' }).click(),
      (source) => new RegExp(source, 'm').test(document.body.innerText),
      EVERY_NOTE_INDEXED.source,
    ),
  );
  return pass;
}

/** A fresh page on the fixture in real time, with only its date fixed, for the times. */
async function timedPass(browser: Browser): Promise<Pass> {
  const page = await newPage(browser);
  await page.addInitScript(installWorkClock, clockAt({ virtual: false }));
  const vault = await openFixtureVault(page, [PROJECT_BOARD]);
  const time = async (action: BudgetedAction, phases: readonly Phase[]) => {
    await waitForQuiet(page);
    let inputToReady = 0;
    let longestFrame = 0;
    for (const { act, ready, arg } of phases) {
      const run = await measure(page, { act, ready, arg: arg as never });
      inputToReady += run.inputToReady;
      longestFrame = Math.max(longestFrame, run.longestFrame);
    }
    timed.set(action, { inputToReady, longestFrame });
  };
  return {
    page,
    vault,
    async setUp({ act, ready, arg }) {
      await act();
      await page.waitForFunction(ready, arg as never, { timeout: 60_000 });
      await waitForQuiet(page);
    },
    budgeted: time,
    idle: (action) =>
      time(action, [
        phase(
          () => Promise.resolve(),
          (ms) => {
            const { armedAt } = (window as unknown as { __perf: { armedAt: number | null } })
              .__perf;
            return armedAt !== null && performance.now() - armedAt >= ms;
          },
          IDLE_MS,
        ),
      ]),
    between: () => Promise.resolve(),
  };
}

const clockAt = ({ virtual }: Pick<WorkClockOptions, 'virtual'>): WorkClockOptions => ({
  startsAt: STARTS_AT,
  virtual,
});

const newPage = (browser: Browser) =>
  browser.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: 'UTC', locale: 'en-US' });

const INBOX_PICKERS = 'article[aria-label="Inbox"] div.inbox__clarify select.inbox__file';
const TODAY_TICKS = 'article[aria-label="Today"] input.done-check:not([disabled])';
const SETTINGS = '[role="dialog"][aria-label="Settings"]';
const SEARCH_BOX = 'input[aria-label="Search the vault"]';
const TASK_TABLE = /^Task, \d+ notes?$/;
const TYPED = 'ledger 10.';

const editorOf = (title: string) =>
  `article[aria-label="${title}"] .ProseMirror[contenteditable="true"]`;

const exists = (selector: string) => document.querySelector(selector) !== null;
const gone = (selector: string) => document.querySelector(selector) === null;

/** Every budgeted action, in order, each from where the one before left the app. */
async function everyAction(pass: Pass): Promise<void> {
  const { page } = pass;
  const [first = '', second = ''] = await toggleFolder(pass, 'Notes');
  await pass.budgeted('Click a sidebar note', [openNote(pass, first)]);
  await pass.budgeted('Switch notes', [openNote(pass, second)]);
  await typeAndSave(pass, second);
  await pass.idle('Idle 3 s with a note open');

  await pass.budgeted('Open Settings', [
    phase(
      () => page.getByRole('button', { name: 'Settings', exact: true }).click(),
      exists,
      SETTINGS,
    ),
  ]);
  await pass.setUp(phase(() => page.keyboard.press('Escape'), gone, SETTINGS));

  await pass.budgeted('Open Today', [
    phase(() => sidebarButton(page, /^Today/).click(), exists, TODAY_TICKS),
  ]);
  await pass.idle('Idle 3 s on Today');
  await tickATask(pass);

  await pass.budgeted('Open the Inbox', [
    phase(
      () => sidebarButton(page, /^Inbox/).click(),
      (selector) => document.querySelector<HTMLSelectElement>(selector)?.disabled === false,
      INBOX_PICKERS,
    ),
  ]);
  await decideARow(pass);

  await toggleFolder(pass, 'Notes');
  const [person = ''] = await toggleFolder(pass, 'People');
  await pass.budgeted("Open a person's page", [openNote(pass, person)]);

  await pass.budgeted('Open the 420-row table', [
    phase(
      () => sidebarSection(page, 'types').getByRole('button', { name: TASK_TABLE }).click(),
      () =>
        [...document.querySelectorAll('.table__count')].some((count) =>
          /tasks?/.test(count.textContent ?? ''),
        ),
      null,
    ),
  ]);
  await searchOverTheTable(pass);
  await dragACard(pass);
}

const sidebarButton = (page: Page, name: RegExp) => page.getByRole('button', { name }).first();

/** Opens a note from the sidebar's tree; ready once its editor is there to type in. */
const openNote = ({ page }: Pass, title: string) =>
  phase(
    () =>
      sidebarSection(page, 'userSpace').getByRole('treeitem', { name: title, exact: true }).click(),
    exists,
    editorOf(title),
  );

/** Opens or shuts a top-level folder in the tree, and names the notes it then shows. */
async function toggleFolder(pass: Pass, name: string): Promise<string[]> {
  const tree = sidebarSection(pass.page, 'userSpace');
  const folder = tree.getByRole('treeitem', { name, exact: true });
  const opening = (await folder.getAttribute('aria-expanded')) !== 'true';
  await pass.setUp(
    phase(
      () => folder.click(),
      ({ title, open }) =>
        document
          .querySelector(`[role="treeitem"][aria-level="1"][aria-label="${title}"]`)
          ?.getAttribute('aria-expanded') === String(open),
      { title: name, open: opening },
    ),
  );
  if (!opening) return [];
  return tree
    .locator('[role="treeitem"][aria-level="2"]:not([aria-expanded])')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('aria-label') ?? ''));
}

/** Ten keys at the end of the note, one at a time; then the autosave, and the watcher telling of it. */
async function typeAndSave(pass: Pass, title: string): Promise<void> {
  const { page } = pass;
  // Focused rather than clicked: a click lands on whatever is in the middle, a link included.
  await page.locator(editorOf(title)).focus();
  await page.keyboard.press('Meta+ArrowDown');
  await pass.budgeted('Type 10 characters in a note', [
    phase(
      async () => {
        for (const key of TYPED) {
          await page.keyboard.type(key);
          await pass.between();
        }
      },
      ({ selector, text }) =>
        document
          .querySelector(selector)
          ?.textContent?.replace(/\u00a0/g, ' ')
          .includes(text) === true,
      { selector: editorOf(title), text: TYPED },
    ),
  ]);

  const path = `Notes/${title}.md`;
  const saved = () =>
    [...document.querySelectorAll('[role="status"]')].some((each) => each.textContent === 'Saved');
  await pass.budgeted('One autosave and its watcher echo', [
    phase(() => Promise.resolve(), saved, null),
    // What the real host's watcher sends once the save is on disk.
    phase(() => emitVaultChanged(page, [path]), saved, null),
  ]);
  expect(await pass.vault.read(path)).toContain(TYPED);
}

async function tickATask(pass: Pass): Promise<void> {
  const tick = pass.page.locator(TODAY_TICKS).first();
  const label = (await tick.getAttribute('aria-label')) ?? '';
  await pass.budgeted('Tick a task on Today', [
    phase(
      () => tick.click(),
      (ticked) => document.querySelector(`input[aria-label="${CSS.escape(ticked)}"]`) === null,
      label,
    ),
  ]);
}

async function decideARow(pass: Pass): Promise<void> {
  const picker = pass.page.locator(INBOX_PICKERS).first();
  const label = (await picker.getAttribute('aria-label')) ?? '';
  await pass.budgeted('Decide an Inbox row', [
    phase(
      () => picker.selectOption({ index: 1 }).then(() => undefined),
      ({ filed, selector }) => {
        const all = [...document.querySelectorAll<HTMLSelectElement>(selector)];
        return (
          all[0]?.disabled === false &&
          all.every((each) => each.getAttribute('aria-label') !== filed)
        );
      },
      { filed: label, selector: INBOX_PICKERS },
    ),
  ]);
}

async function searchOverTheTable(pass: Pass): Promise<void> {
  const { page } = pass;
  const query = 'tobia';
  await pass.budgeted('⌘K + 5 keys over the table', [
    phase(
      async () => {
        await page.keyboard.press('Meta+k');
        await pass.between();
        for (const key of query) {
          await page.keyboard.type(key);
          await pass.between();
        }
      },
      ({ text, selector }) =>
        document.querySelector<HTMLInputElement>(selector)?.value === text &&
        document.querySelector('[role="option"]') !== null,
      { text: query, selector: SEARCH_BOX },
    ),
  ]);
  await pass.setUp(phase(() => page.keyboard.press('Escape'), gone, SEARCH_BOX));
}

/**
 * Drags the first active project onto the paused column by the pointer, in a
 * fixed number of moves, each taken in before the next: the same events on
 * every run. (`dragWithPointer` in `e2e/drag.ts` re-aims until a scrolling
 * target settles; this board does not scroll.)
 */
async function dragACard(pass: Pass): Promise<void> {
  const { page } = pass;
  await pass.setUp(
    phase(
      () =>
        sidebarSection(page, 'views')
          .getByRole('button', { name: 'Project board', exact: true })
          .click(),
      exists,
      '.board .board__card',
    ),
  );
  const board = page.locator('.board');
  const card = board
    .getByRole('region', { name: 'active', exact: true })
    .locator('.board__card')
    .first();
  const cardPath = (await card.getAttribute('data-path')) ?? '';
  const start = await centreOf(card);
  const end = await centreOf(board.getByRole('region', { name: 'paused', exact: true }));
  const hop = { x: start.x + 8, y: start.y + 8 };
  const announced = (text: string) =>
    [...document.querySelectorAll('[id^="DndLiveRegion"]')].some((region) =>
      (region.textContent ?? '').includes(text),
    );
  await pass.budgeted('Drag a board card', [
    phase(
      async () => {
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await pass.between();
        // The short hop that turns a press into a drag, then the way across.
        for (const [from, to, steps] of [
          [start, hop, 4],
          [hop, end, 20],
        ] as const) {
          for (let step = 1; step <= steps; step += 1) {
            const along = step / steps;
            await page.mouse.move(
              from.x + (to.x - from.x) * along,
              from.y + (to.y - from.y) * along,
            );
            await pass.between();
          }
        }
      },
      announced,
      'is over paused.',
    ),
    phase(() => page.mouse.up(), announced, 'dropped'),
  ]);
  await expect.poll(() => pass.vault.read(cardPath)).toMatch(/^status: paused$/m);
}

async function centreOf(target: Locator): Promise<{ x: number; y: number }> {
  const box = await target.boundingBox();
  if (box === null) throw new Error('drag target is not on screen');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Prints the run beside the budgets, keeps it as JSON, and adds it to the CI job's summary. */
async function report(budgets: BudgetsFile): Promise<void> {
  const rows: Measurement[] = BUDGETED_ACTIONS.flatMap((action) => {
    const work = counted.get(action);
    if (work === undefined) return [];
    const times = timed.get(action);
    return [
      {
        action,
        work,
        budget: budgets.actions[action],
        inputToReady: times?.inputToReady ?? Number.NaN,
        longestFrame: times?.longestFrame ?? Number.NaN,
      },
    ];
  });
  const table = reportTable(rows);
  const folder = join('test-results', 'perf');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'budgets.json'), `${JSON.stringify(rows, null, 2)}\n`);
  process.stdout.write(`\nWork budgets (counts gated, times reported only):\n\n${table}\n`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary !== undefined && summary !== '') {
    await appendFile(
      summary,
      `## Work budgets\n\nCounts are held to \`tools/perf/budgets.json\`; times are reported only.\n\n${table}\n`,
    );
  }
}

/** Writes this run's counts into `budgets.json`, lowering each budget and never raising one. */
async function writeBudgets(budgets: BudgetsFile): Promise<void> {
  const actions: Record<string, ActionBudget> = {};
  for (const action of BUDGETED_ACTIONS) {
    const work = counted.get(action);
    const was = budgets.actions[action];
    if (work !== undefined) actions[action] = lowered(was, budgetFor(work, ROW_RULES[action]));
    else if (was !== undefined) actions[action] = was;
  }
  const next: BudgetsFile = { $comment: budgets.$comment, actions };
  await writeFile(BUDGETS_FILE, `${JSON.stringify(next, null, 2)}\n`);
}
