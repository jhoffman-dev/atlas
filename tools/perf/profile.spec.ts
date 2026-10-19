/*
 * `pnpm perf:profile` — where the main thread's time goes during the slow
 * actions (#217), on the fixture vault, under Chromium's CPU profiler. It
 * names causes; `pnpm perf` (WebKit) is what says how long things take.
 *
 * Build without minifying first so the names are the source's:
 * `pnpm --filter @atlas/desktop exec vite build --minify false`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CDPSession } from '@playwright/test';
import { expect, test, type Page } from '../../e2e/fixtures.ts';
import { busiestFunctions, type CpuProfile } from './cpu-profile.ts';
import { waitForQuiet } from './probe.ts';
import { expandFolder, openFixtureVault, openFromSidebar } from './session.ts';

test.describe.configure({ mode: 'serial' });

let page: Page;
let cdp: CDPSession;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await openFixtureVault(page);
  cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
});

test.afterAll(async () => {
  await page.close();
});

async function profiled(name: string, action: () => Promise<void>): Promise<void> {
  await waitForQuiet(page);
  await cdp.send('Profiler.start');
  await action();
  await waitForQuiet(page);
  const { profile } = (await cdp.send('Profiler.stop')) as { profile: CpuProfile };
  const lines = busiestFunctions(profile, 40).map(
    (row) =>
      `${row.total.toFixed(0).padStart(7)} ms total ${row.self.toFixed(0).padStart(6)} ms self  ${row.name}`,
  );
  const folder = join('test-results', 'perf');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, `profile-${name}.txt`), `${lines.join('\n')}\n`);
  process.stdout.write(`\n== ${name} ==\n${lines.join('\n')}\n`);
}

test('opening the Inbox', async () => {
  const pickers = page.locator('article[aria-label="Inbox"] div.inbox__clarify select.inbox__file');
  await profiled('open-inbox', async () => {
    for (let turn = 0; turn < 3; turn += 1) {
      await page
        .getByRole('button', { name: /^Inbox/ })
        .first()
        .click();
      await expect(pickers.first()).toBeEnabled({ timeout: 30_000 });
      await page
        .getByRole('button', { name: /^Today/ })
        .first()
        .click();
      await expect(page.getByRole('article', { name: 'Inbox' })).toHaveCount(0);
    }
  });
});

test('filing five Inbox items', async () => {
  test.setTimeout(300_000);
  await page
    .getByRole('button', { name: /^Inbox/ })
    .first()
    .click();
  const pickers = page.locator('article[aria-label="Inbox"] div.inbox__clarify select.inbox__file');
  await expect(pickers.first()).toBeEnabled({ timeout: 30_000 });
  await profiled('filing', async () => {
    for (let filed = 0; filed < 5; filed += 1) {
      const label = (await pickers.first().getAttribute('aria-label')) ?? '';
      await pickers.first().selectOption({ index: 1 });
      await expect(page.locator(`select[aria-label="${label}"]`)).toHaveCount(0, {
        timeout: 60_000,
      });
      await expect(pickers.first()).toBeEnabled({ timeout: 60_000 });
    }
  });
});

test('typing in a meeting', async () => {
  const [title = ''] = await expandFolder(page, 'Meetings');
  await openFromSidebar(page, title);
  const editor = page.locator(`article[aria-label="${title}"] .ProseMirror`).first();
  await editor.focus();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.press('Enter');
  await profiled('typing', () => page.keyboard.type('Larkspur ledger reconciled', { delay: 30 }));
});

test('changing a task status', async () => {
  const [title = ''] = await expandFolder(page, 'Tasks');
  await openFromSidebar(page, title);
  const select = page
    .getByRole('region', { name: 'Properties' })
    .first()
    .getByRole('combobox', { name: 'Status' });
  await profiled('task-status', async () => {
    for (const status of ['next-action', 'in-progress', 'waiting']) {
      await select.selectOption(status);
      await waitForQuiet(page);
    }
  });
});
