import { expect, test, type Page } from '@playwright/test';
import {
  createVault,
  emitVaultChanged,
  expectFile,
  installHost,
  sidebarSection,
  type FakeHost,
  type FakeVault,
} from './host.ts';
import { dragCardTo } from './drag.ts';

/**
 * Attacks on PR #256 (#254): with the host echoing the app's own writes, as
 * the real watcher does, deciding an Inbox row and dragging a board card each
 * walk the vault no more often than with no echo at all, and a change from
 * outside after them still reaches the index.
 */

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
  '  project:',
  '    kind: relation',
  '    target: project',
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

const BOARD_TASK_TYPE = [
  '---',
  'name: task',
  'properties:',
  '  status:',
  '    kind: select',
  '    options: [backlog, doing, done]',
  '---',
  '',
].join('\n');

const BOARD = [
  '---',
  'atlas: view',
  'type: task',
  'layout: board',
  'groupBy: status',
  'columns: [status]',
  'limit: 50',
  '---',
  '',
  '# Board',
  '',
].join('\n');

const indexedCount = async (page: Page) =>
  Number(/^(\d+)/.exec((await page.getByText(/^\d+ notes indexed/).textContent()) ?? '')?.[1]);

/** Another program adds a note, and the watcher tells; resolves once the index holds it. */
async function addFromOutside(page: Page, vault: FakeVault, at: string) {
  const indexed = await indexedCount(page);
  await vault.write(at, note(['type: task', 'status: backlog'], 'From outside.'));
  await emitVaultChanged(page, [at]);
  await expect(page.getByText(new RegExp(`^${indexed + 1} notes indexed`))).toBeVisible();
}

/**
 * Records, in the page, each walk of the vault the app starts and each report
 * the watcher sends, in order, and how many host calls are still unanswered.
 */
async function recordWalksAndReports(page: Page) {
  await page.addInitScript(() => {
    type Internals = {
      invoke: (command: string, args: unknown, options?: unknown) => Promise<unknown>;
      transformCallback: (callback: (event: { payload: unknown }) => void) => number;
    };
    const internals = (window as unknown as { __TAURI_INTERNALS__: Internals }).__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    const seen = { order: [] as string[], unanswered: 0 };
    Object.assign(window, { __attack256: seen });
    internals.invoke = (command, args, options) => {
      if (command === 'list_notes') seen.order.push('walk');
      seen.unanswered += 1;
      const answered = invoke(command, args, options);
      void answered.then(
        () => void (seen.unanswered -= 1),
        () => void (seen.unanswered -= 1),
      );
      return answered;
    };
    const heard = internals.transformCallback(() => void seen.order.push('report'));
    void invoke('plugin:event|listen', { event: 'vault-changed', handler: heard });
  });
}

const seenSoFar = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __attack256: { order: string[]; unanswered: number } }).__attack256,
  );

/**
 * Does `act`, waits for the watcher's echo of it and for the app to have
 * answered it, then says how many walks of the vault the app started after
 * the echo arrived: none, when the echo is known as the app's own.
 */
async function walksAfterTheEcho(page: Page, host: FakeHost, act: () => Promise<void>) {
  const echoesBefore = await host.echoesSent();
  await act();
  await expect.poll(() => host.echoesSent()).toBeGreaterThan(echoesBefore);
  return walksSinceTheLastReport(page);
}

/** Once the app has answered the last report, the walks it started after it. */
async function walksSinceTheLastReport(page: Page) {
  // Settled: no host call is waiting, so whatever the report set off has been asked and answered.
  await expect.poll(async () => (await seenSoFar(page)).unanswered).toBe(0);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  await expect.poll(async () => (await seenSoFar(page)).unanswered).toBe(0);
  const { order } = await seenSoFar(page);
  return order.slice(order.lastIndexOf('report') + 1).filter((each) => each === 'walk').length;
}

