import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createVault, expectFile, installHost, saveNow, type FakeVault } from './host.ts';

/**
 * #135: indexing a vault must never take the window away. These build a vault
 * large enough that its index takes many batches, and act on the window while
 * the build is under way.
 *
 * `INDEX_E2E_NOTES` makes the vault any size, for measuring by hand: the
 * numbers are printed, and the issue's bar of 5,000 notes is run that way.
 */
const LARGE = Number(process.env.INDEX_E2E_NOTES ?? 1500);

/** A note like the ones people keep: properties, links, tags, a checklist and a block id. */
function noteText(n: number, count: number): string {
  const paragraphs = Array.from(
    { length: 6 },
    (_, p) =>
      `Paragraph ${p} of note ${n} mentions [[Note ${(n * 7 + p) % count}]] and #topic${n % 40} with **bold**, \`code\` and a [link](https://example.com/${n}).`,
  );
  return [
    '---',
    `type: ${n % 5 === 0 ? 'task' : 'note'}`,
    `status: ${n % 3 === 0 ? 'next' : 'inbox'}`,
    `project: "[[Note ${(n + 1) % count}]]"`,
    `due: 2026-10-${String((n % 28) + 1).padStart(2, '0')}`,
    'tags: [alpha, beta]',
    '---',
    `# Note ${n}`,
    '',
    ...paragraphs.flatMap((paragraph) => [paragraph, '']),
    '- [ ] first thing',
    '- [x] second thing',
    '',
    `A block worth pointing at. ^blk${n}`,
    '',
  ].join('\n');
}

/** A vault of this many generated notes in fifty folders, with one plain note at its root. */
async function largeVault(count: number): Promise<FakeVault> {
  const vault = await createVault();
  for (let folder = 0; folder < 50; folder++) await mkdir(join(vault.root, `Folder ${folder}`));
  await Promise.all(
    Array.from({ length: count }, (_, n) =>
      writeFile(join(vault.root, `Folder ${n % 50}`, `Note ${n}.md`), noteText(n, count)),
    ),
  );
  await vault.write('Camping.md', 'Pack the tent.\n');
  return vault;
}

interface Watch {
  /** Every stretch the main thread could not run a timer for, longer than 50 ms. */
  stalls: number[];
  /** Notes handed to a worker to be read for the index. */
  derivedInWorker: number;
  /** When the first notes were read for the index, and when the last row was written. */
  began: number | null;
  ended: number | null;
}

/**
 * Watches the window's main thread from inside it: a timer that should fire
 * every few milliseconds, and how late each firing was. Also counts the notes
 * that leave for a worker, and brackets the build by its host commands.
 */
async function watchMainThread(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (window !== window.top) return;
    const watch: Watch = { stalls: [], derivedInWorker: 0, began: null, ended: null };
    (window as unknown as { __indexWatch: Watch }).__indexWatch = watch;

    let last = performance.now();
    setInterval(() => {
      const now = performance.now();
      if (now - last > 50 && watch.began !== null && watch.ended === null) {
        watch.stalls.push(now - last);
      }
      last = now;
    }, 4);

    const RealWorker = window.Worker;
    window.Worker = class extends RealWorker {
      override postMessage(message: unknown, ...rest: unknown[]) {
        const { kind, files } = message as { kind?: string; files?: unknown[] };
        if (kind === 'derive') watch.derivedInWorker += files?.length ?? 0;
        (super.postMessage as (...args: unknown[]) => void)(message, ...rest);
      }
    };

    type Invoke = (command: string, ...rest: unknown[]) => Promise<unknown>;
    const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: Invoke } })
      .__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    internals.invoke = (command, ...rest) => {
      // The build is from its first batch of notes to its count of what it holds.
      const paths = (rest[0] as { paths?: unknown[] } | undefined)?.paths;
      if (command === 'read_notes' && (paths?.length ?? 0) > 1) watch.began ??= performance.now();
      const answer = invoke(command, ...rest);
      if (command === 'index_stats') void answer.then(() => (watch.ended = performance.now()));
      return answer;
    };
  });
}

const watched = (page: Page) =>
  page.evaluate(() => (window as unknown as { __indexWatch: Watch }).__indexWatch);

test('the sidebar, Settings and an open note all answer while the vault is being indexed', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const count = 300;
  const vault = await largeVault(count);
  const host = await installHost(page, vault);
  const release = host.holdIndexAfter(2);

  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();

  // Two batches are in and the third is in flight: the build is under way, and stays so.
  const total = (count + 1).toLocaleString();
  const underWay = page.getByText(new RegExp(`^Indexing \\d+ of ${total}…$`));
  await expect(underWay).toBeVisible();

  // A sidebar row opens its note.
  await page.getByRole('treeitem', { name: 'Camping', exact: true }).click();
  const note = page.getByLabel('Note', { exact: true });
  await expect(note.getByText('Pack the tent.')).toBeVisible();

  // The note takes typing, and saves.
  await note.getByText('Pack the tent.').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' And the stove.');
  await expect(note.getByText('Pack the tent. And the stove.')).toBeVisible();
  await saveNow(page);
  await expectFile(vault, 'Camping.md').toBe('Pack the tent. And the stove.\n');

  // Settings opens, and says what the index is doing rather than waiting for it.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();
  await expect(settings.getByText(new RegExp(`^Indexing \\d+ of ${total}…$`))).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Rebuild' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();

  // All of that happened during the build, not after it.
  await expect(underWay).toBeVisible();

  release();
  await expect(page.getByText(`${total} notes indexed`)).toBeVisible({ timeout: 60_000 });
  // The edit made during the build is in the index it leaves: a search finds it.
  await page.keyboard.press('Meta+k');
  await page.getByRole('searchbox', { name: 'Search the vault' }).fill('stove');
  await expect(
    page.getByRole('dialog', { name: 'Search notes' }).getByRole('option', { name: /Camping/ }),
  ).toBeVisible();
});

test('indexing a large vault leaves the main thread free', async ({ page }) => {
  test.setTimeout(600_000);
  const vault = await largeVault(LARGE);
  await installHost(page, vault);
  await watchMainThread(page);

  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect.poll(async () => (await watched(page)).ended, { timeout: 500_000 }).not.toBeNull();

  const watch = await watched(page);
  const took = (watch.ended ?? 0) - (watch.began ?? 0);
  const stalled = watch.stalls.reduce((sum, stall) => sum + stall, 0);
  const longest = Math.max(0, ...watch.stalls);
  console.log(
    `[index-responsive] ${LARGE + 1} notes: built in ${Math.round(took)} ms; main thread ` +
      `stalled ${Math.round(stalled)} ms in ${watch.stalls.length} stretches over 50 ms, ` +
      `the longest ${Math.round(longest)} ms`,
  );

  // Every note was read for the index somewhere other than the main thread.
  expect(watch.derivedInWorker).toBe(LARGE + 1);
  // And the main thread was the window's for the build: read on it, the notes
  // take most of the build's time in stretches of half a second and more.
  // A share rather than a longest stretch, so a busy machine's one slow frame
  // is not a failure.
  expect(stalled / took).toBeLessThan(0.2);
});