async function openedForCounting(page: Page, vault: FakeVault): Promise<FakeHost> {
  const host = await installHost(page, vault, { echoWrites: true });
  await recordWalksAndReports(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return host;
}

test('the watcher’s echo of deciding an Inbox row is not refreshed for again (#254)', async ({
  page,
}) => {
  const vault = await createVault();
  for (const folder of ['.atlas/types', 'Projects', 'Inbox']) await vault.mkdir(folder);
  await vault.write('.atlas/types/task.md', GTD_TASK_TYPE);
  await vault.write('.atlas/types/project.md', PROJECT_TYPE);
  await vault.write('Projects/Atlas.md', note(['type: project', 'status: active'], 'The app.'));
  await vault.write('Inbox/Renew the passport.md', note(['type: task', 'status: inbox'], 'Card.'));
  const host = await openedForCounting(page, vault);
  // The app writes the Block type into a GTD vault as it opens (P31-01). The
  // host reports the new note's time, so its echo is known as the app's own:
  // nothing is walked for it (#258).
  await expectFile(vault, '.atlas/types/block.md').toContain('block');
  await expect.poll(() => host.echoesSent()).toBeGreaterThan(0);
  expect(await walksSinceTheLastReport(page)).toBe(0);
  await page
    .getByRole('list', { name: 'Go to' })
    .getByRole('button', { name: /^Inbox/ })
    .click();
  const inbox = page.getByRole('article', { name: 'Inbox' });
  await expect(inbox.getByRole('button', { name: 'Renew the passport' })).toBeVisible();

  const walks = await walksAfterTheEcho(page, host, async () => {
    await inbox
      .getByRole('combobox', { name: 'File Renew the passport under' })
      .selectOption({ label: 'Atlas' });
    await inbox
      .getByRole('form', { name: 'Clarify Renew the passport' })
      .getByRole('button', { name: 'Done' })
      .click();
    await expect.poll(() => vault.exists('Inbox/Renew the passport.md')).toBe(false);
  });
  expect(walks).toBe(0);
  // And a change from outside after it is still heard.
  await addFromOutside(page, vault, 'From outside.md');
});

test('the watcher’s echo of dragging a board card is not refreshed for again (#254)', async ({
  page,
}) => {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/views');
  await vault.write('.atlas/types/task.md', BOARD_TASK_TYPE);
  await vault.write('.atlas/views/Board.md', BOARD);
  await vault.write('first.md', note(['type: task', 'status: backlog'], '# First'));
  await vault.write('second.md', note(['type: task', 'status: doing'], '# Second'));
  const host = await openedForCounting(page, vault);
  await sidebarSection(page, 'views').getByRole('button', { name: 'Board', exact: true }).click();
  await page.locator('[data-path="first.md"]').waitFor();

  const walks = await walksAfterTheEcho(page, host, async () => {
    await dragCardTo(page, 'first.md', 'done');
    await expectFile(vault, 'first.md').toContain('status: done');
  });
  expect(walks).toBe(0);
  await addFromOutside(page, vault, 'From outside.md');
});

test('another program’s write straight after a drag, before its echo, still reaches the board (#254)', async ({
  page,
}) => {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/views');
  await vault.write('.atlas/types/task.md', BOARD_TASK_TYPE);
  await vault.write('.atlas/views/Board.md', BOARD);
  await vault.write('first.md', note(['type: task', 'status: backlog'], '# First'));
  await vault.write('second.md', note(['type: task', 'status: doing'], '# Second'));
  const host = await openedForCounting(page, vault);
  await sidebarSection(page, 'views').getByRole('button', { name: 'Board', exact: true }).click();
  await page.locator('[data-path="first.md"]').waitFor();
  const echoesBefore = await host.echoesSent();

  await dragCardTo(page, 'first.md', 'done');
  await expectFile(vault, 'first.md').toContain('status: done');
  // A sync client brings the other machine's version, inside the echo's 400 ms.
  await vault.write('first.md', note(['type: task', 'status: doing'], '# First, from the laptop'));
  await emitVaultChanged(page, ['first.md']);
  await expect.poll(() => host.echoesSent()).toBeGreaterThan(echoesBefore);

  await expect(
    page.getByRole('region', { name: 'doing' }).locator('[data-path="first.md"]'),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'done' }).locator('[data-path="first.md"]'),
  ).toHaveCount(0);
});
